import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AgentRegistry,
  CONTRACT_VERSION,
  FUELNERVE_APPLICATION_ID,
  FuelNerveReadOnlyAgentService,
  InMemoryAuditStore,
  InMemoryNonceStore,
  InMemoryReadOnlyFindingStore,
  InMemoryUsageStore,
  MockFuelNerveReadClient,
  NerveRuntime,
  StaticModelProvider,
  TenantUsageLimiter,
  ToolRegistry,
  createOwnerAssistantAgent,
  createCreditAgent,
  createPurchaseAgent,
  createProfitInsightAgent,
  createShiftReviewAgent,
  createStockWatchAgent,
  registerFuelNerveTools,
  signEnvelope,
  type AgentInvocation,
  type AgentNarrative,
  type JsonObject,
  type ModelGenerationRequest,
} from "../src/index.ts";

const signingKey = { keyId: "fuelnerve-agents-key", secret: "fuelnerve-agents-test-secret-long-enough" };
const scopes = ["dashboard:read", "reconciliation:read", "inventory:read", "customers:read", "purchases:read", "accounting:read", "evidence:read"];

test("Shift Review emits inspectable evidence-backed findings with no action authority", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("reconciliation-review", {}));
  assert.deepEqual(result.findings.map(item => item.type).sort(), ["COLLECTION_VARIANCE_DETECTED", "SHIFT_READINGS_MISSING", "SHIFT_RECONCILIATION_PENDING"]);
  assertFindingExperience(result.findings);
  assert.ok(result.findings.every(item => item.recommendedNextStep.includes("Open") || item.recommendedNextStep.includes("Review")));
});

test("Shift Review preserves FuelNerve's first-review ranking and comparison reason", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.shiftAndReconciliationStatus.bind(fixture.client);
  fixture.client.shiftAndReconciliationStatus = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    const item = (snapshot.data.items as JsonObject[])[0]!;
    item.priority = { shiftId: "shift-7", shiftNumber: 7, status: "RECONCILIATION_REQUIRED", awaitingMinutes: 185, missingReadings: 1, missingCollections: 2, collectionDifference: 50, locked: false, priorityReasons: ["Awaiting reconciliation for 185 minutes", "1 closing reading is missing", "Absolute collection difference is 50"], recordsToCompare: ["Closing readings", "Nozzle collections", "Payment-method totals"] };
    return snapshot;
  };
  const result = await fixture.service.run(invocation("reconciliation-review", {}));
  const priority = result.findings.find(item => item.type === "SHIFT_REVIEW_PRIORITY");
  assert.equal(priority?.priorityRank, 1);
  assert.equal(priority?.title, "Review Shift 7 first");
  assert.match(priority?.whyItMatters ?? "", /185 minutes/);
  assert.deepEqual(priority?.recordsToCompare, ["Closing readings", "Nozzle collections", "Payment-method totals"]);
});

test("Shift Review groups related exceptions into one exact shift briefing", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.shiftAndReconciliationStatus.bind(fixture.client);
  fixture.client.shiftAndReconciliationStatus = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    const evidence = snapshot.evidence[0]!;
    (snapshot.data.items as JsonObject[])[0]!.shiftBriefings = [{
      shiftId: "shift-7", shiftNumber: 7, stationId: "station-a1", stationName: "Station A", status: "RECONCILIATION_REQUIRED",
      openedAt: "2026-09-08T01:00:00.000Z", closedAt: "2026-09-08T06:00:00.000Z", awaitingMinutes: 185,
      missingReadings: 1, missingCollections: 2, collectionDifference: 50, handoverIncomplete: true, priorityRank: 1,
      priorityReasons: ["Awaiting reconciliation for 185 minutes", "1 closing reading is missing", "Absolute collection difference is 50"],
      recordsToCompare: ["Closing readings", "Nozzle collections", "Payment-method totals", "Shift handover"],
      issueTypes: ["RECONCILIATION_PENDING", "MISSING_READINGS", "MISSING_COLLECTIONS", "COLLECTION_DIFFERENCE", "HANDOVER_INCOMPLETE"], evidenceId: evidence.evidenceId,
    }];
    return snapshot;
  };
  const result = await fixture.service.run(invocation("reconciliation-review", {}));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.type, "SHIFT_REVIEW_BRIEFING");
  assert.equal(result.findings[0]!.title, "Review Shift 7");
  assert.equal(result.findings[0]!.stationId, "station-a1");
  assert.equal(result.findings[0]!.priorityRank, 1);
  assert.match(result.findings[0]!.whyItMatters, /50/);
  assert.match(result.findings[0]!.whyItMatters, /185 minutes/);
  assert.match(result.findings[0]!.whyItMatters, /missing closing reading/);
  assert.match(result.findings[0]!.recommendedNextStep, /Shift 7/);
  assert.ok(result.findings[0]!.supportingRecords.length > 0);
});

test("repeated Shift Review runs replace duplicate findings by stable source key", async () => {
  const fixture = serviceFixture();
  await fixture.service.run(invocation("reconciliation-review", {}));
  await fixture.service.run(invocation("reconciliation-review", {}));
  const stored = await fixture.store.list("org-a");
  assert.equal(new Set(stored.map(item => item.deduplicationKey)).size, stored.length);
  assert.equal(stored.length, 3);
});

test("Stock Watch reports only FuelNerve-calculated status and receipt-timing facts", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("inventory-watch", {}));
  assert.deepEqual(result.findings.map(item => item.type).sort(), ["DENSITY_READING_MISSING", "INVENTORY_LOW", "PHYSICAL_BOOK_VARIANCE"]);
  assertFindingExperience(result.findings);
  assert.equal(result.findings.find(item => item.type === "PHYSICAL_BOOK_VARIANCE")?.displayValue, -10);
});

test("Stock Watch preserves FuelNerve's top tank and related movement context", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.inventoryPosition.bind(fixture.client);
  fixture.client.inventoryPosition = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    const item = (snapshot.data.items as JsonObject[])[0]!;
    Object.assign(item, { tankId: "tank-1", tankCode: "T-1", productCode: "HSD", priorityRank: 1, priorityReasons: ["Recorded stock is low", "Physical and book stock differ by 10"], relatedMovements: { opening: 1000, receipts: 200, sales: 190, approvedAdjustments: 0 }, recentReceipts: [{ receiptId: "receipt-1" }], ambiguousReceipts: [], unverified: ["Physical measurement accuracy"] });
    return snapshot;
  };
  const result = await fixture.service.run(invocation("inventory-watch", {}));
  const priority = result.findings.find(item => item.type === "INVENTORY_REVIEW_PRIORITY");
  assert.equal(priority?.priorityRank, 1);
  assert.equal(priority?.title, "HSD T-1 needs attention first");
  assert.match(priority?.whyItMatters ?? "", /recorded stock is low/i);
  assert.deepEqual(priority?.unverified, ["Physical measurement accuracy"]);
});

test("Stock Watch keeps same-type findings unique across multiple tanks", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.inventoryPosition.bind(fixture.client);
  fixture.client.inventoryPosition = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    const first = (snapshot.data.items as JsonObject[])[0]!;
    snapshot.data.items = [{ ...first, tankId: "tank-1" }, { ...first, tankId: "tank-2" }];
    return snapshot;
  };
  const outcome = await fixture.service.run(invocation("inventory-watch", {}));
  const stored = await fixture.store.list("org-a");
  assert.equal(new Set(stored.map(item => item.deduplicationKey)).size, stored.length);
});

test("Stock Watch explains deterministic unusual movement evidence and an eligible runout estimate", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.inventoryPosition.bind(fixture.client);
  fixture.client.inventoryPosition = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    const item = (snapshot.data.items as JsonObject[])[0]!;
    Object.assign(item, {
      tankId: "tank-1", tankCode: "T-1", productCode: "HSD",
      unusualMovement: true,
      unusualMovementReasons: ["Recorded sales on 2026-09-07 were 900 L, at least twice the 300 L median of 7 prior selling days"],
      movementSample: { windowDays: 14, sellingDays: 8, latestSales: 900, priorSellingDays: 7, priorMedianDailySales: 300 },
      runoutEstimate: { estimatedDaysRemaining: 2.5, averageDailyConsumption: 400, sampleSellingDays: 8, windowDays: 14, assumption: "Current book stock divided by average recorded sales across 8 selling days in the last 14 days; no future receipt or demand change is assumed." },
    });
    return snapshot;
  };
  const result = await fixture.service.run(invocation("inventory-watch", {}));
  const movement = result.findings.find(item => item.type === "INVENTORY_MOVEMENT_UNUSUAL");
  const forecast = result.findings.find(item => item.type === "INVENTORY_RUNOUT_ESTIMATE");
  assert.match(movement?.whyItMatters ?? "", /900 L.*twice.*300 L median/i);
  assert.deepEqual(forecast?.displayValue, { estimatedDaysRemaining: 2.5, averageDailyConsumption: 400, sampleSellingDays: 8, windowDays: 14, assumption: "Current book stock divided by average recorded sales across 8 selling days in the last 14 days; no future receipt or demand change is assumed." });
  assert.match(forecast?.whyItMatters ?? "", /no future receipt or demand change is assumed/i);
});

test("Stock Watch publishes no runout estimate when FuelNerve withholds it", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.inventoryPosition.bind(fixture.client);
  fixture.client.inventoryPosition = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    Object.assign((snapshot.data.items as JsonObject[])[0]!, { runoutEstimate: null, forecastWithheldReason: "At least 7 selling days within the last 14 days are required." });
    return snapshot;
  };
  const result = await fixture.service.run(invocation("inventory-watch", {}));
  assert.equal(result.findings.some(item => item.type === "INVENTORY_RUNOUT_ESTIMATE"), false);
});

test("Profit Insight exposes journal-derived components, comparison, and contribution", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("profit-insight", { startDate: "2026-09-01", endDate: "2026-09-07" }));
  assert.deepEqual(result.findings.map(item => item.type), ["PROFIT_POSITION", "PROFIT_CHANGE_MATERIAL"]);
  const position = result.findings[0]!.displayValue as JsonObject;
  assert.deepEqual({ revenue: position.revenue, cogs: position.cogs, operatingExpenses: position.operatingExpenses, netProfit: position.netProfit }, { revenue: 1250, cogs: 1000, operatingExpenses: 125, netProfit: 125 });
  assert.equal(position.topProduct, "MS");
  assert.equal(result.findings[0]?.period.start, "2026-09-01");
  assert.equal(result.findings[0]?.period.end, "2026-09-07");
  const priority = result.findings.find(item => item.type === "PROFIT_CHANGE_MATERIAL");
  assert.equal(priority?.priorityRank, 1);
  assert.match(priority?.title ?? "", /^Review .* movement first$/);
  assertFindingExperience(result.findings);
});

test("Profit Insight separates observed sales contribution from causes and flags incomplete costs", async () => {
  const fixture = serviceFixture();
  const original = fixture.client.journalProfit.bind(fixture.client);
  fixture.client.journalProfit = async scope => {
    const snapshot = await original(scope, new AbortController().signal);
    const item = (snapshot.data.items as JsonObject[])[0]!;
    Object.assign(item, {
      observedContributions: { basis: "Recorded sales revenue; product-level costs are not allocated, so these are not profit contributions.", totalRecordedSalesRevenue: 1250, fuel: { amount: 1000, percent: 80 }, nonFuel: { amount: 250, percent: 20 }, reconciliationDifference: 0 },
      reportQuality: { periodComplete: false, incompleteReason: "The selected period includes the current business day.", missingCostOfSales: true, missingCostReason: "Sales are recorded but no positive cost-of-sales posting is present for the selected period." },
      possibleCauses: [],
      unverified: ["Operational cause of each change", "Full-period result", "Profit result until missing costs are posted"],
    });
    return snapshot;
  };
  const result = await fixture.service.run(invocation("profit-insight", { startDate: "2026-09-01", endDate: "2026-09-07" }));
  const position = result.findings.find(item => item.type === "PROFIT_POSITION")!;
  const incomplete = result.findings.find(item => item.type === "PROFIT_DATA_INCOMPLETE")!;
  const movement = result.findings.find(item => item.type === "PROFIT_CHANGE_MATERIAL")!;
  assert.deepEqual((position.displayValue as JsonObject).observedContributions, { basis: "Recorded sales revenue; product-level costs are not allocated, so these are not profit contributions.", totalRecordedSalesRevenue: 1250, fuel: { amount: 1000, percent: 80 }, nonFuel: { amount: 250, percent: 20 }, reconciliationDifference: 0 });
  assert.match(incomplete.whyItMatters, /current business day.*no positive cost-of-sales/i);
  assert.match(movement.whyItMatters, /observed change, not a proven cause/i);
  assert.deepEqual((movement.relatedContext as JsonObject).possibleCauses, []);
  assert.ok(movement.unverified?.includes("Operational cause of each change"));
});

test("Credit Agent creates an exact unsent reminder draft for a partially paid overdue invoice", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("credit-watch", {}));
  assert.equal(result.findings.length, 1);
  const credit = result.findings[0]!;
  assert.equal(credit.type, "CUSTOMER_INVOICE_OVERDUE");
  assert.equal(credit.title, "Arun Transport's invoice INV-1001 is overdue");
  assert.match(credit.whyItMatters, /₹500.*11 days.*partial payment.*₹300/i);
  const value = credit.displayValue as JsonObject;
  assert.equal(value.outstanding, 500);
  assert.equal(value.sendState, "NOT_SENT");
  assert.equal(value.sendingRequiresExplicitApproval, true);
  assert.match(String(value.reminderDraft), /Arun Transport.*₹500.*INV-1001.*31 August 2026/i);
  assertFindingExperience(result.findings);
});

test("Credit Agent excludes paid, disputed and not-yet-due invoices from owner actions", async () => {
  const fixture = serviceFixture();
  fixture.client.customerAgeing = async scope => ({ data: { organizationId: scope.organizationId, items: [{ stationId: "station-a1", customerId: "customer-1", customer: "Arun Transport", invoices: [{ invoiceId: "paid", status: "PAID", outstanding: 0 }, { invoiceId: "disputed", status: "DISPUTED", outstanding: 200 }, { invoiceId: "future", status: "NOT_DUE", outstanding: 300 }] }] }, evidence: [{ evidenceId: "fn:org-a:station-a1:receivables", evidenceType: "RECEIVABLES", applicationId: FUELNERVE_APPLICATION_ID, tenantId: "org-a", resourceId: "station-a1:receivables", label: "Customer ledger", observedAt: scope.asOf, resolverPath: "/evidence/receivables/station-a1" }], calculatedAt: scope.asOf });
  const result = await fixture.service.run(invocation("credit-watch", {}));
  assert.deepEqual(result.findings, []);
});

test("Purchase Agent keeps duplicate review unconfirmed and exposes exact record links", async () => {
  const fixture = serviceFixture();
  fixture.client.purchaseReview = async scope => ({ data: { organizationId: scope.organizationId, items: [{ stationId: "station-a1", type: "PURCHASE_DUPLICATE_CANDIDATE", status: "CANDIDATE_ONLY", invoiceId: "invoice-1", relatedInvoiceId: "invoice-2", title: "IndianOil's invoices IO-100 and IO-101 may be duplicates", explanation: "Compatible supplier, product, unit, tax, date and total fields match.", severity: "ATTENTION" }] }, evidence: [{ evidenceId: "fn:org-a:station-a1:purchase-review", evidenceType: "PURCHASE_REVIEW", applicationId: FUELNERVE_APPLICATION_ID, tenantId: "org-a", resourceId: "station-a1:purchase-review", label: "Purchase review", observedAt: scope.asOf, resolverPath: "/evidence/purchase-review/station-a1" }], calculatedAt: scope.asOf });
  const result = await fixture.service.run(invocation("purchase-check", {}));
  const value = result.findings[0]!.displayValue as JsonObject;
  assert.equal(value.duplicateDecision, "UNCONFIRMED");
  assert.match(result.findings[0]!.whyItMatters, /compatible/i);
  assert.deepEqual((value.evidenceLinks as JsonObject[]).map(link => link.path), ["/purchases?invoiceId=invoice-1", "/purchases?invoiceId=invoice-2"]);
});

test("Purchase Agent links a quantity exception to its invoice and receipt and preserves correction context", async () => {
  const fixture = serviceFixture();
  fixture.client.purchaseReview = async scope => ({ data: { organizationId: scope.organizationId, items: [{ stationId: "station-a1", type: "PURCHASE_QUANTITY_DIFFERENCE", invoiceId: "invoice-1", receiptId: "receipt-1", lineId: "line-1", title: "IndianOil's IO-100 quantity needs review", explanation: "10000 L was invoiced and 8000 L was received. This may be a partial delivery; verify before treating it as a shortage. 1 correction record is attached.", severity: "ATTENTION", deliveryStatus: "PARTIAL_OR_SHORT", correctionCount: 1 }] }, evidence: [{ evidenceId: "fn:org-a:station-a1:purchase-review", evidenceType: "PURCHASE_REVIEW", applicationId: FUELNERVE_APPLICATION_ID, tenantId: "org-a", resourceId: "station-a1:purchase-review", label: "Purchase review", observedAt: scope.asOf, resolverPath: "/evidence/purchase-review/station-a1" }], calculatedAt: scope.asOf });
  const result = await fixture.service.run(invocation("purchase-check", {}));
  const value = result.findings[0]!.displayValue as JsonObject;
  assert.match(result.findings[0]!.whyItMatters, /partial delivery.*correction record/i);
  assert.deepEqual((value.evidenceLinks as JsonObject[]).map(link => link.path), ["/purchases?invoiceId=invoice-1", "/purchases?receiptId=receipt-1"]);
});

test("invalid model output falls back without removing deterministic findings", async () => {
  const fixture = serviceFixture(request => { const fact = (request.input.facts as Array<{ factId: string; evidenceIds: string[] }>)[0]!; return { headline: "Unsupported", summary: "Unsupported model response", claims: [{ claimId: "bad", text: "Invented cause 999", factIds: [fact.factId], evidenceIds: fact.evidenceIds }] }; });
  const result = await fixture.service.run(invocation("inventory-watch", {}));
  assert.ok(result.findings.length > 0);
  assert.ok(result.findings.some(item => item.type === "INVENTORY_LOW"));
  assert.ok(result.findings.every(item => item.explanationMode === "DETERMINISTIC"));
});

test("model failure does not remove the underlying prioritized finding", async () => {
  const fixture = serviceFixture(() => { throw new Error("model unavailable"); });
  const result = await fixture.service.run(invocation("profit-insight", { startDate: "2026-09-01", endDate: "2026-09-07" }));
  assert.ok(result.findings.some(item => item.type === "PROFIT_CHANGE_MATERIAL" && item.priorityRank === 1));
  assert.ok(result.findings.every(item => item.explanationMode === "DETERMINISTIC"));
});

test("Owner Assistant routes supported questions to one approved read tool and returns evidence", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("business-assistant", { question: "What is our current stock position?" }));
  assert.equal(result.findings.length, 0);
  assert.equal(result.answer?.inconclusive, false);
  assert.equal(result.answer?.facts.length, 3);
  assert.equal(result.answer?.facts[0]?.supportingRecords[0]?.resolverPath, "/evidence/inventory/station-a1");
  assert.deepEqual(fixture.client.calls.filter(call => call !== "resolveEvidence"), ["inventory", "receipt-timing"]);
});

test("Owner Assistant clearly returns inconclusive for unsupported questions without calling a tool", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("business-assistant", { question: "Will fuel prices rise next month?" }));
  assert.equal(result.answer?.inconclusive, true);
  assert.match(result.answer?.summary ?? "", /does not have enough supported evidence/i);
  assert.deepEqual(fixture.client.calls, []);
});

test("Owner Assistant coordinates all five specialists with one station and one snapshot", async () => {
  const fixture = serviceFixture();
  const asOf = "2026-09-12T06:00:00.000Z";
  const result = await fixture.service.run(invocation("business-assistant", { question: "Give me details", asOf }));
  assert.deepEqual(fixture.client.calls.filter(call => call !== "resolveEvidence"), ["reconciliation", "inventory", "receipt-timing", "profit", "receivables", "purchase-review"]);
  assert.equal(result.answer?.stationId, "station-a1");
  assert.equal(result.answer?.snapshotDate, asOf);
  assert.equal(result.answer?.inconsistentSnapshot, false);
  assert.deepEqual(result.answer?.missingInformation, []);
  assert.deepEqual(result.answer?.supportedFollowUps, ["Give me details", "Why first?", "Show the records"]);
  assert.ok(result.answer?.facts.every(fact => fact.supportingRecords.length > 0));
});

test("Owner Assistant refuses cross-station coordination before reading records", async () => {
  const fixture = serviceFixture();
  await assert.rejects(fixture.service.run(invocation("business-assistant", { question: "Give me details" }, ["station-a1", "station-a2"])), /exactly one permitted station/i);
  assert.deepEqual(fixture.client.calls, []);
});

test("Owner Assistant discloses a stale snapshot", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("business-assistant", { question: "Show the records", asOf: "2026-09-01T00:00:00.000Z" }));
  assert.equal(result.answer?.stale, true);
  assert.ok(result.answer?.facts.flatMap(fact => fact.supportingRecords).every(record => record.evidenceId.startsWith("fn:org-a:station-a1:")));
});

test("all released agent tools are read-only and cannot contact external parties", () => {
  const fixture = serviceFixture();
  for (const agent of fixture.agents.list()) {
    for (const toolId of agent.allowedToolIds) {
      const definition = fixture.registry.definition(toolId);
      assert.equal(definition?.actionClass, "OBSERVE");
      assert.equal(definition?.requiresApproval, false);
      assert.doesNotMatch(toolId, /send|notify|message|proposal|execute|write/i);
    }
  }
});

test("visible findings are persisted tenant-scoped and include deterministic versus AI mode", async () => {
  const fixture = serviceFixture();
  const result = await fixture.service.run(invocation("reconciliation-review", {}));
  assert.ok(result.findings.every(item => item.explanationMode === "AI_EXPLAINED"));
  assert.ok(result.findings.every(item => item.aiExplanation));
  const stored = await fixture.store.list("org-a");
  assert.equal(stored.length, result.findings.length);
  assert.equal((await fixture.store.list("org-b")).length, 0);
});

function assertFindingExperience(findings: Array<{ title: string; whyItMatters: string; calculatedAt: string; stationId: string; period: { start: string; end: string }; supportingRecords: Array<{ resolverPath?: string }>; explanationMode: string; recommendedNextStep: string }>) {
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.ok(finding.title && finding.whyItMatters && finding.recommendedNextStep);
    assert.equal(finding.stationId, "station-a1");
    assert.ok(Number.isFinite(Date.parse(finding.calculatedAt)));
    assert.ok(finding.period.start && finding.period.end);
    assert.ok(finding.supportingRecords.length > 0);
    assert.ok(finding.supportingRecords.every(record => record.resolverPath?.startsWith("/evidence/")));
    assert.match(finding.explanationMode, /AI_EXPLAINED|DETERMINISTIC/);
  }
}

function serviceFixture(model: (request: ModelGenerationRequest) => unknown = groundedNarrative) {
  const client = new MockFuelNerveReadClient();
  const registry = new ToolRegistry({ applicationId: FUELNERVE_APPLICATION_ID, supportedVersions: [CONTRACT_VERSION] });
  registerFuelNerveTools(registry, client);
  const agents = new AgentRegistry();
  agents.register(createShiftReviewAgent()); agents.register(createStockWatchAgent()); agents.register(createProfitInsightAgent()); agents.register(createCreditAgent()); agents.register(createPurchaseAgent()); agents.register(createOwnerAssistantAgent());
  const runtime = new NerveRuntime({
    agents, tools: registry, model: new StaticModelProvider(model), audit: new InMemoryAuditStore(),
    usage: new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: 100, maxToolCalls: 100, maxInputTokens: 100_000, maxOutputTokens: 100_000 }),
    resolveApplicationKey: keyId => keyId === signingKey.keyId ? signingKey.secret : undefined,
    nonceStore: new InMemoryNonceStore(), safetyIdentifierSalt: "fuelnerve-read-agents-test-salt",
  });
  const store = new InMemoryReadOnlyFindingStore();
  return { client, registry, agents, store, service: new FuelNerveReadOnlyAgentService(runtime, store) };
}

function groundedNarrative(request: ModelGenerationRequest): AgentNarrative {
  const facts = request.input.facts as Array<{ factId: string; label: string; evidenceIds: string[] }>;
  if (!facts.length) return { headline: "Unable to answer from records", summary: "FuelNerve does not have enough supported evidence to answer this question.", claims: [] };
  return { headline: "Evidence-backed FuelNerve review", summary: "The following items come from FuelNerve records.", claims: facts.map((fact, index) => ({ claimId: `claim-${index + 1}`, text: fact.label, factIds: [fact.factId], evidenceIds: fact.evidenceIds })) };
}

function invocation(agentKey: string, input: JsonObject, permittedLocationIds = ["station-a1"]) {
  const now = new Date();
  const payload: AgentInvocation = {
    agentKey, context: {
      contractVersion: CONTRACT_VERSION, applicationId: FUELNERVE_APPLICATION_ID, environment: "development", tenantId: "org-a", actorId: "owner-a", roles: ["OWNER"], permittedLocationIds, grantedScopes: scopes,
      correlationId: randomUUID(), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    }, input: { asOf: now.toISOString(), ...input }, triggerType: "USER",
  };
  return signEnvelope(payload, signingKey, { nonce: randomUUID() });
}
