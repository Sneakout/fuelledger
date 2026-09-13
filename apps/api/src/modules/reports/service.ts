import { prisma } from '../../lib/prisma.js';
import { effectivePriceAt } from '../../lib/effective-price.js';
import { AppError } from '../../lib/errors.js';

type ReportFilter = { startDate: string; endDate: string; stationId?: string | undefined; permittedStationIds?: string[] | undefined; asOf?: Date | undefined };

const number = (value: unknown) => Number(value ?? 0);
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);
const add = <T>(map: Map<string, T>, key: string, make: () => T, update: (row: T) => void) => {
  const row = map.get(key) ?? make(); update(row); map.set(key, row);
};
const optionalReportRows = async <T>(query: PromiseLike<T[]>): Promise<{ rows: T[]; available: boolean }> => {
  try { return { rows: await query, available: true }; }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'P2021' || code === 'P2022') return { rows: [], available: false };
    throw error;
  }
};

export async function buildReport(organizationId: string, filter: ReportFilter) {
  const asOf = filter.asOf ?? new Date();
  const start = new Date(`${filter.startDate}T00:00:00`);
  const endExclusive = new Date(`${filter.endDate}T00:00:00`); endExclusive.setDate(endExclusive.getDate() + 1);
  const stationIds=filter.stationId?[filter.stationId]:filter.permittedStationIds;
  const stationWhere = stationIds ? { stationId: { in: stationIds } } : {};
  const period = { gte: start, lt: endExclusive };
  const station = filter.stationId ? await prisma.station.findFirst({ where: { id: filter.stationId, organizationId,...(filter.permittedStationIds?{id:{in:filter.permittedStationIds}}:{}) } }) : null;
  if (filter.stationId && !station) throw new Error('REPORT_STATION_NOT_FOUND');

  const [stations, sales, expenses, periodInvoices, openInvoices, inventoryEntries, tanks, customers, journalLines, shifts, tankReadings, densityReadings, purchaseDetails, approvalRows, customerLedger, supplierPayments, investigationRows, briefingRows, alertRows] = await Promise.all([
    prisma.station.findMany({ where: { organizationId, active: true,...(stationIds?{id:{in:stationIds}}:{}) }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.sale.findMany({ where: { organizationId, ...stationWhere, occurredAt: period }, include: { station: { select: { id: true, name: true, code: true } }, product: { select: { id: true, name: true, code: true, unit: true, category: true, hsnCode: true, taxCategory: { select: { name: true, rate: true } } } } }, orderBy: { occurredAt: 'asc' } }),
    prisma.expense.findMany({
      where: { organizationId, ...stationWhere, incurredAt: period },
      include: { category: { select: { name: true, code: true } }, station: { select: { name: true, code: true } } },
    }),
    prisma.purchaseInvoice.findMany({ where: { organizationId, ...stationWhere, invoiceDate: period, status: { not: 'VOID' } }, select: { totalAmount: true } }),
    prisma.purchaseInvoice.findMany({ where: { organizationId, ...stationWhere, status: { in: ['OPEN', 'PART_PAID'] } }, include: { payments: { select: { amount: true } }, supplier: { select: { name: true, code: true } }, station: { select: { name: true, code: true } } }, orderBy: { dueDate: 'asc' } }),
    prisma.inventoryLedger.findMany({ where: { organizationId, ...stationWhere, occurredAt: { lte: asOf }, station: { active: true }, product: { active: true, inventoryTracked: true }, OR: [{ tankId: null }, { tank: { status: 'ACTIVE', configuration: { active: true } } }] }, include: { product: { select: { id: true, name: true, code: true, unit: true, tankLinked: true, purchasePrice: true, purchasePriceHistory:{where:{effectiveFrom:{lte:asOf}},orderBy:{effectiveFrom:'desc'},take:1} } }, station: { select: { id: true, name: true, code: true } }, tank: { select: { productId: true, configuration: { select: { stationId: true } } } } } }),
    prisma.tank.findMany({ where: { status: 'ACTIVE', product: { active: true, inventoryTracked: true }, configuration: { active: true, station: { organizationId, active: true, ...(stationIds ? { id:{in:stationIds} } : {}) } } }, include: { product: { select: { id: true, name: true, code: true, unit: true, purchasePrice: true, purchasePriceHistory:{where:{effectiveFrom:{lte:asOf}},orderBy:{effectiveFrom:'desc'},take:1} } }, configuration: { include: { station: { select: { id: true, name: true, code: true } } } } } }),
    prisma.customer.findMany({ where: { organizationId, active: true }, include: { ledger: { where: stationIds ? { stationId:{in:stationIds} } : {}, select: { stationId: true, amount: true, dueDate: true } } }, orderBy: { name: 'asc' } }),
    prisma.journalLine.findMany({ where: { journal: { organizationId, ...stationWhere, journalDate: period } }, include: { account: { select: { code: true, name: true, type: true } }, journal: { select: { id: true, journalDate: true, reference: true, description: true, sourceType: true, sourceId: true, station: { select: { name: true, code: true } }, createdBy: { select: { name: true } } } } } }),
    prisma.shift.findMany({
      where: { station: { organizationId }, ...stationWhere, openedAt: period },
      include: {
        station: { select: { name: true, code: true } }, manager: { select: { name: true } },
        sales: { select: { totalAmount: true, paymentMethod: true } },
        nozzleReadings: { include: { nozzle: { include: { product: { select: { name: true, code: true } }, dispenser: { select: { code: true } } } } } },
        tankReadings: { include: { tank: { include: { product: { select: { name: true, code: true } } } } } },
        reconciliation: { include: { reconciledBy: { select: { name: true } }, collections: true } },
      }, orderBy: { openedAt: 'desc' },
    }),
    prisma.tankReading.findMany({
      where: { organizationId, ...stationWhere, recordedAt: period },
      include: { station: { select: { name: true, code: true } }, tank: { include: { product: { select: { name: true, code: true, unit: true } } } }, recordedBy: { select: { name: true } } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.tankDensityReading.findMany({
      where: { organizationId, ...stationWhere, recordedAt: period },
      include: { station: { select: { name: true, code: true } }, tank: { include: { product: { select: { name: true, code: true } } } }, recordedBy: { select: { name: true } } },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.purchaseInvoice.findMany({
      where: { organizationId, ...stationWhere, invoiceDate: period, status: { not: 'VOID' } },
      include: { station: { select: { name: true, code: true } }, supplier: { select: { name: true, code: true } }, lines: { include: { product: { select: { name: true, code: true, unit: true } } } }, payments: { select: { amount: true } }, receipt: { include: { lines: { include: { product: { select: { name: true, code: true, unit: true } } } } } } },
      orderBy: { invoiceDate: 'desc' },
    }),
    optionalReportRows(prisma.approvalRequest.findMany({
      where: { organizationId, ...(stationIds ? { stationId: { in: stationIds } } : {}), requestedAt: period },
      include: { station: { select: { name: true, code: true } }, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
      orderBy: { requestedAt: 'desc' },
    })),
    prisma.customerLedgerEntry.findMany({
      where: { organizationId, ...stationWhere, occurredAt: period },
      include: { station: { select: { name: true, code: true } }, customer: { select: { name: true, code: true } }, sale: { select: { id: true } }, receipt: { select: { id: true, referenceNo: true } }, createdBy: { select: { name: true } } },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId, ...stationWhere, paidAt: period },
      include: { station: { select: { name: true, code: true } }, supplier: { select: { name: true, code: true } }, invoice: { select: { invoiceNumber: true } }, createdBy: { select: { name: true } } },
      orderBy: { paidAt: 'asc' },
    }),
    optionalReportRows(prisma.intelligenceInvestigation.findMany({ where: { organizationId, ...(stationIds ? { stationId: { in: stationIds } } : {}), createdAt: period }, include: { station: { select: { name: true, code: true } }, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' } })),
    optionalReportRows(prisma.dailyOwnerBriefing.findMany({ where: { organizationId, briefingDate: period }, orderBy: { calculatedAt: 'desc' } })),
    optionalReportRows(prisma.ownerAlert.findMany({ where: { organizationId, ...(stationIds ? { OR: [{ stationId: { in: stationIds } }, { stationId: null }] } : {}), createdAt: period }, include: { station: { select: { name: true, code: true } } }, orderBy: { createdAt: 'desc' } })),
  ]);
  const approvals = approvalRows.rows, investigations = investigationRows.rows, briefings = briefingRows.rows, alerts = alertRows.rows;
  const unavailableReportSections = [!approvalRows.available ? 'Approval history' : null, !investigationRows.available ? 'Owner investigations' : null, !briefingRows.available ? 'Nerve Intelligence reports' : null, !alertRows.available ? 'Attention history' : null].filter((value): value is string => Boolean(value));

  const salesByProduct = new Map<string, { key: string; product: string; code: string; unit: string; category: string; quantity: number; revenue: number }>();
  const salesByPayment = new Map<string, { key: string; method: string; transactions: number; amount: number }>();
  const dailySales = new Map<string, { key: string; date: string; transactions: number; amount: number }>();
  const stationSales = new Map<string, { key: string; station: string; code: string; transactions: number; amount: number }>();
  for (const sale of sales) {
    add(salesByProduct, sale.productId, () => ({ key: sale.productId, product: sale.product.name, code: sale.product.code, unit: sale.product.unit, category: sale.product.category, quantity: 0, revenue: 0 }), row => { row.quantity += number(sale.quantity); row.revenue += number(sale.totalAmount); });
    add(salesByPayment, sale.paymentMethod, () => ({ key: sale.paymentMethod, method: sale.paymentMethod, transactions: 0, amount: 0 }), row => { row.transactions += 1; row.amount += number(sale.totalAmount); });
    const day = `${sale.occurredAt.getFullYear()}-${String(sale.occurredAt.getMonth()+1).padStart(2,'0')}-${String(sale.occurredAt.getDate()).padStart(2,'0')}`;
    add(dailySales, day, () => ({ key: day, date: day, transactions: 0, amount: 0 }), row => { row.transactions += 1; row.amount += number(sale.totalAmount); });
    add(stationSales, sale.stationId, () => ({ key: sale.stationId, station: sale.station.name, code: sale.station.code, transactions: 0, amount: 0 }), row => { row.transactions += 1; row.amount += number(sale.totalAmount); });
  }

  const expenseByCategory = new Map<string, { key: string; category: string; amount: number }>();
  for (const expense of expenses) add(expenseByCategory, expense.category.code, () => ({ key: expense.category.code, category: expense.category.name, amount: 0 }), row => { row.amount += number(expense.amount); });

  const stock = new Map<string, { key: string; product: string; code: string; unit: string; station: string; stationCode: string; quantity: number; value: number; purchasePrice: number }>();
  const stockKey = (stationId: string, productId: string) => `${stationId}:${productId}`;
  for (const tank of tanks) {
    const itemKey = stockKey(tank.configuration.station.id, tank.productId);
    const purchasePrice=effectivePriceAt(tank.product.purchasePrice,tank.product.purchasePriceHistory);
    add(stock, itemKey, () => ({ key: itemKey, product: tank.product.name, code: tank.product.code, unit: tank.product.unit, station: tank.configuration.station.name, stationCode: tank.configuration.station.code, quantity: 0, value: 0, purchasePrice: number(purchasePrice) }), row => { row.quantity += number(tank.openingStock); row.value+=number(tank.openingStock)*number(purchasePrice); });
  }
  for (const entry of inventoryEntries) {
    if ((entry.product.tankLinked && !entry.tankId) || (entry.tankId && (!entry.tank || entry.tank.productId !== entry.productId || entry.tank.configuration.stationId !== entry.stationId)))
      throw new AppError(409, 'STOCK_SCOPE_INVALID', 'A stock movement does not match its fuel station, product and tank. Review inventory consistency before continuing.');
    const itemKey = stockKey(entry.stationId, entry.productId);
    const purchasePrice=effectivePriceAt(entry.product.purchasePrice,entry.product.purchasePriceHistory);
    add(stock, itemKey, () => ({ key: itemKey, product: entry.product.name, code: entry.product.code, unit: entry.product.unit, station: entry.station.name, stationCode: entry.station.code, quantity: 0, value: 0, purchasePrice: number(purchasePrice) }), row => { const quantity=number(entry.quantityDelta),unitCost=number(entry.unitCost??purchasePrice);row.quantity+=quantity;row.value+=quantity*unitCost; });
  }
  const inventory = [...stock.values()].sort((a, b) => b.value - a.value);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const customerAgeing = customers.map(customer => {
    const outstanding = sum(customer.ledger, row => number(row.amount));
    const ageing = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    for (const row of customer.ledger.filter(item => number(item.amount) > 0)) {
      const days = row.dueDate ? Math.floor((today.getTime() - row.dueDate.getTime()) / 86400000) : 0;
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'days1to30' : days <= 60 ? 'days31to60' : days <= 90 ? 'days61to90' : 'days90plus';
      ageing[bucket] += number(row.amount);
    }
    const receipts = Math.abs(sum(customer.ledger.filter(row => number(row.amount) < 0), row => number(row.amount)));
    let remaining = receipts;
    for (const bucket of ['days90plus', 'days61to90', 'days31to60', 'days1to30', 'current'] as const) { const applied = Math.min(ageing[bucket], remaining); ageing[bucket] -= applied; remaining -= applied; }
    return { id: customer.id, customer: customer.name, code: customer.code, type: customer.type, outstanding, ageing };
  }).filter(row => row.outstanding > .005).sort((a, b) => b.outstanding - a.outstanding);

  const payables = openInvoices.map(invoice => {
    const outstanding = number(invoice.totalAmount) - sum(invoice.payments, row => number(row.amount));
    return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, supplier: invoice.supplier.name, station: invoice.station.name, dueDate: invoice.dueDate.toISOString(), outstanding, overdue: invoice.dueDate < today };
  }).filter(row => row.outstanding > .005);

  const accountTotals = new Map<string, { code: string; name: string; type: string; debit: number; credit: number; balance: number }>();
  for (const line of journalLines) add(accountTotals, line.account.code, () => ({ code: line.account.code, name: line.account.name, type: line.account.type, debit: 0, credit: 0, balance: 0 }), row => { row.debit += number(line.debit); row.credit += number(line.credit); });
  for (const row of accountTotals.values()) row.balance = row.type === 'REVENUE' || row.type === 'LIABILITY' ? row.credit - row.debit : row.debit - row.credit;
  const revenue = sum([...accountTotals.values()].filter(row => row.type === 'REVENUE'), row => row.balance);
  const cogs = accountTotals.get('5000')?.balance ?? 0;
  const operatingExpenses = accountTotals.get('6100')?.balance ?? 0;
  const grossSales = sum(sales, row => number(row.totalAmount));
  const todayStart = new Date(asOf); todayStart.setHours(0, 0, 0, 0);
  const periodComplete = endExclusive <= todayStart;
  const missingCostOfSales = grossSales > .005 && (!accountTotals.has('5000') || cogs <= .005);
  const netProfitReconciliationDifference = (revenue - cogs - operatingExpenses) - (revenue - cogs - operatingExpenses);

  const shiftReports = shifts.map(shift => {
    const expected = sum(shift.reconciliation?.collections ?? [], row => number(row.expectedAmount));
    const actual = sum(shift.reconciliation?.collections ?? [], row => number(row.actualAmount));
    return {
      id: shift.id, shiftNumber: shift.shiftNumber, station: shift.station.name, stationCode: shift.station.code,
      manager: shift.manager.name, status: shift.status, openedAt: shift.openedAt.toISOString(), closedAt: shift.closedAt?.toISOString() ?? null,
      openingCash: number(shift.openingCash), closingCash: shift.closingCash === null ? null : number(shift.closingCash),
      sales: sum(shift.sales, row => number(row.totalAmount)), expectedCollection: expected, actualCollection: actual,
      variance: actual - expected, reconciledAt: shift.reconciliation?.reconciledAt.toISOString() ?? null,
      reconciledBy: shift.reconciliation?.reconciledBy.name ?? null, notes: shift.reconciliation?.notes ?? shift.notes ?? null,
      collections: shift.reconciliation?.collections.map(row => ({ paymentMethod: row.paymentMethod, expected: number(row.expectedAmount), actual: number(row.actualAmount), adjustment: number(row.adjustmentAmount), variance: number(row.varianceAmount), reason: row.adjustmentReason })) ?? [],
      nozzles: shift.nozzleReadings.map(row => ({ dispenser: row.nozzle.dispenser.code, nozzle: row.nozzle.code, product: row.nozzle.product.name, productCode: row.nozzle.product.code, opening: number(row.openingMeter), closing: row.closingMeter === null ? null : number(row.closingMeter), testing: number(row.testingQuantity), testingReturned: row.testingReturned })),
      tanks: shift.tankReadings.map(row => ({ tank: row.tank.code, product: row.tank.product.name, productCode: row.tank.product.code, opening: number(row.openingDip), closing: row.closingDip === null ? null : number(row.closingDip) })),
    };
  });
  const tax = [...salesByProduct.values()].map(row => {
    const productSales = sales.filter(sale => sale.productId === row.key);
    const product = productSales[0]?.product;
    const petroleumNonGst = product?.category === 'FUEL';
    const treatment = petroleumNonGst ? 'STATE_PETROLEUM_TAX' : product?.taxCategory ? `GST ${number(product.taxCategory.rate)}%` : 'GST_REVIEW_REQUIRED';
    return { product: row.product, code: row.code, hsnCode: product?.hsnCode ?? null, treatment, quantity: row.quantity, turnover: row.revenue };
  });

  const forecastWindowStart = new Date(asOf); forecastWindowStart.setDate(forecastWindowStart.getDate() - 14);
  const sellingDays = new Map<string, Map<string, number>>();
  for (const entry of inventoryEntries.filter(row => row.type === 'SALE' && row.occurredAt >= forecastWindowStart && row.occurredAt <= asOf)) {
    const key = stockKey(entry.stationId, entry.productId);
    const day = entry.occurredAt.toISOString().slice(0, 10);
    const days = sellingDays.get(key) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + Math.abs(number(entry.quantityDelta)));
    sellingDays.set(key, days);
  }
  const runoutForecasts = inventory.map(item => {
    const days = sellingDays.get(item.key) ?? new Map<string, number>();
    const totalConsumption = sum([...days.values()], value => value);
    const averageDailyConsumption = days.size ? totalConsumption / days.size : null;
    const sufficientData = days.size >= 7 && averageDailyConsumption !== null && averageDailyConsumption > 0;
    return {
      station: item.station, stationCode: item.stationCode, product: item.product, productCode: item.code, unit: item.unit,
      currentQuantity: item.quantity, sellingDaysObserved: days.size, lookbackDays: 14,
      averageDailyConsumption: sufficientData ? averageDailyConsumption : null,
      estimatedDaysRemaining: sufficientData ? Math.max(0, item.quantity / averageDailyConsumption) : null,
      status: sufficientData ? (item.quantity <= 0 ? 'Empty' : 'Estimate available') : 'Not enough sales history',
      assumption: sufficientData
        ? 'Uses recorded SALE stock movements from the previous 14 days and assumes the observed selling-day average continues.'
        : `Forecast withheld: at least 7 selling days are required; ${days.size} were available.`,
    };
  });

  const liquidAccountCodes = new Set(['1000', '1010', '1020', '1030']);
  const openingLiquidPosition = sum([...accountTotals.values()].filter(row => liquidAccountCodes.has(row.code)), row => row.balance);
  const sevenDayEnd = new Date(asOf); sevenDayEnd.setDate(sevenDayEnd.getDate() + 7);
  const thirtyDayEnd = new Date(asOf); thirtyDayEnd.setDate(thirtyDayEnd.getDate() + 30);
  const dueWithin = (until: Date) => sum(payables.filter(row => new Date(row.dueDate) <= until), row => row.outstanding);
  const cashFlowForecast = {
    asOf: asOf.toISOString(), openingLiquidPosition, supplierPaymentsDueIn7Days: dueWithin(sevenDayEnd), supplierPaymentsDueIn30Days: dueWithin(thirtyDayEnd),
    conservativePositionAfter7Days: openingLiquidPosition - dueWithin(sevenDayEnd),
    conservativePositionAfter30Days: openingLiquidPosition - dueWithin(thirtyDayEnd),
    customerReceiptsIncluded: false,
    assumption: 'Conservative forecast: posted cash, bank and clearing balances less open supplier invoices due by each horizon. Unscheduled customer receipts are excluded.',
    warning: 'This is a management forecast, not a bank balance. Customer receipts, payroll, tax and unposted commitments are excluded unless already posted or invoiced.',
  };

  const stationComparison = stations.map(item => {
    const stationInventory = inventory.filter(row => row.stationCode === item.code);
    const stationCustomerBalance = sum(customers.flatMap(customer => customer.ledger.filter(row => row.stationId === item.id)), row => number(row.amount));
    const stationPayables = sum(payables.filter(row => row.station === item.name), row => row.outstanding);
    const stationShifts = shiftReports.filter(row => row.stationCode === item.code);
    const stationSale = stationSales.get(item.id);
    return { station: item.name, stationCode: item.code, sales: stationSale?.amount ?? 0, transactions: stationSale?.transactions ?? 0, inventoryValue: sum(stationInventory, row => row.value), receivables: stationCustomerBalance, payables: stationPayables, shiftVariance: sum(stationShifts, row => row.variance), shiftsReviewed: stationShifts.length };
  });

  const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const stationName = (scope: string) => scope === 'ALL' ? 'All fuel stations' : stations.find(item => item.id === scope)?.name ?? 'Selected fuel station';
  const specialistReports = briefings.flatMap(row => {
    const narrative = record(row.narrative);
    const actions = new Map((Array.isArray(narrative?.items) ? narrative.items : []).flatMap(item => { const value = record(item); return value ? [[text(value.factId), text(value.action)]] as const : []; }));
    const headline = text(narrative?.headline) || 'Daily business review';
    const summary = text(narrative?.summary) || 'FuelNerve reviewed the available business records.';
    return (Array.isArray(row.facts) ? row.facts : []).flatMap(item => {
      const fact = record(item); if (!fact) return [];
      const label = text(fact.label), value = text(fact.value), context = text(fact.context), evidence = text(fact.evidenceLabel);
      if (!label || !context) return [];
      return [{ briefingDate: row.briefingDate.toISOString(), calculatedAt: row.calculatedAt.toISOString(), station: stationName(row.stationScope), headline, summary, priority: text(fact.severity).toLowerCase() || 'information', finding: value ? `${label}: ${value}` : label, explanation: context, nextStep: actions.get(text(fact.id)) || (evidence ? `Review ${evidence.toLowerCase()}.` : 'Review the supporting business records.'), supportingRecord: evidence || 'Business records' }];
    });
  });
  const investigationPacks = investigations.map(row => {
    const result = record(row.result);
    const lines = (value: unknown) => (Array.isArray(value) ? value : []).flatMap(item => { const entry = record(item); const valueText = text(entry?.text); return valueText ? [valueText] : []; });
    const observations = lines(result?.observations), unknowns = lines(result?.unknowns), nextChecks = lines(result?.nextChecks);
    return { station: row.station.name, subject: row.subject, requestedBy: row.user.name, createdAt: row.createdAt.toISOString(), findings: observations.join(' ') || 'No supported conclusion was available from the selected records.', informationMissing: unknowns.join(' ') || 'None recorded.', nextStep: nextChecks.join(' ') || 'Open the supporting records and confirm they are current.' };
  });
  const anomalyTrends = alerts.map(row => ({ station: row.station?.name ?? 'All fuel stations', severity: row.severity.toLowerCase(), title: row.title, message: row.message, supportingRecord: row.evidenceLabel, createdAt: row.createdAt.toISOString(), status: row.resolvedAt ? 'Resolved' : row.acknowledgedAt ? 'Acknowledged' : row.readAt ? 'Read' : 'Needs attention', resolvedAt: row.resolvedAt?.toISOString() ?? null }));

  return {
    filter: { startDate:filter.startDate,endDate:filter.endDate,...(filter.stationId?{stationId:filter.stationId}:{}), station: station ? { id: station.id, name: station.name, code: station.code } : null }, stations,
    summary: { grossSales, transactions: sales.length, meteredVolume: sum(sales.filter(row => row.kind === 'METERED'), row => number(row.quantity)), purchases: sum(periodInvoices, row => number(row.totalAmount)), expenses: sum(expenses, row => number(row.amount)), receivables: sum(customerAgeing, row => row.outstanding), payables: sum(payables, row => row.outstanding), inventoryValue: sum(inventory, row => row.value), grossProfit: revenue - cogs, netProfit: revenue - cogs - operatingExpenses },
    sales: { byProduct: [...salesByProduct.values()].sort((a, b) => b.revenue - a.revenue), byPayment: [...salesByPayment.values()].sort((a, b) => b.amount - a.amount), daily: [...dailySales.values()], byStation: [...stationSales.values()].sort((a, b) => b.amount - a.amount) },
    inventory, customers: customerAgeing, payables, expenses: [...expenseByCategory.values()].sort((a, b) => b.amount - a.amount),
    financial: { accounts: [...accountTotals.values()].sort((a, b) => a.code.localeCompare(b.code)), revenue, cogs, operatingExpenses, grossProfit: revenue - cogs, netProfit: revenue - cogs - operatingExpenses },
    operations: {
      shifts: shiftReports,
      tankReadings: tankReadings.map(row => ({ id: row.id, station: row.station.name, stationCode: row.station.code, tank: row.tank.code, product: row.tank.product.name, productCode: row.tank.product.code, unit: row.tank.product.unit, physicalStock: number(row.physicalStock), dipReading: row.dipReading === null ? null : number(row.dipReading), recordedAt: row.recordedAt.toISOString(), recordedBy: row.recordedBy.name, notes: row.notes })),
      densityReadings: densityReadings.map(row => ({ id: row.id, station: row.station.name, stationCode: row.station.code, tank: row.tank.code, product: row.tank.product.name, productCode: row.tank.product.code, density: number(row.density), recordedAt: row.recordedAt.toISOString(), recordedBy: row.recordedBy.name })),
      purchases: purchaseDetails.map(invoice => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, station: invoice.station.name, stationCode: invoice.station.code, supplier: invoice.supplier.name, supplierCode: invoice.supplier.code, invoiceDate: invoice.invoiceDate.toISOString(), dueDate: invoice.dueDate.toISOString(), subtotal: number(invoice.subtotal), taxAmount: number(invoice.taxAmount), totalAmount: number(invoice.totalAmount), paidAmount: sum(invoice.payments, row => number(row.amount)), status: invoice.status, receivedAt: invoice.receipt?.receivedAt.toISOString() ?? null, lines: invoice.lines.map(line => ({ description: line.description, product: line.product?.name ?? null, productCode: line.product?.code ?? null, unit: line.product?.unit ?? null, quantity: number(line.quantity), unitCost: number(line.unitCost), taxRate: number(line.taxRate), hsnCode: line.hsnCode, lineTotal: number(line.lineTotal) })), receivedLines: invoice.receipt?.lines.map(line => ({ product: line.product.name, productCode: line.product.code, unit: line.product.unit, quantity: number(line.quantity), unitCost: number(line.unitCost) })) ?? [] })),
      approvals: approvals.map(row => ({ id: row.id, station: row.station.name, actionType: row.actionType, status: row.status, reason: row.reason, requestedBy: row.requestedBy.name, requestedAt: row.requestedAt.toISOString(), decidedBy: row.decidedBy?.name ?? null, decidedAt: row.decidedAt?.toISOString() ?? null, decisionNote: row.decisionNote, executedAt: row.executedAt?.toISOString() ?? null, version: row.version })),
      customerLedger: customerLedger.map(row => ({ id: row.id, station: row.station.name, stationCode: row.station.code, customer: row.customer.name, customerCode: row.customer.code, type: row.type, description: row.description, amount: number(row.amount), dueDate: row.dueDate?.toISOString() ?? null, disputedAt: row.disputedAt?.toISOString() ?? null, occurredAt: row.occurredAt.toISOString(), sourceType: row.saleId ? 'SALE' : row.receiptId ? 'RECEIPT' : 'SHIFT_ALLOCATION', sourceId: row.saleId ?? row.receiptId ?? row.shiftCreditAllocationId, referenceNo: row.receipt?.referenceNo ?? null, createdBy: row.createdBy.name })),
      supplierPayments: supplierPayments.map(row => ({ id: row.id, station: row.station.name, stationCode: row.station.code, supplier: row.supplier.name, supplierCode: row.supplier.code, invoiceNumber: row.invoice?.invoiceNumber ?? null, amount: number(row.amount), paymentMethod: row.paymentMethod, referenceNo: row.referenceNo, paidAt: row.paidAt.toISOString(), createdBy: row.createdBy.name })),
      accountingEntries: journalLines.map(row => ({ id: row.id, journalId: row.journal.id, date: row.journal.journalDate.toISOString(), station: row.journal.station?.name ?? 'Organization', stationCode: row.journal.station?.code ?? null, reference: row.journal.reference, description: row.journal.description, sourceType: row.journal.sourceType, sourceId: row.journal.sourceId, accountCode: row.account.code, accountName: row.account.name, accountType: row.account.type, debit: number(row.debit), credit: number(row.credit), memo: row.memo, createdBy: row.journal.createdBy?.name ?? 'System' })),
    },
    tax: { rows: tax, stateVatTurnover: sum(tax.filter(row => row.treatment === 'STATE_PETROLEUM_TAX'), row => row.turnover), gstReviewTurnover: sum(tax.filter(row => row.treatment !== 'STATE_PETROLEUM_TAX'), row => row.turnover), warning: 'Fuel-category turnover is separated for state petroleum-tax review. GST treatment for every other product must be confirmed from its configured tax category before filing.' },
    intelligence: { specialistReports, runoutForecasts, cashFlowForecast, stationComparison, investigationPacks, anomalyTrends },
    quality: { periodComplete, incompleteReason: periodComplete ? null : 'The selected period includes the current or a future business day.', missingCostOfSales, missingCostReason: missingCostOfSales ? 'Sales are recorded but no positive cost-of-sales posting is present for the selected period.' : null, salesToPostedRevenueDifference: revenue - grossSales, netProfitReconciliationDifference, unavailableReportSections },
  };
}
