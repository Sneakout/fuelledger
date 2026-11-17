import { findFuelNerveAgent } from "@fuelledger/shared";

export type AgentIconKey = "shift" | "stock" | "profit" | "assistant" | "specialist";

export type AgentPresentation = {
  agentKey: string;
  name: string;
  purpose: string;
  icon: AgentIconKey;
};

export function agentPresentation(agentKey: string): AgentPresentation {
  const presentation = findFuelNerveAgent(agentKey);
  return presentation
    ? { agentKey: presentation.agentKey, name: presentation.name, purpose: presentation.purpose, icon: presentation.icon }
    : { agentKey, name: "Nerve Specialist", purpose: "Reviews relevant business records", icon: "specialist" };
}

export function leadAgentPresentation(agents: AgentPresentation[]): AgentPresentation {
  const unique = [...new Map(agents.map(agent => [agent.agentKey, agent])).values()];
  return unique.length === 1
    ? unique[0]!
    : { agentKey: "nerve-specialist", name: "Nerve Specialist", purpose: "Reviews related business records", icon: "specialist" };
}
