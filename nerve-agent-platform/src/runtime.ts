import { randomUUID } from "node:crypto";
import type { AgentRun, JsonObject, SignedEnvelope, ToolRequest, ToolResult } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import { authorizeAgentTool } from "./policy.ts";
import { hashedSafetyIdentifier } from "./safety.ts";
import type { AgentInvocation, AgentResponse, AuditEvent, AuditStore, FactPacket, ModelProvider, RuntimeLogger } from "./runtime-contracts.ts";
import type { VerificationKeyResolver, NonceStore } from "./signing.ts";
import { verifyEnvelope } from "./signing.ts";
import { executionContextSchema, jsonObject, object, oneOf, string } from "./validation.ts";
import type { AgentRegistry } from "./agent-registry.ts";
import type { ToolRegistry } from "./registry.ts";
import type { TenantUsageLimiter } from "./usage.ts";
import { silentLogger } from "./audit.ts";
import { validateGrounding, validateNarrativeNumbers } from "./model.ts";

export type NerveRuntimeOptions = {
  agents: AgentRegistry; tools: ToolRegistry; model: ModelProvider; audit: AuditStore; usage: TenantUsageLimiter;
  resolveApplicationKey: VerificationKeyResolver; nonceStore: NonceStore; safetyIdentifierSalt: string;
  logger?: RuntimeLogger; modelTimeoutMs?: number;
};

export class NerveRuntime {
  private readonly options: NerveRuntimeOptions;
  constructor(options: NerveRuntimeOptions) { this.options = options; }

  async execute(envelope: SignedEnvelope<AgentInvocation>, options: { signal?: AbortSignal } = {}): Promise<AgentResponse> {
    const runStartedMs = Date.now();
    // 1–2: authenticate the application, then validate its trusted execution context.
    const raw = await verifyEnvelope(envelope, this.options.resolveApplicationKey, this.options.nonceStore);
    const invocation = validateInvocation(raw);
    const context = invocation.context;
    const agent = this.options.agents.resolve(invocation.agentKey, invocation.agentVersion);
    const run: AgentRun = {
      runId: randomUUID(), correlationId: context.correlationId, applicationId: context.applicationId, tenantId: context.tenantId,
      actorId: context.actorId, agentKey: agent.agentKey, agentVersion: agent.agentVersion, triggerType: invocation.triggerType,
      status: "RUNNING", toolRequestIds: [], findingIds: [], startedAt: new Date().toISOString(),
    };
    let sequence = 0;
    const append = async (type: AuditEvent["type"], detail: JsonObject) => this.options.audit.append({ eventId: randomUUID(), runId: run.runId, tenantId: run.tenantId, sequence: ++sequence, type, occurredAt: new Date().toISOString(), detail });
    await this.options.audit.createRun(run);
    await append("RUN_STARTED", { agentKey: agent.agentKey, agentVersion: agent.agentVersion, promptVersion: agent.promptVersion });
    this.log("info", "nerve.run.started", run, { agentKey: agent.agentKey });
    try {
      this.throwIfCancelled(options.signal);
      // 3–4: resolve agent, build its deterministic plan, then restrict tools before any call.
      const plan = agent.plan(invocation.input, context);
      if (plan.length > agent.maxToolCalls) throw new AgentSdkError("USAGE_LIMIT_EXCEEDED", "Agent tool-call limit exceeded.");
      for (const call of plan) authorizeAgentTool(agent, this.options.tools.definition(call.toolId));
      const usageKey = await this.options.usage.reserve(context.tenantId, plan.length, agent.maxOutputTokens);
      // 5: invoke only application-owned, registered tools.
      const results: ToolResult[] = [];
      for (const call of plan) {
        this.throwIfCancelled(options.signal);
        const request: ToolRequest = { requestId: randomUUID(), toolId: call.toolId, contractVersion: context.contractVersion, context, input: call.input };
        run.toolRequestIds.push(request.requestId);
        await append("TOOL_STARTED", { requestId: request.requestId, toolId: call.toolId });
        const result = await this.options.tools.execute(request, { signal: options.signal });
        results.push(result);
        await append("TOOL_COMPLETED", { requestId: request.requestId, toolId: call.toolId, evidenceIds: result.evidence.map(item => item.evidenceId) });
      }
      // 6: reduce results to the agent-defined minimum fact packet.
      const facts = agent.buildFacts(results, context, invocation.input);
      validateFactPacket(facts, context.applicationId, context.tenantId);
      let narrativeMode: AgentResponse["narrativeMode"] = "MODEL";
      let narrative;
      let modelMetadata: AgentResponse["model"];
      let modelDurationMs = 0, modelAttemptStartedMs = 0, inputTokens = 0, outputTokens = 0, fallbackReason: string | undefined;
      // 7–9: generate structured output, ground it, and fail safely to deterministic copy.
      try {
        await append("MODEL_STARTED", { provider: "configured", promptVersion: agent.promptVersion, factCount: facts.facts.length });
        const timeout = AbortSignal.timeout(this.options.modelTimeoutMs ?? 20_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const modelStartedMs = Date.now(); modelAttemptStartedMs = modelStartedMs;
        const generated = await abortable(this.options.model.generate({
          instructions: agent.instructions, promptVersion: agent.promptVersion, outputSchemaId: agent.outputSchemaId,
          input: { facts: facts.facts, evidence: facts.evidence.map(item => ({ evidenceId: item.evidenceId, evidenceType: item.evidenceType, label: item.label })) },
          maxOutputTokens: agent.maxOutputTokens, safetyIdentifier: hashedSafetyIdentifier(context, this.options.safetyIdentifierSalt), signal,
        }), signal);
        modelDurationMs = Date.now() - modelStartedMs; inputTokens = generated.usage.inputTokens; outputTokens = generated.usage.outputTokens;
        if (generated.usage.outputTokens > agent.maxOutputTokens) throw new AgentSdkError("USAGE_LIMIT_EXCEEDED", "Agent output-token limit exceeded.");
        await this.options.usage.recordTokens(usageKey, generated.usage.inputTokens, generated.usage.outputTokens);
        narrative = agent.validateOutput(generated.output, "model.output");
        validateGrounding(narrative, new Set(facts.facts.map(item => item.factId)), new Set(facts.evidence.map(item => item.evidenceId)));
        validateNarrativeNumbers(narrative, facts.facts);
        modelMetadata = { provider: generated.provider, model: generated.model, promptVersion: agent.promptVersion };
        await append("MODEL_COMPLETED", { provider: generated.provider, model: generated.model, inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens });
      } catch (error) {
        if (modelAttemptStartedMs && modelDurationMs === 0) modelDurationMs = Date.now() - modelAttemptStartedMs;
        if (options.signal?.aborted) throw new AgentSdkError("EXECUTION_CANCELLED", "Agent execution was cancelled.");
        narrative = agent.deterministicFallback(facts);
        narrative = agent.validateOutput(narrative, "fallback.output");
        validateGrounding(narrative, new Set(facts.facts.map(item => item.factId)), new Set(facts.evidence.map(item => item.evidenceId)));
        narrativeMode = "DETERMINISTIC_FALLBACK";
        fallbackReason = safeErrorCode(error);
        await append("FALLBACK_USED", { reason: safeErrorCode(error) });
        this.log("warn", "nerve.run.fallback", run, { reason: safeErrorCode(error) });
      }
      // 10: complete and persist the run before returning output.
      run.status = "COMPLETED"; run.completedAt = new Date().toISOString();
      await this.options.audit.updateRun(run);
      const measurement = { durationMs: Date.now() - runStartedMs, modelDurationMs, inputTokens, outputTokens, fallbackUsed: narrativeMode !== "MODEL", ...(fallbackReason ? { fallbackReason } : {}) };
      await append("RUN_COMPLETED", { narrativeMode, factCount: facts.facts.length, evidenceCount: facts.evidence.length, ...measurement });
      this.log("info", "nerve.run.completed", run, { narrativeMode });
      return { run, narrative, narrativeMode, facts: facts.facts, evidence: facts.evidence, measurement, ...(modelMetadata ? { model: modelMetadata } : {}) };
    } catch (error) {
      const sdkError = error instanceof AgentSdkError ? error : new AgentSdkError("TOOL_FAILED", "Agent execution failed.");
      run.status = "FAILED"; run.completedAt = new Date().toISOString(); run.error = sdkError.toAgentError();
      await this.options.audit.updateRun(run);
      await append("RUN_FAILED", { code: sdkError.code });
      this.log("error", "nerve.run.failed", run, { code: sdkError.code });
      throw sdkError;
    }
  }

  private throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new AgentSdkError("EXECUTION_CANCELLED", "Agent execution was cancelled."); }
  private log(level: keyof RuntimeLogger, event: string, run: AgentRun, detail: JsonObject) { (this.options.logger ?? silentLogger)[level](event, { runId: run.runId, correlationId: run.correlationId, tenantId: run.tenantId, ...detail }); }
}

function validateInvocation(value: unknown): AgentInvocation {
  const v = object(value, "invocation");
  const context = executionContextSchema(v.context, "invocation.context");
  if (new Date(context.expiresAt) <= new Date()) throw new AgentSdkError("CONTEXT_EXPIRED", "Execution context has expired.");
  return { agentKey: string(v.agentKey, "invocation.agentKey"), ...(v.agentVersion === undefined ? {} : { agentVersion: string(v.agentVersion, "invocation.agentVersion") }), context, input: jsonObject(v.input, "invocation.input"), triggerType: oneOf(v.triggerType, "invocation.triggerType", ["USER", "EVENT", "SCHEDULE", "RETRY", "EVALUATION"] as const) };
}

function validateFactPacket(packet: FactPacket, applicationId: string, tenantId: string) {
  const evidenceIds = new Set<string>();
  for (const evidence of packet.evidence) {
    if (evidence.applicationId !== applicationId || evidence.tenantId !== tenantId) throw new AgentSdkError("EVIDENCE_INVALID", "Fact packet contains cross-application or cross-tenant evidence.");
    if (evidenceIds.has(evidence.evidenceId)) throw new AgentSdkError("EVIDENCE_INVALID", "Fact packet contains duplicate evidence IDs.");
    evidenceIds.add(evidence.evidenceId);
  }
  const factIds = new Set<string>();
  for (const fact of packet.facts) {
    if (!fact.factId || factIds.has(fact.factId)) throw new AgentSdkError("OUTPUT_INVALID", "Fact IDs must be present and unique.");
    if (fact.evidenceIds.some(id => !evidenceIds.has(id))) throw new AgentSdkError("EVIDENCE_INVALID", "A fact references unknown evidence.");
    factIds.add(fact.factId);
  }
}

const safeErrorCode = (error: unknown) => error instanceof AgentSdkError ? error.code : error instanceof Error ? error.name : "UNKNOWN";

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
