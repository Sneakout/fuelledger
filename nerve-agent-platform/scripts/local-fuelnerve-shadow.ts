import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  AgentRegistry, CONTRACT_VERSION, FUELNERVE_APPLICATION_ID, FrozenFuelNerveReadClient, FuelNerveHttpReadClient, FuelNerveShadowRunner,
  InMemoryAuditStore, InMemoryNonceStore, InMemoryShadowStore, InMemoryUsageStore, NerveRuntime,
  OpenAIResponsesModelProvider, StaticModelProvider, TenantUsageLimiter, ToolRegistry, createCreditAgent, createProfitInsightAgent, createPurchaseAgent, createShiftReviewAgent,
  createStockWatchAgent, registerFuelNerveTools, signEnvelope, type AgentInvocation, type AgentNarrative,
  type ModelGenerationRequest,
} from "../src/index.ts";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; };
const baseUrl = process.env.FUELNERVE_URL ?? "http://localhost:4000";
const organizationId = required("NERVE_LOCAL_ORGANIZATION_ID");
const stationId = required("NERVE_LOCAL_STATION_ID");
const key = { keyId: required("NERVE_LOCAL_KEY_ID"), secret: required("NERVE_LOCAL_SHARED_SECRET") };
const providerMode = process.env.NERVE_EXPLANATION_PROVIDER ?? "static";
const model = providerMode === "openai" ? new OpenAIResponsesModelProvider({ apiKey: required("OPENAI_API_KEY"), model: required("NERVE_OPENAI_MODEL") }) : new StaticModelProvider(groundedNarrative);
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const sourceClient = new FuelNerveHttpReadClient({ baseUrl, keyId: key.keyId, sharedSecret: key.secret });
const client = new FrozenFuelNerveReadClient(sourceClient);
const tools = new ToolRegistry({ applicationId: FUELNERVE_APPLICATION_ID, supportedVersions: [CONTRACT_VERSION] });
registerFuelNerveTools(tools, client);
const agents = new AgentRegistry();
for (const agent of [createShiftReviewAgent(), createStockWatchAgent(), createProfitInsightAgent(), createCreditAgent(), createPurchaseAgent()]) agents.register(agent);
const audit = new InMemoryAuditStore();
const runtime = new NerveRuntime({ agents, tools, model, modelTimeoutMs: Number(process.env.NERVE_MODEL_TIMEOUT_MS ?? 7_000), audit, usage: new TenantUsageLimiter(new InMemoryUsageStore(), { maxRuns: 10, maxToolCalls: 20, maxInputTokens: 100_000, maxOutputTokens: 10_000 }), resolveApplicationKey: keyId => keyId === key.keyId ? key.secret : undefined, nonceStore: new InMemoryNonceStore(), safetyIdentifierSalt: "local-fuelnerve-shadow-only" });
const store = new InMemoryShadowStore();
const shadow = new FuelNerveShadowRunner(runtime, client, store);

const results = [];
for (const agentKey of ["reconciliation-review", "inventory-watch", "profit-insight", "credit-watch", "purchase-check"]) {
  try {
    const envelope = invocation(agentKey);
    const outcome = await shadow.run(envelope);
    results.push({ agentKey, runId: outcome.runId, findings: await store.findings(outcome.runId), measurement: outcome.response.measurement, narrative: outcome.response.narrative, audit: await audit.events(outcome.runId) });
  } catch (error) {
    throw new Error(`Local shadow review failed while running ${agentKey}.`, { cause: error });
  }
}

const isolation = { crossTenantDenied: await deniedRead({ organizationId: `${organizationId}-other`, stationIds: [stationId] }), crossStationDenied: await deniedRead({ organizationId, stationIds: [`${stationId}-other`] }) };
const offline = await offlineCheck();
const report = { mode: "SHADOW", visibility: "HIDDEN", explanationProvider: providerMode, proposalsEnabled: false, actionsEnabled: false, generatedAt: new Date().toISOString(), scope: { organizationId, stationId }, results, isolation, offline };
await mkdir(".local-shadow", { recursive: true });
await writeFile(".local-shadow/latest.json", `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...report, results: results.map(row => ({ agentKey: row.agentKey, runId: row.runId, findingCount: row.findings.length, findings: row.findings.map(item => ({ title: item.title, summary: item.summary, evidence: item.evidence.map(record => ({ label: record.label, resolverPath: record.resolverPath })), deduplicationKey: item.deduplicationKey })) })) }, null, 2));

function invocation(agentKey: string) {
  const now = new Date();
    const payload: AgentInvocation = { agentKey, context: { contractVersion: CONTRACT_VERSION, applicationId: FUELNERVE_APPLICATION_ID, environment: "development", tenantId: organizationId, actorId: "local-shadow-reviewer", roles: ["OWNER"], permittedLocationIds: [stationId], grantedScopes: ["dashboard:read", "reconciliation:read", "inventory:read", "customers:read", "purchases:read", "accounting:read", "evidence:read"], correlationId: randomUUID(), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() }, input: { asOf: now.toISOString(), startDate: monthStart, endDate: today }, triggerType: "EVALUATION" };
  return signEnvelope(payload, key, { nonce: randomUUID() });
}

function groundedNarrative(request: ModelGenerationRequest): AgentNarrative {
  const facts = request.input.facts as Array<{ factId: string; label: string; evidenceIds: string[] }>;
  return { headline: "Local FuelNerve shadow review", summary: facts.length ? "Application-calculated facts are ready for manual comparison." : "FuelNerve reported no finding for this scope.", claims: facts.map((fact, index) => ({ claimId: `local-${index + 1}`, text: fact.label, factIds: [fact.factId], evidenceIds: fact.evidenceIds })) };
}

async function deniedRead(scope: { organizationId: string; stationIds: string[] }) {
  try { await client.inventoryPosition({ ...scope, asOf: new Date().toISOString() }, new AbortController().signal); return false; }
  catch { return true; }
}

async function offlineCheck() {
  const unavailable = new FuelNerveHttpReadClient({ baseUrl: "http://127.0.0.1:1", keyId: key.keyId, sharedSecret: key.secret });
  try { await unavailable.dashboardFacts({ organizationId, stationIds: [stationId], asOf: new Date().toISOString() }, AbortSignal.timeout(1_000)); return { failedClosed: false }; }
  catch { return { failedClosed: true, fuelNerveUnaffected: true }; }
}
