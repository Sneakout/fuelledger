import type { AgentError, AgentErrorCode, AgentErrorEnvelope, JsonObject } from "./contracts.ts";

export class AgentSdkError extends Error {
  public readonly code: AgentErrorCode;
  public readonly retryable: boolean;
  public readonly details?: JsonObject;
  public readonly correlationId?: string;

  constructor(
    code: AgentErrorCode,
    message: string,
    retryable = false,
    details?: JsonObject,
    correlationId?: string,
  ) {
    super(message);
    this.name = "AgentSdkError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.correlationId = correlationId;
  }

  toAgentError(): AgentError {
    return { code: this.code, message: this.message, retryable: this.retryable, ...(this.details ? { details: this.details } : {}), ...(this.correlationId ? { correlationId: this.correlationId } : {}) };
  }
}

export function errorEnvelope(error: unknown, correlationId?: string): AgentErrorEnvelope {
  if (error instanceof AgentSdkError) return { error: { ...error.toAgentError(), ...(correlationId && !error.correlationId ? { correlationId } : {}) } };
  return { error: { code: "TOOL_FAILED", message: "The registered application tool failed.", retryable: false, ...(correlationId ? { correlationId } : {}) } };
}
