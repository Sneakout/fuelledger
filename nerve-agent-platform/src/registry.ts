import type { JsonObject, ToolDefinition, ToolRequest, ToolResult } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import { fingerprint, InMemoryIdempotencyStore, replayOrConflict, type IdempotencyStore } from "./idempotency.ts";
import { negotiateContractVersion } from "./versioning.ts";
import { evidenceReferenceSchema, toolDefinitionSchema, toolRequestSchema, toolResultSchema, type Validator } from "./validation.ts";

export type ToolHandler<I extends JsonObject, O extends JsonObject> = (request: ToolRequest<I>, signal: AbortSignal) => Promise<{ output: O; evidence: ToolResult<O>["evidence"]; calculatedAt?: string }>;
export type RegisteredTool<I extends JsonObject = JsonObject, O extends JsonObject = JsonObject> = {
  definition: ToolDefinition;
  validateInput: Validator<I>;
  validateOutput: Validator<O>;
  handler: ToolHandler<I, O>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly options: { applicationId: string; supportedVersions?: readonly string[]; idempotencyStore?: IdempotencyStore };
  constructor(options: { applicationId: string; supportedVersions?: readonly string[]; idempotencyStore?: IdempotencyStore }) { this.options = options; }

  register<I extends JsonObject, O extends JsonObject>(tool: RegisteredTool<I, O>): void {
    const definition = toolDefinitionSchema(tool.definition);
    if (definition.actionClass === "PROHIBITED") throw new AgentSdkError("TOOL_PROHIBITED", "Prohibited tools cannot be registered.");
    if (this.tools.has(definition.toolId)) throw new AgentSdkError("INVALID_REQUEST", `Tool ${definition.toolId} is already registered.`);
    this.tools.set(definition.toolId, tool as unknown as RegisteredTool);
  }

  definitions(): ToolDefinition[] { return [...this.tools.values()].map(tool => tool.definition); }
  definition(toolId: string): ToolDefinition | undefined { return this.tools.get(toolId)?.definition; }

  async execute(untrustedRequest: unknown, options: { signal?: AbortSignal } = {}): Promise<ToolResult> {
    const request = toolRequestSchema(untrustedRequest);
    const tool = this.tools.get(request.toolId);
    if (!tool) throw new AgentSdkError("TOOL_NOT_REGISTERED", `Tool ${request.toolId} is not registered.`, false, undefined, request.context.correlationId);
    const version = negotiateContractVersion(request.contractVersion, this.options.supportedVersions ?? [tool.definition.contractVersion]);
    if (request.context.applicationId !== this.options.applicationId) throw new AgentSdkError("INVALID_CONTEXT", "Execution context belongs to another application.");
    if (request.context.contractVersion.split(".")[0] !== version.split(".")[0]) throw new AgentSdkError("CONTRACT_VERSION_UNSUPPORTED", "Context and request contract versions are incompatible.");
    if (new Date(request.context.expiresAt) <= new Date()) throw new AgentSdkError("CONTEXT_EXPIRED", "Execution context has expired.");
    const missing = tool.definition.requiredScopes.filter(scope => !request.context.grantedScopes.includes(scope));
    if (missing.length) throw new AgentSdkError("SCOPE_DENIED", "Required tool scope was not granted.", false, { missingScopes: missing });
    if (tool.definition.requiresApproval && !request.approvalId) throw new AgentSdkError("APPROVAL_REQUIRED", "This tool requires an approved request.");
    if (tool.definition.idempotent && !request.idempotencyKey) throw new AgentSdkError("IDEMPOTENCY_REQUIRED", "This tool requires an idempotency key.");
    request.input = tool.validateInput(request.input, "request.input");
    const store = this.options.idempotencyStore ?? defaultStore;
    const dedupeKey = request.idempotencyKey ? `${request.context.tenantId}:${request.toolId}:${request.idempotencyKey}` : undefined;
    const requestFingerprint = fingerprint({ toolId: request.toolId, tenantId: request.context.tenantId, input: request.input, approvalId: request.approvalId });
    if (dedupeKey) {
      const prior = await replayOrConflict(store, dedupeKey, requestFingerprint);
      if (prior) return prior;
    }
    const timeout = AbortSignal.timeout(tool.definition.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let handled: Awaited<ReturnType<typeof tool.handler>>;
    try {
      handled = await abortable(tool.handler(request, signal), signal);
      if (signal.aborted) throw signal.reason;
    } catch (error) {
      if (options.signal?.aborted) throw new AgentSdkError("EXECUTION_CANCELLED", "Tool execution was cancelled.", false, undefined, request.context.correlationId);
      if (timeout.aborted) throw new AgentSdkError("EXECUTION_TIMEOUT", `Tool ${request.toolId} exceeded its timeout.`, true, undefined, request.context.correlationId);
      throw error;
    }
    const output = tool.validateOutput(handled.output, "result.output");
    const evidence = handled.evidence.map((item, index) => evidenceReferenceSchema(item, `result.evidence[${index}]`));
    for (const item of evidence) {
      if (item.applicationId !== request.context.applicationId || item.tenantId !== request.context.tenantId) throw new AgentSdkError("EVIDENCE_INVALID", "Evidence belongs to another application or tenant.");
    }
    const result = toolResultSchema({ requestId: request.requestId, toolId: request.toolId, contractVersion: version, status: "SUCCEEDED", output, evidence, calculatedAt: handled.calculatedAt ?? new Date().toISOString() });
    if (dedupeKey) await store.put(dedupeKey, { fingerprint: requestFingerprint, result });
    return result;
  }
}

const defaultStore = new InMemoryIdempotencyStore();

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
