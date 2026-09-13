import { AgentSdkError } from "../errors.ts";
import type { NerveRuntime } from "../runtime.ts";
import type { AgentRunRequest } from "./contracts.ts";
import type { PlatformControlPlane } from "./control-plane.ts";
import type { FixedWindowRateLimiter } from "./rate-limit.ts";
import type { UsageBillingMeter } from "./meter.ts";
import type { PlatformStore } from "./contracts.ts";
import type { CommercialControlService } from "../ga/commercial.ts";

export class PlatformApiGateway {
  constructor(input: { control: PlatformControlPlane; store: PlatformStore; runtime: NerveRuntime; rateLimiter: FixedWindowRateLimiter; meter: UsageBillingMeter; killSwitch?: { assertAgentAllowed(tenantId: string, agentKey: string): void }; commercial?: CommercialControlService }) { this.input = input; }
  private readonly input: { control: PlatformControlPlane; store: PlatformStore; runtime: NerveRuntime; rateLimiter: FixedWindowRateLimiter; meter: UsageBillingMeter; killSwitch?: { assertAgentAllowed(tenantId: string, agentKey: string): void }; commercial?: CommercialControlService };

  async executeAgent(authorization: string, request: AgentRunRequest) {
    if (!authorization.startsWith("Bearer ")) throw new AgentSdkError("SIGNATURE_INVALID", "A service token is required.");
    const claims = this.input.control.verifyToken(authorization.slice(7));
    this.input.rateLimiter.consume(`${claims.applicationId}:${claims.environment}:${claims.nerveTenantId}`);
    if (!claims.scopes.includes("agent:run")) throw new AgentSdkError("SCOPE_DENIED", "Service token does not grant agent execution.");
    const context = request.envelope.payload.context;
    if (context.applicationId !== claims.applicationId || context.environment !== claims.environment || context.tenantId !== claims.applicationTenantId) throw new AgentSdkError("TENANT_MISMATCH", "Run context does not match the authenticated application tenant and environment.");
    const mapping = await this.input.store.getTenantMapping(claims.applicationId, claims.applicationTenantId, claims.environment);
    if (!mapping || mapping.nerveTenantId !== claims.nerveTenantId) throw new AgentSdkError("TENANT_MISMATCH", "Tenant mapping is missing or changed.");
    if (!mapping.enabledAgentKeys.includes(request.envelope.payload.agentKey)) throw new AgentSdkError("SCOPE_DENIED", "Agent is not enabled for this tenant.");
    if (this.input.commercial) {
      this.input.commercial.assertAgent(claims.applicationId, claims.nerveTenantId, claims.environment, request.envelope.payload.agentKey);
      const totals = await this.input.meter.summary(claims.applicationId, claims.nerveTenantId);
      this.input.commercial.assertUsage(claims.applicationId, claims.nerveTenantId, claims.environment, { runs: totals.RUN ?? 0, toolCalls: totals.TOOL_CALL ?? 0, modelInputTokens: totals.MODEL_INPUT_TOKEN ?? 0, modelOutputTokens: totals.MODEL_OUTPUT_TOKEN ?? 0 });
    }
    this.input.killSwitch?.assertAgentAllowed(claims.nerveTenantId, request.envelope.payload.agentKey);
    const response = await this.input.runtime.execute(request.envelope);
    await this.input.meter.run(claims.applicationId, claims.nerveTenantId, claims.environment, { agentKey: response.run.agentKey, narrativeMode: response.narrativeMode });
    return response;
  }
}
