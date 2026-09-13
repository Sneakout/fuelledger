import { AgentSdkError } from "../errors.ts";

export type PlanDefinition = {
  planId: string;
  version: number;
  displayName: string;
  agentEntitlements: string[];
  capabilityEntitlements: string[];
  monthlyRunQuota: number;
  monthlyToolCallQuota: number;
  monthlyModelInputTokens: number;
  monthlyModelOutputTokens: number;
  approvalDashboard: boolean;
  auditExport: boolean;
  supportTier: "STANDARD" | "PRIORITY" | "ENTERPRISE";
};
export type TenantSubscription = { applicationId: string; nerveTenantId: string; environment: "development" | "staging" | "production"; planId: string; planVersion: number; status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED"; effectiveAt: string; expiresAt?: string };
export type CommercialUsage = { runs: number; toolCalls: number; modelInputTokens: number; modelOutputTokens: number };

export class CommercialControlService {
  private readonly plans = new Map<string, PlanDefinition>(); private readonly subscriptions = new Map<string, TenantSubscription>();
  registerPlan(plan: PlanDefinition) { if (this.plans.has(planKey(plan.planId, plan.version))) throw new AgentSdkError("INVALID_REQUEST", "Plan version already exists."); validatePlan(plan); this.plans.set(planKey(plan.planId, plan.version), structuredClone(plan)); }
  subscribe(subscription: TenantSubscription) { this.resolvePlan(subscription.planId, subscription.planVersion); this.subscriptions.set(subscriptionKey(subscription.applicationId, subscription.nerveTenantId, subscription.environment), structuredClone(subscription)); }
  entitlements(applicationId: string, tenantId: string, environment: TenantSubscription["environment"]) { const subscription = this.subscriptions.get(subscriptionKey(applicationId, tenantId, environment)); if (!subscription || !["TRIAL", "ACTIVE"].includes(subscription.status) || subscription.expiresAt && new Date(subscription.expiresAt) <= new Date()) throw new AgentSdkError("SCOPE_DENIED", "Tenant does not have an active platform subscription."); return { subscription: structuredClone(subscription), plan: this.resolvePlan(subscription.planId, subscription.planVersion) }; }
  assertAgent(applicationId: string, tenantId: string, environment: TenantSubscription["environment"], agentKey: string) { if (!this.entitlements(applicationId, tenantId, environment).plan.agentEntitlements.includes(agentKey)) throw new AgentSdkError("SCOPE_DENIED", "Agent is not included in the tenant plan."); }
  assertCapability(applicationId: string, tenantId: string, environment: TenantSubscription["environment"], capability: string) { if (!this.entitlements(applicationId, tenantId, environment).plan.capabilityEntitlements.includes(capability)) throw new AgentSdkError("SCOPE_DENIED", "Capability is not included in the tenant plan."); }
  assertUsage(applicationId: string, tenantId: string, environment: TenantSubscription["environment"], usage: CommercialUsage) { const plan = this.entitlements(applicationId, tenantId, environment).plan; if (usage.runs >= plan.monthlyRunQuota || usage.toolCalls >= plan.monthlyToolCallQuota || usage.modelInputTokens >= plan.monthlyModelInputTokens || usage.modelOutputTokens >= plan.monthlyModelOutputTokens) throw new AgentSdkError("USAGE_LIMIT_EXCEEDED", "Tenant plan quota or model budget is exhausted."); }
  private resolvePlan(planId: string, version: number) { const plan = this.plans.get(planKey(planId, version)); if (!plan) throw new AgentSdkError("INVALID_REQUEST", "Plan version is not registered."); return structuredClone(plan); }
}
function validatePlan(plan: PlanDefinition) { if (!plan.planId || !Number.isInteger(plan.version) || plan.version < 1 || [plan.monthlyRunQuota, plan.monthlyToolCallQuota, plan.monthlyModelInputTokens, plan.monthlyModelOutputTokens].some(value => !Number.isInteger(value) || value < 0)) throw new AgentSdkError("INVALID_REQUEST", "Plan definition is invalid."); }
const planKey = (id: string, version: number) => `${id}@${version}`;
const subscriptionKey = (app: string, tenant: string, environment: string) => `${app}:${environment}:${tenant}`;
