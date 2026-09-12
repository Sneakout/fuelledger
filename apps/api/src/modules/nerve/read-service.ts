import { createHash } from "node:crypto";
import { bootstrap as dashboardBootstrap } from "../dashboard/service.js";
import { bootstrap as reconciliationBootstrap, openShiftsForNerve } from "../reconciliation/service.js";
import { analyzeTankMovements, bootstrap as inventoryBootstrap, stockAnalyticsForNerve } from "../inventory/service.js";
import { bootstrap as customersBootstrap } from "../customers/service.js";
import { bootstrap as purchasesBootstrap, receiptTimingAudit } from "../purchases/service.js";
import { buildReport } from "../reports/service.js";
import { AppError } from "../../lib/errors.js";
import { buildCustomerInvoiceAgeing, rankCustomerInvoiceAgeing } from "./credit-ageing.js";
import { analyzePurchases, type PurchaseReviewInvoice } from "./purchase-analysis.js";

export const nerveReadCapabilities = ["dashboard", "reconciliation", "inventory", "receivables", "payables", "purchase-price", "purchase-review", "receipt-timing", "profit", "evidence"] as const;
export type NerveReadCapability = typeof nerveReadCapabilities[number];
type Scope = { organizationId: string; stationId: string; asOf: string; startDate?: string; endDate?: string; evidenceId?: string };
type Evidence = { evidenceId: string; evidenceType: string; applicationId: "fuelnerve"; tenantId: string; resourceId: string; label: string; observedAt: string; periodStart?: string; periodEnd?: string; resolverPath: string };

const pageByCapability: Record<Exclude<NerveReadCapability, "evidence">, string> = {
  dashboard: "/", reconciliation: "/reconciliation", inventory: "/inventory", receivables: "/customers",
  payables: "/purchases", "purchase-price": "/purchases", "purchase-review": "/purchases", "receipt-timing": "/purchases", profit: "/reports",
};

export async function readForNerve(capability: NerveReadCapability, scope: Scope) {
  if (capability === "evidence") return resolveEvidence(scope);
  const evidence = makeEvidence(capability, scope);
  let supportingEvidence: Evidence[] = [evidence];
  const calculatedAt = new Date().toISOString();
  let items: unknown[];
  if (capability === "dashboard") {
    const value = await dashboardBootstrap(scope.organizationId, [scope.stationId], scope.stationId);
    items = [{ stationId: scope.stationId, sales: value.today.grossSales, openShifts: value.operations.openShifts, pendingReconciliations: value.operations.pendingReconciliations, cashVariance: value.operations.cashVariance, topProducts: value.topProducts, stationHealth: value.stationHealth }];
  } else if (capability === "reconciliation") {
    const [value, openShifts] = await Promise.all([reconciliationBootstrap(scope.organizationId, [scope.stationId]), openShiftsForNerve(scope.organizationId, scope.stationId, new Date(scope.asOf))]);
    const shifts = value.shifts.filter(shift => shift.station.id === scope.stationId);
    const asOf = new Date(scope.asOf);
    const prioritizedShifts = shifts.map(shift => {
      const missingReadings = [...(shift.tankReadings ?? []), ...(shift.nozzleReadings ?? [])].filter(reading => "closingDip" in reading ? reading.closingDip === null : reading.closingMeter === null).length;
      const missingCollections = (shift.nozzleAssignments ?? []).filter((assignment: { collectionAmount: unknown }) => assignment.collectionAmount === null).length;
      const collectionDifference = Math.abs(Number(shift.totals?.variance ?? 0));
      const awaitingMinutes = shift.status === "RECONCILIATION_REQUIRED" && shift.closedAt ? Math.max(0, Math.floor((asOf.getTime() - shift.closedAt.getTime()) / 60_000)) : 0;
      const handoverIncomplete = shift.closedAt === null || shift.closingCash === null || missingCollections > 0;
      const priorityScore = (shift.status === "RECONCILIATION_REQUIRED" ? 100_000 : 0) + Math.min(awaitingMinutes, 50_000) + missingReadings * 5_000 + missingCollections * 3_000 + Math.min(Math.round(collectionDifference * 100), 20_000) + (handoverIncomplete ? 2_000 : 0);
      const priorityReasons = [
        ...(awaitingMinutes > 0 ? [`Awaiting reconciliation for ${awaitingMinutes} minutes`] : []),
        ...(missingReadings > 0 ? [`${missingReadings} closing reading${missingReadings === 1 ? " is" : "s are"} missing`] : []),
        ...(missingCollections > 0 ? [`${missingCollections} collection detail${missingCollections === 1 ? " is" : "s are"} missing`] : []),
        ...(collectionDifference > 0 ? [`Absolute collection difference is ${collectionDifference}`] : []),
        ...(handoverIncomplete ? ["Handover information is incomplete"] : []),
      ];
      return {
        stationId: scope.stationId, shiftId: shift.id, shiftNumber: shift.shiftNumber, status: shift.status,
        openedAt: shift.openedAt.toISOString(), closedAt: shift.closedAt?.toISOString() ?? null, managerName: shift.manager.name,
        salesTotal: shift.salesTotal, autoUnallocated: shift.autoUnallocated, collectionDifferences: shift.collectionDifferences, totals: shift.totals,
        awaitingMinutes, missingReadings, missingCollections, collectionDifference, handoverIncomplete,
        locked: shift.status === "LOCKED", reconciled: Boolean(shift.reconciliation), priorityScore, priorityReasons,
        recordsToCompare: ["Closing readings", "Nozzle collections", "Payment-method totals", "Shift handover"],
      };
    }).sort((left, right) => right.priorityScore - left.priorityScore || left.shiftNumber - right.shiftNumber).map((shift, index) => ({ ...shift, priorityRank: index + 1 }));
    const reviewShifts = prioritizedShifts.filter(shift => shift.status === "RECONCILIATION_REQUIRED").map(shift => ({
      ...shift, stationName: value.shifts.find(row => row.id === shift.shiftId)?.station.name ?? scope.stationId,
      issueTypes: ["RECONCILIATION_PENDING", ...(shift.missingReadings ? ["MISSING_READINGS"] : []), ...(shift.missingCollections ? ["MISSING_COLLECTIONS"] : []), ...(shift.collectionDifference ? ["COLLECTION_DIFFERENCE"] : []), ...(shift.handoverIncomplete ? ["HANDOVER_INCOMPLETE"] : [])],
      evidenceId: makeShiftEvidence(scope, shift.shiftId, shift.shiftNumber, shift.status).evidenceId,
    }));
    const openReviewShifts = openShifts.filter(shift => shift.overdue).map(shift => ({
      ...shift, status: "OPEN", awaitingMinutes: shift.openMinutes, collectionDifference: 0, handoverIncomplete: true,
      priorityScore: 90_000 + Math.min(shift.openMinutes, 50_000) + shift.missingCollections * 3_000,
      priorityReasons: [`Open for ${shift.openMinutes} minutes, above the ${openShiftOverdueMinutesLabel()} review threshold`, ...(shift.missingCollections ? [`${shift.missingCollections} collection details are missing`] : []), "Closing handover is not recorded"],
      recordsToCompare: ["Shift opening record", "Current nozzle assignments", "Collection details", "Shift handover"],
      issueTypes: ["OPEN_OVERDUE", ...(shift.missingCollections ? ["MISSING_COLLECTIONS"] : []), "HANDOVER_INCOMPLETE"],
      evidenceId: makeShiftEvidence(scope, shift.shiftId, shift.shiftNumber, "OPEN").evidenceId,
    }));
    const shiftBriefings = [...reviewShifts, ...openReviewShifts].sort((left, right) => right.priorityScore - left.priorityScore || left.shiftNumber - right.shiftNumber).map((shift, index) => ({ ...shift, priorityRank: index + 1 }));
    supportingEvidence = [evidence, ...shiftBriefings.map(shift => makeShiftEvidence(scope, shift.shiftId, shift.shiftNumber, shift.status))];
    items = [{
      stationId: scope.stationId,
      openShiftOverdue: openShifts.some(shift => shift.overdue),
      openShifts: openShifts.length,
      pendingReconciliations: prioritizedShifts.filter(shift => shift.status === "RECONCILIATION_REQUIRED").length,
      missingReadings: prioritizedShifts.reduce((sum, shift) => sum + shift.missingReadings, 0),
      collectionVariance: shifts.reduce((sum, shift) => sum + Number(shift.reconciliation?.cashDifference ?? 0), 0),
      unusualHandover: prioritizedShifts.some(shift => shift.handoverIncomplete),
      priority: prioritizedShifts.find(shift => shift.status === "RECONCILIATION_REQUIRED") ?? null,
      shifts: prioritizedShifts,
      shiftBriefings,
    }];
  } else if (capability === "inventory") {
    const asOf = new Date(scope.asOf);
    const [value, timing, movementHistory] = await Promise.all([inventoryBootstrap(scope.organizationId, [scope.stationId]), receiptTimingAudit(scope.organizationId, [scope.stationId]), stockAnalyticsForNerve(scope.organizationId, scope.stationId, asOf)]);
    const recentFrom = new Date(scope.asOf); recentFrom.setDate(recentFrom.getDate() - 7);
    items = value.tanks.map(item => {
      const tankId = item.tank?.id ?? null, tankCode = item.tank?.code ?? null;
      const recentReceipts = value.receipts.filter(receipt => receipt.receivedAt >= recentFrom && receipt.receivedAt <= new Date(scope.asOf) && receipt.lines.some(line => line.tank?.code === tankCode)).map(receipt => ({ receiptId: receipt.id, supplierName: receipt.supplierName, referenceNo: receipt.referenceNo, receivedAt: receipt.receivedAt.toISOString() }));
      const ambiguousReceipts = timing.candidates.filter(candidate => candidate.affectedTanks.some(tank => tank.tankId === tankId)).map(candidate => ({ receiptId: candidate.id, invoiceNumber: candidate.invoiceNumber, supplierName: candidate.supplierName, reason: candidate.reason, receivedAt: candidate.receivedAt.toISOString(), enteredAt: candidate.enteredAt.toISOString() }));
      const stockStatus = item.bookStock <= 0 ? "EMPTY" : item.bookStock <= Math.max(1, item.opening * .2) ? "LOW" : "HEALTHY";
      const movementAnalysis = analyzeTankMovements(tankId ? movementHistory.get(tankId) ?? [] : [], item.bookStock, asOf);
      const varianceRequiresReview = item.variance !== null && Math.abs(item.variance) > .01;
      const densityMissing = item.density === null;
      const priorityScore = (stockStatus === "EMPTY" ? 100_000 : stockStatus === "LOW" ? 70_000 : 0) + (varianceRequiresReview ? 30_000 + Math.min(Math.round(Math.abs(item.variance ?? 0) * 100), 20_000) : 0) + (movementAnalysis.unusualMovement ? 25_000 : 0) + (ambiguousReceipts.length ? 20_000 : 0) + (densityMissing ? 10_000 : 0) + (item.adjustments !== 0 ? 2_000 : 0);
      const priorityReasons = [
        ...(stockStatus === "EMPTY" ? ["Recorded stock is empty"] : stockStatus === "LOW" ? ["Recorded stock is low"] : []),
        ...(varianceRequiresReview ? [`Physical and book stock differ by ${Math.abs(item.variance ?? 0)}`] : []),
        ...(ambiguousReceipts.length ? [`${ambiguousReceipts.length} related receipt time${ambiguousReceipts.length === 1 ? " is" : "s are"} ambiguous`] : []),
        ...movementAnalysis.unusualReasons,
        ...(densityMissing ? ["Morning density is not recorded"] : []),
        ...(item.adjustments !== 0 ? ["Approved adjustments affect this stock position"] : []),
      ];
      return { stationId: item.station?.id ?? scope.stationId, tankId, tankCode, productId: item.product.id, productCode: item.product.code, productName: item.product.name, openingStock: item.opening, receipts: item.receipts, sales: item.sales, adjustments: item.adjustments, bookStock: item.bookStock, physicalStock: item.physicalStock, bookStockAtReading: item.bookStockAtReading, physicalReadingAt: item.readAt?.toISOString() ?? null, variance: item.variance, stockStatus, varianceRequiresReview, unusualMovement: movementAnalysis.unusualMovement, unusualMovementReasons: movementAnalysis.unusualReasons, movementSample: movementAnalysis.movementSample, runoutEstimate: movementAnalysis.runoutEstimate, forecastWithheldReason: movementAnalysis.forecastWithheldReason, density: item.density, densityRecordedAt: item.densityRecordedAt?.toISOString() ?? null, densityMissing, recentReceipts, ambiguousReceipts, priorityScore, priorityReasons, relatedMovements: { opening: item.opening, receipts: item.receipts, sales: item.sales, approvedAdjustments: item.adjustments }, unverified: ["Physical measurement accuracy", ...(ambiguousReceipts.length ? ["Physical receipt arrival time"] : [])], asOf: scope.asOf };
    }).sort((left, right) => right.priorityScore - left.priorityScore || String(left.tankCode).localeCompare(String(right.tankCode))).map((item, index) => ({ ...item, priorityRank: index + 1 }));
  } else {
    const startDate = scope.startDate ?? scope.asOf.slice(0, 10);
    const endDate = scope.endDate ?? startDate;
    if (capability === "receivables" || capability === "payables" || capability === "profit") {
      const asOf = new Date(scope.asOf);
      const report = await buildReport(scope.organizationId, { startDate, endDate, stationId: scope.stationId, permittedStationIds: [scope.stationId], asOf });
      if (capability === "receivables") {
        const customerRecords = await customersBootstrap(scope.organizationId, [scope.stationId]);
        items = rankCustomerInvoiceAgeing(customerRecords.customers.map(customer => ({ stationId: scope.stationId, customerId: customer.id, customer: customer.name, outstanding: customer.outstanding, ageing: customer.ageing, creditLimit: Number(customer.creditLimit), invoices: buildCustomerInvoiceAgeing(customer, asOf) })));
      }
      else if (capability === "payables") items = report.payables.map(row => ({ stationId: scope.stationId, invoiceId: row.id, invoiceNumber: row.invoiceNumber, supplier: row.supplier, dueDate: row.dueDate, outstanding: row.outstanding, overdue: row.overdue }));
      else {
        const previous = await buildReport(scope.organizationId, { ...previousPeriod(startDate, endDate, scope.stationId), asOf });
        const components = [
          financialMovement("Revenue", report.financial.revenue, previous.financial.revenue),
          financialMovement("Cost of sales", report.financial.cogs, previous.financial.cogs),
          financialMovement("Operating expenses", report.financial.operatingExpenses, previous.financial.operatingExpenses),
          financialMovement("Net result", report.financial.netProfit, previous.financial.netProfit),
        ];
        const leadingComponent = [...components.slice(0, 3)].sort((left, right) => Math.abs(right.change) - Math.abs(left.change))[0]!;
        const netMovement = components[3]!;
        const materialChange = components.some(component => component.material);
        const topProduct = report.sales.byProduct[0] ?? null;
        const stationSales = report.sales.byStation.find(row => row.key === scope.stationId) ?? report.sales.byStation[0] ?? null;
        const fuelRevenue = report.sales.byProduct.filter(row => row.category === "FUEL").reduce((sum, row) => sum + row.revenue, 0);
        const nonFuelRevenue = report.sales.byProduct.filter(row => row.category !== "FUEL").reduce((sum, row) => sum + row.revenue, 0);
        const classifiedSalesRevenue = fuelRevenue + nonFuelRevenue;
        const observedContributions = {
          basis: "Recorded sales revenue; product-level costs are not allocated, so these are not profit contributions.",
          totalRecordedSalesRevenue: report.summary.grossSales,
          fuel: { amount: fuelRevenue, percent: share(fuelRevenue, report.summary.grossSales) },
          nonFuel: { amount: nonFuelRevenue, percent: share(nonFuelRevenue, report.summary.grossSales) },
          reconciliationDifference: classifiedSalesRevenue - report.summary.grossSales,
        };
        const quality = report.quality ?? { periodComplete: true, incompleteReason: null, missingCostOfSales: false, missingCostReason: null, salesToPostedRevenueDifference: report.financial.revenue - report.summary.grossSales, netProfitReconciliationDifference: 0 };
        items = [{
          stationId: scope.stationId, revenue: report.financial.revenue, cogs: report.financial.cogs, operatingExpenses: report.financial.operatingExpenses, netProfit: report.financial.netProfit,
          priorRevenue: previous.financial.revenue, priorCogs: previous.financial.cogs, priorOperatingExpenses: previous.financial.operatingExpenses, priorNetProfit: previous.financial.netProfit,
          componentMovements: components, netProfitChange: netMovement.change, netProfitChangePercent: netMovement.changePercent, materialChange,
          leadingComponent: leadingComponent.label, leadingComponentChange: leadingComponent.change,
          priorityRank: materialChange ? 1 : null, priorityReasons: materialChange ? [`${leadingComponent.label} has the largest absolute movement among revenue, cost of sales, and operating expenses`, "FuelNerve's materiality rule was crossed"] : [],
          topProduct: topProduct?.product ?? null, topProductContribution: topProduct ? share(topProduct.revenue, report.financial.revenue) : null,
          stationContribution: stationSales ? share(stationSales.amount, report.financial.revenue) : null,
          observedContributions,
          reportQuality: quality,
          comparison: { equivalentCalendarDays: true, current: report.filter, previous: previous.filter, reliableForInterpretation: quality.periodComplete && !quality.missingCostOfSales },
          possibleCauses: [],
          unverified: ["Operational cause of each change", "Causal effect of fuel versus non-fuel mix", ...(quality.periodComplete ? [] : ["Full-period result"]), ...(quality.missingCostOfSales ? ["Profit result until missing costs are posted"] : [])],
          relatedPostedAccounts: report.financial.accounts.filter(row => Math.abs(row.balance) > .005).sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance)).slice(0, 5).map(row => ({ code: row.code, name: row.name, balance: row.balance })),
          reportPeriod: { startDate, endDate }, previousPeriod: previous.filter,
        }];
      }
    } else if (capability === "purchase-review") {
      const value = await purchasesBootstrap(scope.organizationId, [scope.stationId]);
      const invoices: PurchaseReviewInvoice[] = value.invoices.map(invoice => ({ id: invoice.id, supplierId: invoice.supplier.id, supplier: invoice.supplier.name, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate.toISOString(), dueDate: invoice.dueDate.toISOString(), totalAmount: Number(invoice.totalAmount), outstanding: invoice.outstanding, status: invoice.status, receiptId: invoice.receipt?.id ?? null, correctionCount: invoice.corrections.length, lines: invoice.lines.map(line => ({ id: line.id, productId: line.productId, product: line.product?.name ?? line.description, unit: line.product?.unit ?? "unit", quantity: Number(line.quantity), receivedQuantity: invoice.receipt?.lines.filter(receiptLine => receiptLine.productId === line.productId).reduce((sum, receiptLine) => sum + Number(receiptLine.quantity), 0) ?? 0, unitCost: Number(line.unitCost), agreedRate: line.product ? Number(effectivePurchaseRate(line.product.purchasePrice, line.product.purchasePriceHistory, invoice.invoiceDate)) : null, taxRate: Number(line.taxRate), agreedTaxRate: line.product?.taxCategory ? Number(line.product.taxCategory.rate) : null })) }));
      const unmatched = value.unmatchedReceipts.map(receipt => ({ id: receipt.id, supplier: receipt.supplierName, referenceNo: receipt.referenceNo, receivedAt: receipt.receivedAt.toISOString(), lines: receipt.lines.map(line => ({ productId: line.productId, product: line.product.name, unit: line.product.unit, quantity: Number(line.quantity) })) }));
      items = analyzePurchases(invoices, unmatched, new Date(scope.asOf)).map(item => ({ stationId: scope.stationId, ...item }));
    } else if (capability === "purchase-price") {
      const value = await purchasesBootstrap(scope.organizationId, [scope.stationId]);
      items = value.products.map(product => ({ stationId: scope.stationId, productId: product.id, product: product.name, effectivePrice: Number(product.purchasePriceHistory[0]?.price ?? product.purchasePrice), history: product.purchasePriceHistory.map(row => ({ price: Number(row.price), effectiveFrom: row.effectiveFrom.toISOString() })) }));
    } else {
      const value = await receiptTimingAudit(scope.organizationId, [scope.stationId]);
      items = value.candidates.map(row => ({ stationId: row.station.id, receiptId: row.id, invoiceNumber: row.invoiceNumber, supplierName: row.supplierName, anomaly: true, candidateCount: 1, reason: row.reason, receivedAt: row.receivedAt.toISOString(), enteredAt: row.enteredAt.toISOString(), suspectedShift: row.suspectedShift, affectedTanks: row.affectedTanks }));
      if (!items.length) items = [{ stationId: scope.stationId, anomaly: false, candidateCount: 0 }];
    }
  }
  return { data: { organizationId: scope.organizationId, asOf: scope.asOf, items }, evidence: supportingEvidence, calculatedAt };
}

function effectivePurchaseRate(base: unknown, history: Array<{ price: unknown; effectiveFrom: Date }>, at: Date) {
  return history.filter(row => row.effectiveFrom <= at).sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime())[0]?.price ?? base;
}

function openShiftOverdueMinutesLabel() { return "12-hour"; }

function makeShiftEvidence(scope: Scope, shiftId: string, shiftNumber: number, status: string): Evidence {
  const resourceId = `${scope.stationId}:shift:${shiftId}`;
  const page = status === "OPEN" ? "/operations" : "/reconciliation";
  return { evidenceId: `fn_${createHash("sha256").update(`${scope.organizationId}:${resourceId}`).digest("hex").slice(0, 32)}`, evidenceType: "SHIFT", applicationId: "fuelnerve", tenantId: scope.organizationId, resourceId, label: `Shift ${shiftNumber} records`, observedAt: scope.asOf, resolverPath: `${page}?shiftId=${encodeURIComponent(shiftId)}` };
}

function makeEvidence(capability: Exclude<NerveReadCapability, "evidence">, scope: Scope): Evidence {
  const resourceId = `${scope.stationId}:${capability}`;
  const evidenceId = `fn_${createHash("sha256").update(`${scope.organizationId}:${resourceId}`).digest("hex").slice(0, 32)}`;
  return { evidenceId, evidenceType: capability.toUpperCase(), applicationId: "fuelnerve", tenantId: scope.organizationId, resourceId, label: `FuelNerve ${capability} records`, observedAt: scope.asOf, ...(scope.startDate ? { periodStart: scope.startDate } : {}), ...(scope.endDate ? { periodEnd: scope.endDate } : {}), resolverPath: pageByCapability[capability] };
}

async function resolveEvidence(scope: Scope) {
  if (!scope.evidenceId) throw new AppError(400, "NERVE_EVIDENCE_REQUIRED", "An evidence identifier is required.");
  const pageEvidence = (Object.keys(pageByCapability) as Array<Exclude<NerveReadCapability, "evidence">>).map(capability => makeEvidence(capability, scope)).find(item => item.evidenceId === scope.evidenceId);
  if (pageEvidence) return { data: { organizationId: scope.organizationId, stationId: scope.stationId, found: true, evidenceId: scope.evidenceId }, evidence: [pageEvidence], calculatedAt: new Date().toISOString() };

  // Shift findings use a record-specific evidence ID. Resolve it only after
  // re-reading shifts within the already-authorized organization and station.
  const [reconciliation, openShifts] = await Promise.all([
    reconciliationBootstrap(scope.organizationId, [scope.stationId]),
    openShiftsForNerve(scope.organizationId, scope.stationId, new Date(scope.asOf)),
  ]);
  const shiftEvidence = [
    ...reconciliation.shifts.filter(shift => shift.station.id === scope.stationId).map(shift => makeShiftEvidence(scope, shift.id, shift.shiftNumber, shift.status)),
    ...openShifts.map(shift => makeShiftEvidence(scope, shift.shiftId, shift.shiftNumber, "OPEN")),
  ];
  const evidence = shiftEvidence.find(item => item.evidenceId === scope.evidenceId);
  return { data: { organizationId: scope.organizationId, stationId: scope.stationId, found: Boolean(evidence), evidenceId: scope.evidenceId }, evidence: evidence ? [evidence] : [], calculatedAt: new Date().toISOString() };
}

function previousPeriod(startDate: string, endDate: string, stationId: string) {
  const start = new Date(`${startDate}T00:00:00`), end = new Date(`${endDate}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setDate(previousStart.getDate() - days + 1);
  return { startDate: localDate(previousStart), endDate: localDate(previousEnd), stationId, permittedStationIds: [stationId] };
}

function financialMovement(label: string, current: number, previous: number) {
  const change = current - previous;
  const changePercent = Math.abs(previous) > .005 ? change / Math.abs(previous) * 100 : null;
  const material = Math.abs(change) > .005 && (changePercent === null || Math.abs(changePercent) >= 10);
  return { label, current, previous, change, changePercent, material };
}

function share(value: number, total: number) { return Math.abs(total) > .005 ? value / total * 100 : null; }
function localDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
