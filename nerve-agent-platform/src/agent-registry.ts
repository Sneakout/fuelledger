import { AgentSdkError } from "./errors.ts";
import type { AgentDefinition } from "./runtime-contracts.ts";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    if (!agent.agentKey || !agent.agentVersion || !agent.promptVersion) throw new AgentSdkError("INVALID_REQUEST", "Agent key, agent version, and prompt version are required.");
    if (!Number.isInteger(agent.maxToolCalls) || agent.maxToolCalls < 0) throw new AgentSdkError("INVALID_REQUEST", "Agent tool-call limit must be a non-negative integer.");
    if (!Number.isInteger(agent.maxOutputTokens) || agent.maxOutputTokens < 1) throw new AgentSdkError("INVALID_REQUEST", "Agent output-token limit must be positive.");
    if (new Set(agent.allowedToolIds).size !== agent.allowedToolIds.length) throw new AgentSdkError("INVALID_REQUEST", "Agent tool allow-list contains duplicates.");
    const id = this.id(agent.agentKey, agent.agentVersion);
    if (this.agents.has(id)) throw new AgentSdkError("INVALID_REQUEST", `Agent ${id} is already registered.`);
    this.agents.set(id, agent);
  }

  resolve(agentKey: string, requestedVersion?: string): AgentDefinition {
    if (requestedVersion) {
      const exact = this.agents.get(this.id(agentKey, requestedVersion));
      if (!exact) throw new AgentSdkError("AGENT_NOT_REGISTERED", `Agent ${agentKey}@${requestedVersion} is not registered.`);
      return exact;
    }
    const candidates = [...this.agents.values()].filter(agent => agent.agentKey === agentKey).sort((a, b) => b.agentVersion.localeCompare(a.agentVersion, undefined, { numeric: true }));
    if (!candidates[0]) throw new AgentSdkError("AGENT_NOT_REGISTERED", `Agent ${agentKey} is not registered.`);
    return candidates[0];
  }

  list(): AgentDefinition[] { return [...this.agents.values()]; }
  private id(key: string, version: string) { return `${key}@${version}`; }
}
