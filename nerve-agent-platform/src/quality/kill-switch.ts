import { AgentSdkError } from "../errors.ts";
export type KillSwitchRule = { ruleId: string; scope: "GLOBAL" | "TENANT" | "AGENT" | "ACTION"; tenantId?: string; agentKey?: string; actionId?: string; reason: string; activatedAt: string; activatedBy: string; active: boolean };
export class OperationalKillSwitch {
  private readonly rules = new Map<string, KillSwitchRule>();
  set(rule: KillSwitchRule) { validate(rule); this.rules.set(rule.ruleId, structuredClone(rule)); }
  deactivate(ruleId: string) { const rule = this.rules.get(ruleId); if (!rule) throw new Error("Kill-switch rule not found."); rule.active = false; }
  assertAgentAllowed(tenantId: string, agentKey: string) { const rule = this.match(tenantId, agentKey, undefined); if (rule) throw new AgentSdkError("SCOPE_DENIED", `Agent disabled by operational safety control: ${rule.reason}`); }
  assertActionAllowed(tenantId: string, actionId: string) { const rule = this.match(tenantId, undefined, actionId); if (rule) throw new AgentSdkError("TOOL_PROHIBITED", `Action disabled by operational safety control: ${rule.reason}`); }
  activeRules() { return structuredClone([...this.rules.values()].filter(item => item.active)); }
  private match(tenantId: string, agentKey?: string, actionId?: string) { return [...this.rules.values()].find(rule => rule.active && (rule.scope === "GLOBAL" || rule.scope === "TENANT" && rule.tenantId === tenantId || rule.scope === "AGENT" && rule.tenantId === tenantId && rule.agentKey === agentKey || rule.scope === "ACTION" && rule.tenantId === tenantId && rule.actionId === actionId)); }
}
function validate(rule: KillSwitchRule) { if (rule.scope === "TENANT" && !rule.tenantId || rule.scope === "AGENT" && (!rule.tenantId || !rule.agentKey) || rule.scope === "ACTION" && (!rule.tenantId || !rule.actionId)) throw new Error("Kill-switch scope identifiers are missing."); }
