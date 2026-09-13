import type { JsonObject } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import type { ApprovalPolicy, ProposalType } from "./governance-contracts.ts";
import type { IndustryPack } from "./industry-pack.ts";
import type { AgentDefinition } from "./runtime-contracts.ts";
import { createGenericBusinessAssistantAgent, createGenericInventoryWatchAgent, createGenericProfitInsightAgent, createGenericReceivablesAgent } from "./agents/generic/agents.ts";

export type NotificationPolicyConfiguration = { enabledChannels: Array<"IN_APP" | "EMAIL" | "PUSH">; minimumSeverity: "INFORMATION" | "ATTENTION" | "URGENT"; quietPeriods: Array<{ start: string; end: string }> };
export type ApprovalRequirementConfiguration = { proposalType: ProposalType; requiredRoleSets: string[][]; expiresAfterMinutes: number };
export type AgentConfigurationProfile = {
  configurationId: string; version: number; applicationId: string; tenantId: string; environment: "development" | "staging" | "production";
  packId: string; packVersion: string; enabledAgentKeys: string[]; agentDisplayNames: Record<string, string>; enabledFindingKeys: string[];
  thresholds: Record<string, number>; locationTerminology?: string; notificationPolicy: NotificationPolicyConfiguration;
  approvalRequirements: ApprovalRequirementConfiguration[]; evidenceLabelAliases: Record<string, string>; supportedQuestionIntents: string[];
};

export class IndustryPackRegistry {
  private readonly packs = new Map<string, IndustryPack>();
  register(pack: IndustryPack) { validatePack(pack); const id = `${pack.packId}@${pack.version}`; if (this.packs.has(id)) throw new AgentSdkError("INVALID_REQUEST", "Industry pack version already exists."); this.packs.set(id, structuredClone(pack)); }
  resolve(packId: string, version: string) { const pack = this.packs.get(`${packId}@${version}`); if (!pack) throw new AgentSdkError("INVALID_REQUEST", "Industry pack version is not registered."); return structuredClone(pack); }
}

export class AgentConfigurationRegistry {
  private readonly profiles = new Map<string, AgentConfigurationProfile>();
  constructor(privatePacks: IndustryPackRegistry, privateBaselinePolicies: ApprovalPolicy[]) { this.packs = privatePacks; this.baselinePolicies = privateBaselinePolicies; }
  private readonly packs: IndustryPackRegistry; private readonly baselinePolicies: ApprovalPolicy[];
  save(profile: AgentConfigurationProfile) { const pack = this.packs.resolve(profile.packId, profile.packVersion); validateProfile(profile, pack, this.baselinePolicies); const id = key(profile); if (this.profiles.has(id)) throw new AgentSdkError("INVALID_REQUEST", "Configuration version is immutable and already exists."); this.profiles.set(id, structuredClone(profile)); return structuredClone(profile); }
  resolve(applicationId: string, tenantId: string, environment: AgentConfigurationProfile["environment"], version?: number) { const rows = [...this.profiles.values()].filter(item => item.applicationId === applicationId && item.tenantId === tenantId && item.environment === environment && (version === undefined || item.version === version)).sort((a, b) => b.version - a.version); if (!rows[0]) throw new AgentSdkError("INVALID_REQUEST", "Agent configuration was not found."); return structuredClone(rows[0]); }
}

export function createConfiguredGenericAgents(pack: IndustryPack, profile: AgentConfigurationProfile): AgentDefinition[] {
  validateProfile(profile, pack, []);
  const intents = Object.fromEntries(profile.supportedQuestionIntents.map(intent => [intent, pack.questionIntents[intent]!]));
  const base = [createGenericInventoryWatchAgent(pack.terminology), createGenericReceivablesAgent(pack.terminology), createGenericProfitInsightAgent(pack.terminology), createGenericBusinessAssistantAgent(pack.terminology, intents)];
  return base.filter(agent => profile.enabledAgentKeys.includes(agent.agentKey)).map(agent => configure(agent, profile));
}

export function configuredApprovalPolicies(profile: AgentConfigurationProfile, baseline: ApprovalPolicy[]): ApprovalPolicy[] { return baseline.map(policy => { const configured = profile.approvalRequirements.find(item => item.proposalType === policy.proposalType); return configured ? { ...policy, policyVersion: `${policy.policyVersion}.config-${profile.version}`, requiredRoleSets: configured.requiredRoleSets, expiresAfterMinutes: configured.expiresAfterMinutes } : policy; }); }

function configure(agent: AgentDefinition, profile: AgentConfigurationProfile): AgentDefinition {
  const configuration: JsonObject = { configurationId: profile.configurationId, configurationVersion: profile.version, enabledFindingKeys: profile.enabledFindingKeys, thresholds: profile.thresholds };
  return { ...agent, displayName: profile.agentDisplayNames[agent.agentKey] ?? agent.displayName ?? agent.agentKey, promptVersion: `${agent.promptVersion}.config-${profile.version}`, plan: (input, context) => agent.plan(input, context).map(call => ({ ...call, input: { ...call.input, configuration } })), buildFacts: (results, context, input) => { const packet = agent.buildFacts(results, context, input); return { ...packet, evidence: packet.evidence.map(item => ({ ...item, label: profile.evidenceLabelAliases[item.evidenceType] ?? item.label })) }; } };
}

function validatePack(pack: IndustryPack) { if (!pack.packId || !pack.version || pack.terminology.packId !== pack.packId || pack.terminology.version !== pack.version) throw new AgentSdkError("INVALID_REQUEST", "Industry pack identity and terminology version must match."); if (pack.thresholdDefinitions.some(item => item.applicationEvaluated !== true)) throw new AgentSdkError("INVALID_REQUEST", "Every threshold must be evaluated by the connected application."); }
function validateProfile(profile: AgentConfigurationProfile, pack: IndustryPack, baseline: ApprovalPolicy[]) {
  if (profile.packId !== pack.packId || profile.packVersion !== pack.version || !Number.isInteger(profile.version) || profile.version < 1) throw new AgentSdkError("INVALID_REQUEST", "Configuration and pack versions are invalid.");
  const knownAgents = new Set(["inventory-watch", "receivables-watch", "profit-insight", "business-assistant"]); if (profile.enabledAgentKeys.some(key => !knownAgents.has(key))) throw new AgentSdkError("INVALID_REQUEST", "Configuration enables an unknown agent.");
  if (profile.enabledFindingKeys.some(key => !pack.findingKeys.includes(key))) throw new AgentSdkError("INVALID_REQUEST", "Configuration enables an unknown finding.");
  for (const [key, value] of Object.entries(profile.thresholds)) { const definition = pack.thresholdDefinitions.find(item => item.thresholdKey === key); if (!definition || !Number.isFinite(value) || (definition.minimum !== undefined && value < definition.minimum) || (definition.maximum !== undefined && value > definition.maximum)) throw new AgentSdkError("INVALID_REQUEST", `Threshold ${key} is invalid.`); }
  if (profile.supportedQuestionIntents.some(intent => !pack.questionIntents[intent])) throw new AgentSdkError("INVALID_REQUEST", "Configuration enables an unknown question intent.");
  for (const requirement of profile.approvalRequirements) { const base = baseline.find(item => item.proposalType === requirement.proposalType); if (!base) continue; const preservesRoles = base.requiredRoleSets.every((roles, index) => JSON.stringify(roles) === JSON.stringify(requirement.requiredRoleSets[index])); if (!preservesRoles || requirement.requiredRoleSets.length < base.requiredRoleSets.length || requirement.expiresAfterMinutes > base.expiresAfterMinutes) throw new AgentSdkError("INVALID_REQUEST", "Approval configuration cannot weaken the platform baseline."); }
}
const key = (profile: AgentConfigurationProfile) => `${profile.applicationId}:${profile.environment}:${profile.tenantId}:${profile.version}`;
