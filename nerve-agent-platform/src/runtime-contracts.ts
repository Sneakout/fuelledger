import type { AgentError, AgentRun, EvidenceReference, ExecutionContext, JsonObject, JsonValue, ToolRequest, ToolResult } from "./contracts.ts";
import type { Validator } from "./validation.ts";

export type AgentInvocation = {
  agentKey: string;
  agentVersion?: string;
  context: ExecutionContext;
  input: JsonObject;
  triggerType: AgentRun["triggerType"];
};

export type AgentToolCall = {
  toolId: string;
  input: JsonObject;
};

export type AgentFact = {
  factId: string;
  label: string;
  value: JsonValue;
  evidenceIds: string[];
};

export type FactPacket = {
  facts: AgentFact[];
  evidence: EvidenceReference[];
};

export type AgentClaim = {
  claimId: string;
  text: string;
  factIds: string[];
  evidenceIds: string[];
};

export type AgentNarrative = {
  headline: string;
  summary: string;
  claims: AgentClaim[];
};

export type AgentResponse = {
  run: AgentRun;
  narrative: AgentNarrative;
  narrativeMode: "MODEL" | "DETERMINISTIC" | "DETERMINISTIC_FALLBACK";
  facts: AgentFact[];
  evidence: EvidenceReference[];
  model?: { provider: string; model: string; promptVersion: string };
  measurement?: { durationMs: number; modelDurationMs: number; inputTokens: number; outputTokens: number; fallbackUsed: boolean; fallbackReason?: string };
};

export type AgentDefinition = {
  agentKey: string;
  displayName?: string;
  agentVersion: string;
  promptVersion: string;
  description: string;
  instructions: string;
  outputSchemaId: string;
  allowedToolIds: string[];
  maxToolCalls: number;
  maxOutputTokens: number;
  plan(input: JsonObject, context: ExecutionContext): AgentToolCall[];
  buildFacts(results: ToolResult[], context: ExecutionContext, input?: JsonObject): FactPacket;
  validateOutput: Validator<AgentNarrative>;
  deterministicFallback(facts: FactPacket): AgentNarrative;
};

export type ModelGenerationRequest = {
  instructions: string;
  promptVersion: string;
  outputSchemaId: string;
  input: JsonObject;
  maxOutputTokens: number;
  safetyIdentifier: string;
  signal: AbortSignal;
};

export type ModelGenerationResult = {
  output: unknown;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export interface ModelProvider {
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResult>;
}

export type AuditEvent = {
  eventId: string;
  runId: string;
  tenantId: string;
  sequence: number;
  type: "RUN_STARTED" | "TOOL_STARTED" | "TOOL_COMPLETED" | "MODEL_STARTED" | "MODEL_COMPLETED" | "FALLBACK_USED" | "RUN_COMPLETED" | "RUN_FAILED";
  occurredAt: string;
  detail: JsonObject;
};

export interface AuditStore {
  createRun(run: AgentRun): Promise<void>;
  updateRun(run: AgentRun): Promise<void>;
  append(event: AuditEvent): Promise<void>;
  getRun(runId: string): Promise<AgentRun | undefined>;
  events(runId: string): Promise<AuditEvent[]>;
}

export type RuntimeLogger = {
  info(event: string, detail: JsonObject): void;
  warn(event: string, detail: JsonObject): void;
  error(event: string, detail: JsonObject): void;
};

export type ToolRequestFactory = (call: AgentToolCall, invocation: AgentInvocation, runId: string) => ToolRequest;

export type RuntimeFailure = { run: AgentRun; error: AgentError };
