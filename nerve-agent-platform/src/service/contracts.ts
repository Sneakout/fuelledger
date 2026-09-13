import type { JsonObject, SignedEnvelope } from "../contracts.ts";
import type { AgentInvocation, AgentResponse } from "../runtime-contracts.ts";

export type PlatformEnvironment = "development" | "staging" | "production";
export type ApplicationRegistration = { applicationId: string; displayName: string; environments: PlatformEnvironment[]; regions: string[]; createdAt: string; status: "ACTIVE" | "SUSPENDED" };
export type ApplicationCredential = { applicationId: string; environment: PlatformEnvironment; keyId: string; secretHash: string; validFrom: string; expiresAt?: string; revokedAt?: string };
export type TenantMapping = { applicationId: string; applicationTenantId: string; nerveTenantId: string; environment: PlatformEnvironment; region: string; enabledAgentKeys: string[]; createdAt: string };
export type ServiceTokenClaims = { tokenId: string; applicationId: string; environment: PlatformEnvironment; nerveTenantId: string; applicationTenantId: string; scopes: string[]; issuedAt: string; expiresAt: string };
export type ServiceToken = { token: string; expiresAt: string };
export type AgentRunRequest = { envelope: SignedEnvelope<AgentInvocation> };
export type AgentRunResponse = AgentResponse;
export type PlatformHealth = { status: "HEALTHY" | "DEGRADED" | "UNHEALTHY"; checkedAt: string; components: Record<string, { status: "UP" | "DEGRADED" | "DOWN"; detail?: string }> };
export type MeterEvent = { eventId: string; applicationId: string; tenantId: string; environment: PlatformEnvironment; kind: "RUN" | "TOOL_CALL" | "MODEL_INPUT_TOKEN" | "MODEL_OUTPUT_TOKEN"; quantity: number; occurredAt: string; dimensions: JsonObject };

export interface PlatformStore {
  saveApplication(value: ApplicationRegistration): Promise<void>;
  getApplication(applicationId: string): Promise<ApplicationRegistration | undefined>;
  saveCredential(value: ApplicationCredential): Promise<void>;
  credentials(applicationId: string, environment: PlatformEnvironment): Promise<ApplicationCredential[]>;
  saveTenantMapping(value: TenantMapping): Promise<void>;
  getTenantMapping(applicationId: string, applicationTenantId: string, environment: PlatformEnvironment): Promise<TenantMapping | undefined>;
  saveMeterEvent(value: MeterEvent): Promise<void>;
  meterEvents(applicationId: string, nerveTenantId: string): Promise<MeterEvent[]>;
}
