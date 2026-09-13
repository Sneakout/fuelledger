import { randomUUID } from "node:crypto";
import type { AgentConfigurationProfile, AgentConfigurationRegistry } from "../agent-configuration.ts";
import { AgentSdkError } from "../errors.ts";
import type { PlatformControlPlane } from "../service/control-plane.ts";
import type { PlatformEnvironment } from "../service/contracts.ts";
import type { CommercialControlService, TenantSubscription } from "./commercial.ts";

export type DataProcessingAcceptance = { organizationName: string; acceptedBy: string; termsVersion: string; acceptedAt: string; region: string };
export type SelfServiceRegistration = {
  applicationId: string; displayName: string; environment: PlatformEnvironment; region: string; applicationTenantId: string;
  planId: string; planVersion: number; dataProcessingAcceptance: DataProcessingAcceptance;
};

export class SelfServiceOnboarding {
  constructor(input: { control: PlatformControlPlane; commercial: CommercialControlService; configurations: AgentConfigurationRegistry; allowedRegions: string[]; currentTermsVersion: string }) { this.input = input; }
  private readonly input: { control: PlatformControlPlane; commercial: CommercialControlService; configurations: AgentConfigurationRegistry; allowedRegions: string[]; currentTermsVersion: string };
  async register(input: SelfServiceRegistration) {
    if (!this.input.allowedRegions.includes(input.region)) throw new AgentSdkError("INVALID_REQUEST", "Requested data-processing region is not available.");
    if (input.dataProcessingAcceptance.termsVersion !== this.input.currentTermsVersion || input.dataProcessingAcceptance.region !== input.region || !input.dataProcessingAcceptance.acceptedBy) throw new AgentSdkError("INVALID_REQUEST", "Current data-processing terms must be accepted for the selected region.");
    const application = await this.input.control.registerApplication({ applicationId: input.applicationId, displayName: input.displayName, environments: [input.environment], regions: [input.region] });
    const credential = await this.input.control.createCredential(input.applicationId, input.environment);
    const nerveTenantId = randomUUID(); const mapping = await this.input.control.mapTenant({ applicationId: input.applicationId, applicationTenantId: input.applicationTenantId, nerveTenantId, environment: input.environment, region: input.region, enabledAgentKeys: [] });
    const subscription: TenantSubscription = { applicationId: input.applicationId, nerveTenantId, environment: input.environment, planId: input.planId, planVersion: input.planVersion, status: "TRIAL", effectiveAt: new Date().toISOString() }; this.input.commercial.subscribe(subscription);
    return { application, mapping, credential, subscription, dataProcessingAcceptance: structuredClone(input.dataProcessingAcceptance) };
  }
  configure(profile: AgentConfigurationProfile) { this.input.commercial.entitlements(profile.applicationId, profile.tenantId, profile.environment); for (const agent of profile.enabledAgentKeys) this.input.commercial.assertAgent(profile.applicationId, profile.tenantId, profile.environment, agent); return this.input.configurations.save(profile); }
}
