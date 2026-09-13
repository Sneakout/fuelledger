import type { ToolDefinition } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import type { AgentDefinition } from "./runtime-contracts.ts";

export function authorizeAgentTool(agent: AgentDefinition, tool: ToolDefinition | undefined): ToolDefinition {
  if (!tool) throw new AgentSdkError("TOOL_NOT_REGISTERED", "The agent requested an unregistered tool.");
  if (!agent.allowedToolIds.includes(tool.toolId)) throw new AgentSdkError("TOOL_NOT_ALLOWED", `Agent ${agent.agentKey} cannot call ${tool.toolId}.`);
  if (tool.actionClass !== "OBSERVE") throw new AgentSdkError("TOOL_NOT_ALLOWED", "Milestone 2 runtime permits only OBSERVE tools.");
  return tool;
}
