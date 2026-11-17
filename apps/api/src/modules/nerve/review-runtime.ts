import { randomBytes, randomUUID } from 'node:crypto';
import type { NerveReviewJob } from '@prisma/client';
import { AgentRegistry } from '../../../../../nerve-agent-platform/src/agent-registry.ts';
import { CONTRACT_VERSION } from '../../../../../nerve-agent-platform/src/contracts.ts';
import { InMemoryAuditStore } from '../../../../../nerve-agent-platform/src/audit.ts';
import { InMemoryNonceStore, signEnvelope } from '../../../../../nerve-agent-platform/src/signing.ts';
import { InMemoryUsageStore, TenantUsageLimiter } from '../../../../../nerve-agent-platform/src/usage.ts';
import { NerveRuntime } from '../../../../../nerve-agent-platform/src/runtime.ts';
import type { AgentInvocation } from '../../../../../nerve-agent-platform/src/runtime-contracts.ts';
import { ToolRegistry } from '../../../../../nerve-agent-platform/src/registry.ts';
import { FUELNERVE_APPLICATION_ID, type FuelNerveReadClient, type FuelNerveScope, type FuelNerveSnapshot } from '../../../../../nerve-agent-platform/src/adapters/fuelnerve/types.ts';
import { registerFuelNerveTools } from '../../../../../nerve-agent-platform/src/adapters/fuelnerve/adapter.ts';
import { InMemoryReadOnlyFindingStore, FuelNerveReadOnlyAgentService } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/read-only-service.ts';
import { createCreditAgent } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/credit-watch.ts';
import { createOwnerAssistantAgent } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/owner-assistant.ts';
import { createProfitInsightAgent } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/profit-insight.ts';
import { createPurchaseAgent } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/purchase-check.ts';
import { createShiftReviewAgent } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/shift-review.ts';
import { createStockWatchAgent } from '../../../../../nerve-agent-platform/src/agents/fuelnerve/stock-watch.ts';
import { indiaDate } from '../../lib/india-time.js';
import { readReceiptMessageFacts, readShiftMessageFacts } from '../notifications/message-facts.js';
import { customerPaymentReminderBody, readCustomerReminder, recentCustomerReminder } from '../notifications/customer-reminder-facts.js';
import { prisma } from '../../lib/prisma.js';
import { readForNerve, type NerveReadCapability } from './read-service.js';

const registry = new AgentRegistry();
for (const definition of [createShiftReviewAgent(), createStockWatchAgent(), createCreditAgent(), createPurchaseAgent(), createProfitInsightAgent(), createOwnerAssistantAgent()]) {
  registry.register(definition);
}

export async function runReview(job: NerveReviewJob, signal: AbortSignal) {
  const asOf = new Date();
  const evidence = new Map<string, FuelNerveSnapshot['evidence'][number]>();
  const read = (capability: NerveReadCapability) => async (scope: FuelNerveScope, readSignal: AbortSignal, evidenceId?: string): Promise<FuelNerveSnapshot> => {
    readSignal.throwIfAborted();
    if (scope.organizationId !== job.organizationId || scope.stationIds.length !== 1 || scope.stationIds[0] !== job.stationId) {
      throw new Error('Agent read scope does not match its review job.');
    }
    const { organizationId, asOf, startDate, endDate } = scope;
    const result = await readForNerve(capability, { organizationId, asOf, stationId: job.stationId, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...(evidenceId ? { evidenceId } : {}) });
    readSignal.throwIfAborted();
    const snapshot = JSON.parse(JSON.stringify(result)) as FuelNerveSnapshot;
    for (const item of snapshot.evidence) evidence.set(item.evidenceId, item);
    return snapshot;
  };
  const client: FuelNerveReadClient = {
    dashboardFacts: read('dashboard'), shiftAndReconciliationStatus: read('reconciliation'), inventoryPosition: read('inventory'),
    customerAgeing: read('receivables'), supplierPayables: read('payables'), purchasePriceHistory: read('purchase-price'),
    purchaseReview: read('purchase-review'), receiptTimingStatus: read('receipt-timing'), journalProfit: read('profit'),
    resolveEvidence: (scope, id, signal) => read('evidence')(scope, signal, id),
  };
  const tools = new ToolRegistry({ applicationId: FUELNERVE_APPLICATION_ID, supportedVersions: [CONTRACT_VERSION] });
  registerFuelNerveTools(tools, client);
  const key = { keyId: 'fuelnerve-review-worker', secret: randomBytes(32).toString('hex') };
  const audit = new InMemoryAuditStore();
  const runtime = new NerveRuntime({
    agents: registry, tools, audit,
    model: { async generate() { throw new Error('Use the specialist’s deterministic explanation for background review.'); } },
    usage: new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: 1, maxToolCalls: 8, maxInputTokens: 100_000, maxOutputTokens: 10_000 }),
    resolveApplicationKey: id => id === key.keyId ? key.secret : undefined,
    nonceStore: new InMemoryNonceStore(),
    safetyIdentifierSalt: key.secret,
  });
  const invocation: AgentInvocation = {
    agentKey: job.agentKey,
    triggerType: job.eventType === 'DAILY_REVIEW' ? 'SCHEDULE' : 'EVENT',
    context: {
      contractVersion: CONTRACT_VERSION, applicationId: FUELNERVE_APPLICATION_ID, environment: 'production',
      tenantId: job.organizationId, actorId: 'fuelnerve-review-worker', roles: ['OWNER'], permittedLocationIds: [job.stationId],
      grantedScopes: ['dashboard:read', 'reconciliation:read', 'inventory:read', 'customers:read', 'purchases:read', 'accounting:read', 'evidence:read'],
      correlationId: job.id, issuedAt: asOf.toISOString(), expiresAt: new Date(asOf.getTime() + 60_000).toISOString(),
    },
    input: { asOf: asOf.toISOString(), startDate: `${indiaDate(asOf).slice(0, 7)}-01`, endDate: indiaDate(asOf),
      ...(job.agentKey === 'business-assistant' ? { question: 'What needs attention today?' } : {}) },
  };
  const service = new FuelNerveReadOnlyAgentService(runtime, new InMemoryReadOnlyFindingStore());
  const result = await service.run(signEnvelope(invocation, key, { nonce: randomUUID() }), { signal });
  signal.throwIfAborted();
  const scope = { organizationId: job.organizationId, stationId: job.stationId };
  const isShiftReview = job.agentKey === 'reconciliation-review' && ['SHIFT_CLOSED', 'SHIFT_RECONCILED'].includes(job.eventType);
  const shift = isShiftReview ? await readShiftMessageFacts(scope, job.resourceId, asOf) : null;
  const receipt = job.agentKey === 'purchase-check' && job.eventType === 'RECEIPT_RECORDED'
    ? await readReceiptMessageFacts(scope, job.resourceId, asOf) : null;
  const reminderDrafts = [];
  if (job.agentKey === 'credit-watch' && ['DAILY_REVIEW', 'CUSTOMER_PAYMENT'].includes(job.eventType)) {
    const customers = await prisma.customer.findMany({
      where: { organizationId: scope.organizationId, active: true, reminderPaused: false, reminderConsentAt: { not: null },
        ledger: { some: { ...scope, amount: { gt: 0 }, dueDate: { lt: asOf } } } },
      select: { id: true },
    });
    for (const customer of customers) {
      signal.throwIfAborted();
      const scopedCustomer = { ...scope, customerId: customer.id };
      const result = await readCustomerReminder(scopedCustomer, asOf);
      if (!result.draft || await prisma.ownerNotificationDelivery.findFirst({ where: recentCustomerReminder(scopedCustomer, asOf), select: { id: true } })) continue;
      const { customerId, stationId, overdueAmount, dueDate, sourceIds, status, message } = result.draft;
      reminderDrafts.push({ customerId, stationId, overdueAmount, dueDate, sourceIds, status, message: customerPaymentReminderBody(message) });
    }
  }
  signal.throwIfAborted();
  return {
    ...result, findings: result.findings.map(finding => ({ ...finding, findingId: randomUUID() })),
    evidence: [...evidence.values()], run: await audit.getRun(result.runId), audit: await audit.events(result.runId),
    shift: shift ? { ready: job.eventType === 'SHIFT_RECONCILED' && shift.completeness === 'COMPLETE', facts: shift } : null,
    receipt,
    reminderDrafts,
  };
}
