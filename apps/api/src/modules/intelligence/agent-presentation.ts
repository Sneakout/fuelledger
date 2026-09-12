export type AgentIconKey = "shift" | "stock" | "profit" | "assistant" | "specialist";

export type AgentPresentation = {
  agentKey: string;
  name: string;
  purpose: string;
  icon: AgentIconKey;
};

const presentations: Record<string, Omit<AgentPresentation, "agentKey">> = {
  "reconciliation-review": { name: "Shift Agent", purpose: "Shifts, collections and handovers", icon: "shift" },
  "inventory-watch": { name: "Stock Agent", purpose: "Tanks, readings, receipts and movement", icon: "stock" },
  "credit-watch": { name: "Credit Agent", purpose: "Customer dues, ageing and reminder drafts", icon: "specialist" },
  "purchase-check": { name: "Purchase Agent", purpose: "Invoices, receipts, rates and supplier payments", icon: "specialist" },
  "profit-insight": { name: "Profit Agent", purpose: "Margin, costs and financial changes", icon: "profit" },
  "business-assistant": { name: "Nerve Assistant", purpose: "Coordinates questions across specialists", icon: "assistant" },
  "owner-assistant": { name: "Nerve Assistant", purpose: "Coordinates questions across specialists", icon: "assistant" },
};

export function agentPresentation(agentKey: string): AgentPresentation {
  const presentation = presentations[agentKey];
  return presentation
    ? { agentKey, ...presentation }
    : { agentKey, name: "Nerve Specialist", purpose: "Reviews relevant business records", icon: "specialist" };
}

export function leadAgentPresentation(agents: AgentPresentation[]): AgentPresentation {
  const unique = [...new Map(agents.map(agent => [agent.agentKey, agent])).values()];
  return unique.length === 1
    ? unique[0]!
    : { agentKey: "nerve-specialist", name: "Nerve Specialist", purpose: "Reviews related business records", icon: "specialist" };
}
