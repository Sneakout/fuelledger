import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  AgentSdkError,
  CONTRACT_VERSION,
  EncryptedConfigurationVault,
  FixedWindowRateLimiter,
  HealthMonitor,
  InMemoryJobQueue,
  InMemoryPlatformStore,
  PlatformApiGateway,
  PlatformControlPlane,
  PlatformScheduler,
  PlatformWorker,
  ServiceTokenIssuer,
  UsageBillingMeter,
  type AgentInvocation,
  type AgentResponse,
  type NerveRuntime,
  type SignedEnvelope,
} from "../src/index.ts";

test("application registration, environment-isolated tenant mapping, and short-lived tokens", async () => {
  const setup = controlFixture();
  await setup.control.registerApplication({ applicationId: "fuelnerve", displayName: "FuelNerve", environments: ["staging", "production"], regions: ["ap-south"] });
  const credential = await setup.control.createCredential("fuelnerve", "staging");
  await setup.control.mapTenant({ applicationId: "fuelnerve", applicationTenantId: "org-a", nerveTenantId: "nerve-tenant-a-staging", environment: "staging", region: "ap-south", enabledAgentKeys: ["stock-watch"] });
  const issued = await setup.control.issueToken({ applicationId: "fuelnerve", applicationTenantId: "org-a", environment: "staging", keyId: credential.keyId, secret: credential.secret, scopes: ["agent:run"], ttlSeconds: 60 });
  const claims = setup.control.verifyToken(issued.token);
  assert.equal(claims.nerveTenantId, "nerve-tenant-a-staging");
  assert.equal(claims.environment, "staging");
  await assert.rejects(() => setup.control.issueToken({ applicationId: "fuelnerve", applicationTenantId: "org-a", environment: "production", keyId: credential.keyId, secret: credential.secret, scopes: ["agent:run"] }), AgentSdkError);
});

test("credential rotation creates a new key without silently changing environments", async () => {
  const setup = controlFixture();
  await setup.control.registerApplication({ applicationId: "fuelnerve", displayName: "FuelNerve", environments: ["production"], regions: ["ap-south"] });
  const old = await setup.control.createCredential("fuelnerve", "production");
  const next = await setup.control.rotateCredential("fuelnerve", "production", old.keyId, 5);
  assert.notEqual(next.keyId, old.keyId);
  assert.notEqual(next.secret, old.secret);
  const rows = await setup.store.credentials("fuelnerve", "production");
  assert.ok(rows.find(row => row.keyId === old.keyId)?.expiresAt);
});

test("API gateway binds token, application tenant, environment, enablement, and metering", async () => {
  const setup = controlFixture();
  await setup.control.registerApplication({ applicationId: "fuelnerve", displayName: "FuelNerve", environments: ["production"], regions: ["ap-south"] });
  const credential = await setup.control.createCredential("fuelnerve", "production");
  await setup.control.mapTenant({ applicationId: "fuelnerve", applicationTenantId: "org-a", nerveTenantId: "nerve-a", environment: "production", region: "ap-south", enabledAgentKeys: ["stock-watch"] });
  const token = await setup.control.issueToken({ applicationId: "fuelnerve", applicationTenantId: "org-a", environment: "production", keyId: credential.keyId, secret: credential.secret, scopes: ["agent:run"] });
  let calls = 0;
  const runtime = { execute: async () => { calls += 1; return response(); } } as unknown as NerveRuntime;
  const meter = new UsageBillingMeter(setup.store);
  const gateway = new PlatformApiGateway({ control: setup.control, store: setup.store, runtime, rateLimiter: new FixedWindowRateLimiter(2, 60_000), meter });
  const result = await gateway.executeAgent(`Bearer ${token.token}`, { envelope: envelope("org-a", "production", "stock-watch") });
  assert.equal(result.narrativeMode, "DETERMINISTIC_FALLBACK");
  assert.equal(calls, 1);
  assert.deepEqual(await meter.summary("fuelnerve", "nerve-a"), { RUN: 1 });
  await assert.rejects(() => gateway.executeAgent(`Bearer ${token.token}`, { envelope: envelope("org-b", "production", "stock-watch") }), (error: unknown) => error instanceof AgentSdkError && error.code === "TENANT_MISMATCH");
  await assert.rejects(() => gateway.executeAgent(`Bearer ${token.token}`, { envelope: envelope("org-a", "production", "profit-insight") }), AgentSdkError);
  assert.equal(calls, 1);
});

test("worker retries bounded failures and moves the job to dead letter", async () => {
  const queue = new InMemoryJobQueue(); const scheduler = new PlatformScheduler(queue); let calls = 0;
  const job = scheduler.schedule("run-agent", { tenantId: "nerve-a" }, new Date(0));
  const worker = new PlatformWorker(queue, { "run-agent": async () => { calls += 1; throw new Error("provider unavailable"); } });
  await worker.runOne(); await worker.runOne(); await worker.runOne();
  assert.equal(calls, 3); assert.equal(queue.deadLetters()[0]?.jobId, job.jobId);
});

test("sensitive configuration is encrypted and health reports degradation", async () => {
  const vault = new EncryptedConfigurationVault(randomBytes(32)); const encrypted = vault.encrypt("provider-secret");
  assert.doesNotMatch(encrypted, /provider-secret/); assert.equal(vault.decrypt(encrypted), "provider-secret");
  const health = await new HealthMonitor({ database: async () => ({ status: "UP" }), model: async () => ({ status: "DEGRADED", detail: "fallback active" }) }).check();
  assert.equal(health.status, "DEGRADED"); assert.equal(health.components.model?.status, "DEGRADED");
});

function controlFixture() { const store = new InMemoryPlatformStore(); const control = new PlatformControlPlane(store, new ServiceTokenIssuer("test-token-signing-key-at-least-32-bytes")); return { store, control }; }

function envelope(tenantId: string, environment: "development" | "staging" | "production", agentKey: string): SignedEnvelope<AgentInvocation> {
  const now = new Date(); return { keyId: "application-signing-key", algorithm: "HMAC-SHA256", nonce: "nonce", signedAt: now.toISOString(), signature: "runtime-verifies-this", payload: { agentKey, triggerType: "USER", input: {}, context: { contractVersion: CONTRACT_VERSION, applicationId: "fuelnerve", environment, tenantId, actorId: "owner-1", roles: ["OWNER"], permittedLocationIds: ["station-a1"], grantedScopes: ["inventory:read"], correlationId: "correlation-1", issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() } } };
}

function response(): AgentResponse { const now = new Date().toISOString(); return { run: { runId: "run-1", correlationId: "correlation-1", applicationId: "fuelnerve", tenantId: "org-a", actorId: "owner-1", agentKey: "stock-watch", agentVersion: "1", triggerType: "USER", status: "COMPLETED", toolRequestIds: [], findingIds: [], startedAt: now, completedAt: now }, narrative: { headline: "Fallback", summary: "Model unavailable.", claims: [] }, narrativeMode: "DETERMINISTIC_FALLBACK", facts: [], evidence: [] }; }
