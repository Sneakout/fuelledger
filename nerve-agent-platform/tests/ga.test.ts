import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentConfigurationRegistry,
  AgentSdkError,
  CommercialControlService,
  FileGovernanceStore,
  GaReportingService,
  HealthMonitor,
  InMemoryPlatformStore,
  IndustryPackRegistry,
  PlatformControlPlane,
  SdkReleaseCatalog,
  SelfServiceOnboarding,
  ServiceTokenIssuer,
  UsageBillingMeter,
  defaultApprovalPolicies,
  genericCommerceIndustryPack,
  type PlanDefinition,
} from "../src/index.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("self-service onboarding creates isolated application, credential, tenant, subscription, and terms record", async () => {
  const setup = gaFixture();
  const result = await setup.onboarding.register({ applicationId: "shop-app", displayName: "Shop App", environment: "production", region: "ap-south", applicationTenantId: "merchant-1", planId: "growth", planVersion: 1, dataProcessingAcceptance: { organizationName: "Shop Ltd", acceptedBy: "owner-1", termsVersion: "dpa-2026-01", acceptedAt: new Date().toISOString(), region: "ap-south" } });
  assert.equal(result.application.status, "ACTIVE"); assert.equal(result.mapping.applicationTenantId, "merchant-1"); assert.equal(result.subscription.status, "TRIAL"); assert.ok(result.credential.secret);
  assert.doesNotThrow(() => setup.commercial.assertAgent("shop-app", result.mapping.nerveTenantId, "production", "inventory-watch"));
  await assert.rejects(() => setup.onboarding.register({ applicationId: "eu-app", displayName: "EU", environment: "production", region: "eu-west", applicationTenantId: "one", planId: "growth", planVersion: 1, dataProcessingAcceptance: { organizationName: "EU", acceptedBy: "owner", termsVersion: "old", acceptedAt: new Date().toISOString(), region: "eu-west" } }), AgentSdkError);
});

test("plans enforce agent entitlements, capabilities, quotas, and model budgets", () => {
  const commercial = new CommercialControlService(); commercial.registerPlan(plan()); commercial.subscribe({ applicationId: "app", nerveTenantId: "tenant", environment: "production", planId: "growth", planVersion: 1, status: "ACTIVE", effectiveAt: new Date().toISOString() });
  commercial.assertAgent("app", "tenant", "production", "inventory-watch"); commercial.assertCapability("app", "tenant", "production", "audit.export"); commercial.assertUsage("app", "tenant", "production", { runs: 99, toolCalls: 499, modelInputTokens: 9999, modelOutputTokens: 4999 });
  assert.throws(() => commercial.assertAgent("app", "tenant", "production", "profit-insight"), AgentSdkError);
  assert.throws(() => commercial.assertUsage("app", "tenant", "production", { runs: 100, toolCalls: 0, modelInputTokens: 0, modelOutputTokens: 0 }), AgentSdkError);
  assert.throws(() => commercial.assertUsage("app", "tenant", "production", { runs: 0, toolCalls: 0, modelInputTokens: 10000, modelOutputTokens: 0 }), AgentSdkError);
});

test("SDK releases are immutable and negotiate compatible contract majors", () => {
  const catalog = new SdkReleaseCatalog(); catalog.publish({ packageName: "@nerve/sdk", version: "1.2.0", contractVersions: ["1.0", "1.1"], status: "CURRENT", releasedAt: new Date().toISOString() }); catalog.publish({ packageName: "@nerve/sdk", version: "2.0.0", contractVersions: ["2.0"], status: "SUPPORTED", releasedAt: new Date().toISOString() });
  assert.equal(catalog.negotiate("@nerve/sdk", "1.3").version, "1.2.0"); assert.equal(catalog.negotiate("@nerve/sdk", "2.1").version, "2.0.0");
  assert.throws(() => catalog.publish({ packageName: "@nerve/sdk", version: "1.2.0", contractVersions: ["1.0"], status: "CURRENT", releasedAt: new Date().toISOString() })); assert.throws(() => catalog.negotiate("@nerve/sdk", "3.0"), AgentSdkError);
});

test("usage, approval dashboard, audit export, and operational status are tenant scoped", async t => {
  const platform = new InMemoryPlatformStore(); const meter = new UsageBillingMeter(platform); await meter.run("app", "tenant-a", "production"); await meter.run("app", "tenant-b", "production");
  const directory = await mkdtemp(join(tmpdir(), "nerve-ga-")); t.after(() => rm(directory, { recursive: true, force: true })); const governance = new FileGovernanceStore(join(directory, "governance.json"));
  await governance.appendAudit({ eventId: "event-a", tenantId: "tenant-a", type: "FINDING_SAVED", occurredAt: new Date().toISOString(), detail: { safe: true } }); await governance.appendAudit({ eventId: "event-b", tenantId: "tenant-b", type: "FINDING_SAVED", occurredAt: new Date().toISOString(), detail: { safe: true } });
  const reporting = new GaReportingService({ platform, governance, health: new HealthMonitor({ api: async () => ({ status: "UP" }) }) });
  assert.equal((await reporting.usage("app", "tenant-a")).totals.RUN, 1); const exported = await reporting.exportAudit("tenant-a"); assert.match(exported, /event-a/); assert.doesNotMatch(exported, /event-b/); assert.equal((await reporting.approvals("tenant-a")).pending.length, 0); assert.equal((await reporting.status()).status, "HEALTHY");
});

function gaFixture() { const platform = new InMemoryPlatformStore(); const control = new PlatformControlPlane(platform, new ServiceTokenIssuer("ga-service-token-secret-at-least-32-bytes")); const commercial = new CommercialControlService(); commercial.registerPlan(plan()); const packs = new IndustryPackRegistry(); packs.register(genericCommerceIndustryPack); const configurations = new AgentConfigurationRegistry(packs, defaultApprovalPolicies); const onboarding = new SelfServiceOnboarding({ control, commercial, configurations, allowedRegions: ["ap-south", "eu-west"], currentTermsVersion: "dpa-2026-01" }); return { platform, control, commercial, configurations, onboarding }; }
function plan(): PlanDefinition { return { planId: "growth", version: 1, displayName: "Growth", agentEntitlements: ["inventory-watch", "business-assistant"], capabilityEntitlements: ["audit.export", "approvals.dashboard"], monthlyRunQuota: 100, monthlyToolCallQuota: 500, monthlyModelInputTokens: 10000, monthlyModelOutputTokens: 5000, approvalDashboard: true, auditExport: true, supportTier: "PRIORITY" }; }
