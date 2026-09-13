import { AgentSdkError } from "./errors.ts";
import type {
  AgentError,
  AgentFinding,
  AgentProposal,
  AgentRun,
  ApprovalRequest,
  EvidenceReference,
  ExecutionContext,
  ExecutionReceipt,
  JsonObject,
  ToolDefinition,
  ToolRequest,
  ToolResult,
} from "./contracts.ts";

export type Validator<T> = (value: unknown, path?: string) => T;

function fail(path: string, message: string): never {
  throw new AgentSdkError("INVALID_REQUEST", `${path}: ${message}`, false);
}

export const object = (value: unknown, path = "value"): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value as Record<string, unknown>;
};

export const string = (value: unknown, path: string, minimum = 1): string => {
  if (typeof value !== "string" || value.length < minimum) fail(path, `must be a string of at least ${minimum} character(s)`);
  return value;
};

export const stringArray = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value.map((item, index) => string(item, `${path}[${index}]`));
};

export const isoDate = (value: unknown, path: string): string => {
  const result = string(value, path);
  if (!Number.isFinite(Date.parse(result))) fail(path, "must be an ISO date-time");
  return result;
};

export const oneOf = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
  if (typeof value !== "string" || !values.includes(value as T)) fail(path, `must be one of ${values.join(", ")}`);
  return value as T;
};

export const jsonObject: Validator<JsonObject> = (value, path = "value") => {
  const result = object(value, path);
  try { JSON.stringify(result); } catch { fail(path, "must be JSON serializable"); }
  return result as JsonObject;
};

export const executionContextSchema: Validator<ExecutionContext> = (value, path = "context") => {
  const v = object(value, path);
  return {
    contractVersion: string(v.contractVersion, `${path}.contractVersion`),
    applicationId: string(v.applicationId, `${path}.applicationId`),
    environment: oneOf(v.environment, `${path}.environment`, ["development", "staging", "production"] as const),
    tenantId: string(v.tenantId, `${path}.tenantId`),
    actorId: string(v.actorId, `${path}.actorId`),
    roles: stringArray(v.roles, `${path}.roles`),
    permittedLocationIds: stringArray(v.permittedLocationIds, `${path}.permittedLocationIds`),
    grantedScopes: stringArray(v.grantedScopes, `${path}.grantedScopes`),
    correlationId: string(v.correlationId, `${path}.correlationId`),
    issuedAt: isoDate(v.issuedAt, `${path}.issuedAt`),
    expiresAt: isoDate(v.expiresAt, `${path}.expiresAt`),
  };
};

export const evidenceReferenceSchema: Validator<EvidenceReference> = (value, path = "evidence") => {
  const v = object(value, path);
  const result: EvidenceReference = {
    evidenceId: string(v.evidenceId, `${path}.evidenceId`),
    evidenceType: string(v.evidenceType, `${path}.evidenceType`),
    applicationId: string(v.applicationId, `${path}.applicationId`),
    tenantId: string(v.tenantId, `${path}.tenantId`),
    resourceId: string(v.resourceId, `${path}.resourceId`),
    label: string(v.label, `${path}.label`),
  };
  for (const key of ["observedAt", "periodStart", "periodEnd"] as const) if (v[key] !== undefined) result[key] = isoDate(v[key], `${path}.${key}`);
  for (const key of ["version", "resolverPath"] as const) if (v[key] !== undefined) result[key] = string(v[key], `${path}.${key}`);
  return result;
};

export const toolDefinitionSchema: Validator<ToolDefinition> = (value, path = "tool") => {
  const v = object(value, path);
  const timeoutMs = v.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail(`${path}.timeoutMs`, "must be an integer from 1 to 60000");
  if (typeof v.requiresApproval !== "boolean" || typeof v.idempotent !== "boolean") fail(path, "approval and idempotency flags must be boolean");
  return {
    toolId: string(v.toolId, `${path}.toolId`), contractVersion: string(v.contractVersion, `${path}.contractVersion`),
    description: string(v.description, `${path}.description`),
    actionClass: oneOf(v.actionClass, `${path}.actionClass`, ["OBSERVE", "PROPOSE", "APPROVE", "EXECUTE", "PROHIBITED"] as const),
    riskLevel: oneOf(v.riskLevel, `${path}.riskLevel`, ["R0", "R1", "R2", "R3", "R4"] as const),
    requiredScopes: stringArray(v.requiredScopes, `${path}.requiredScopes`), requiresApproval: v.requiresApproval,
    idempotent: v.idempotent, timeoutMs, inputSchemaId: string(v.inputSchemaId, `${path}.inputSchemaId`), outputSchemaId: string(v.outputSchemaId, `${path}.outputSchemaId`),
  };
};

export const toolRequestSchema: Validator<ToolRequest> = (value, path = "request") => {
  const v = object(value, path);
  const result: ToolRequest = {
    requestId: string(v.requestId, `${path}.requestId`), toolId: string(v.toolId, `${path}.toolId`),
    contractVersion: string(v.contractVersion, `${path}.contractVersion`), context: executionContextSchema(v.context, `${path}.context`),
    input: jsonObject(v.input, `${path}.input`),
  };
  if (v.idempotencyKey !== undefined) result.idempotencyKey = string(v.idempotencyKey, `${path}.idempotencyKey`, 16);
  if (v.approvalId !== undefined) result.approvalId = string(v.approvalId, `${path}.approvalId`);
  return result;
};

export const toolResultSchema: Validator<ToolResult> = (value, path = "result") => {
  const v = object(value, path);
  if (!Array.isArray(v.evidence)) fail(`${path}.evidence`, "must be an array");
  return {
    requestId: string(v.requestId, `${path}.requestId`), toolId: string(v.toolId, `${path}.toolId`),
    contractVersion: string(v.contractVersion, `${path}.contractVersion`), status: oneOf(v.status, `${path}.status`, ["SUCCEEDED"] as const),
    output: jsonObject(v.output, `${path}.output`), evidence: v.evidence.map((item, i) => evidenceReferenceSchema(item, `${path}.evidence[${i}]`)),
    calculatedAt: isoDate(v.calculatedAt, `${path}.calculatedAt`),
  };
};

const optionalString = (v: Record<string, unknown>, key: string, path: string) => v[key] === undefined ? undefined : string(v[key], `${path}.${key}`);
const evidenceArray = (value: unknown, path: string) => {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value.map((item, index) => evidenceReferenceSchema(item, `${path}[${index}]`));
};

// Persisted-record validators cover every required identity, state, hash, and evidence field.
export const coreRecordSchemas: {
  AgentFinding: Validator<AgentFinding>;
  AgentProposal: Validator<AgentProposal>;
  ApprovalRequest: Validator<ApprovalRequest>;
  ExecutionReceipt: Validator<ExecutionReceipt>;
  AgentRun: Validator<AgentRun>;
  AgentError: Validator<AgentError>;
} = {
  AgentFinding: (value, path = "finding") => {
    const v = object(value, path);
    return {
      findingId: string(v.findingId, `${path}.findingId`), runId: string(v.runId, `${path}.runId`),
      agentKey: string(v.agentKey, `${path}.agentKey`), agentVersion: string(v.agentVersion, `${path}.agentVersion`),
      tenantId: string(v.tenantId, `${path}.tenantId`), locationIds: stringArray(v.locationIds, `${path}.locationIds`),
      type: string(v.type, `${path}.type`), severity: oneOf(v.severity, `${path}.severity`, ["INFORMATION", "POSITIVE", "ATTENTION", "URGENT"] as const),
      title: string(v.title, `${path}.title`), summary: string(v.summary, `${path}.summary`), factIds: stringArray(v.factIds, `${path}.factIds`),
      evidence: evidenceArray(v.evidence, `${path}.evidence`), detectedAt: isoDate(v.detectedAt, `${path}.detectedAt`),
      deduplicationKey: string(v.deduplicationKey, `${path}.deduplicationKey`),
    };
  },
  AgentProposal: (value, path = "proposal") => {
    const v = object(value, path);
    return {
      proposalId: string(v.proposalId, `${path}.proposalId`), findingId: string(v.findingId, `${path}.findingId`), tenantId: string(v.tenantId, `${path}.tenantId`),
      proposalType: string(v.proposalType, `${path}.proposalType`), targetToolId: string(v.targetToolId, `${path}.targetToolId`), payload: jsonObject(v.payload, `${path}.payload`),
      explanation: string(v.explanation, `${path}.explanation`), payloadHash: string(v.payloadHash, `${path}.payloadHash`), factHash: string(v.factHash, `${path}.factHash`), evidenceHash: string(v.evidenceHash, `${path}.evidenceHash`),
      riskLevel: oneOf(v.riskLevel, `${path}.riskLevel`, ["R0", "R1", "R2", "R3", "R4"] as const),
      requiredApproverRoles: stringArray(v.requiredApproverRoles, `${path}.requiredApproverRoles`),
      status: oneOf(v.status, `${path}.status`, ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "STALE"] as const),
      createdAt: isoDate(v.createdAt, `${path}.createdAt`), expiresAt: isoDate(v.expiresAt, `${path}.expiresAt`),
    };
  },
  ApprovalRequest: (value, path = "approval") => {
    const v = object(value, path);
    const result: ApprovalRequest = {
      approvalId: string(v.approvalId, `${path}.approvalId`), proposalId: string(v.proposalId, `${path}.proposalId`), tenantId: string(v.tenantId, `${path}.tenantId`),
      payloadHash: string(v.payloadHash, `${path}.payloadHash`), factHash: string(v.factHash, `${path}.factHash`), evidenceHash: string(v.evidenceHash, `${path}.evidenceHash`), policyVersion: string(v.policyVersion, `${path}.policyVersion`),
      requiredRoleSets: Array.isArray(v.requiredRoleSets) ? v.requiredRoleSets.map((roles, index) => stringArray(roles, `${path}.requiredRoleSets[${index}]`)) : fail(`${path}.requiredRoleSets`, "must be an array"),
      requiredApprovals: typeof v.requiredApprovals === "number" && Number.isInteger(v.requiredApprovals) && v.requiredApprovals > 0 ? v.requiredApprovals : fail(`${path}.requiredApprovals`, "must be a positive integer"),
      decisions: Array.isArray(v.decisions) ? v.decisions.map((item, index) => {
        const decision = object(item, `${path}.decisions[${index}]`);
        return { decisionId: string(decision.decisionId, `${path}.decisions[${index}].decisionId`), actorId: string(decision.actorId, `${path}.decisions[${index}].actorId`), actorRoles: stringArray(decision.actorRoles, `${path}.decisions[${index}].actorRoles`), decision: oneOf(decision.decision, `${path}.decisions[${index}].decision`, ["APPROVE", "REJECT"] as const), decidedAt: isoDate(decision.decidedAt, `${path}.decisions[${index}].decidedAt`), ...(decision.reason === undefined ? {} : { reason: string(decision.reason, `${path}.decisions[${index}].reason`) }) };
      }) : fail(`${path}.decisions`, "must be an array"),
      requestedAt: isoDate(v.requestedAt, `${path}.requestedAt`), expiresAt: isoDate(v.expiresAt, `${path}.expiresAt`),
      status: oneOf(v.status, `${path}.status`, ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "STALE", "CONSUMED"] as const),
    };
    const decidedByActorId = optionalString(v, "decidedByActorId", path); if (decidedByActorId) result.decidedByActorId = decidedByActorId;
    if (v.decidedAt !== undefined) result.decidedAt = isoDate(v.decidedAt, `${path}.decidedAt`);
    return result;
  },
  ExecutionReceipt: (value, path = "receipt") => {
    const v = object(value, path);
    const result: ExecutionReceipt = {
      executionId: string(v.executionId, `${path}.executionId`), approvalId: string(v.approvalId, `${path}.approvalId`),
      applicationId: string(v.applicationId, `${path}.applicationId`), tenantId: string(v.tenantId, `${path}.tenantId`), toolId: string(v.toolId, `${path}.toolId`),
      idempotencyKeyHash: string(v.idempotencyKeyHash, `${path}.idempotencyKeyHash`),
      status: oneOf(v.status, `${path}.status`, ["SUCCEEDED", "FAILED", "UNKNOWN", "REJECTED"] as const), executedAt: isoDate(v.executedAt, `${path}.executedAt`),
    };
    const sourceCommandId = optionalString(v, "sourceCommandId", path); if (sourceCommandId) result.sourceCommandId = sourceCommandId;
    if (v.result !== undefined) result.result = jsonObject(v.result, `${path}.result`);
    if (v.error !== undefined) result.error = coreRecordSchemas.AgentError(v.error, `${path}.error`);
    return result;
  },
  AgentRun: (value, path = "run") => {
    const v = object(value, path);
    const result: AgentRun = {
      runId: string(v.runId, `${path}.runId`), correlationId: string(v.correlationId, `${path}.correlationId`), applicationId: string(v.applicationId, `${path}.applicationId`),
      tenantId: string(v.tenantId, `${path}.tenantId`), actorId: string(v.actorId, `${path}.actorId`), agentKey: string(v.agentKey, `${path}.agentKey`), agentVersion: string(v.agentVersion, `${path}.agentVersion`),
      triggerType: oneOf(v.triggerType, `${path}.triggerType`, ["USER", "EVENT", "SCHEDULE", "RETRY", "EVALUATION"] as const),
      status: oneOf(v.status, `${path}.status`, ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const),
      toolRequestIds: stringArray(v.toolRequestIds, `${path}.toolRequestIds`), findingIds: stringArray(v.findingIds, `${path}.findingIds`), startedAt: isoDate(v.startedAt, `${path}.startedAt`),
    };
    if (v.completedAt !== undefined) result.completedAt = isoDate(v.completedAt, `${path}.completedAt`);
    if (v.error !== undefined) result.error = coreRecordSchemas.AgentError(v.error, `${path}.error`);
    return result;
  },
  AgentError: (value, path = "error") => {
    const v = object(value, path);
    if (typeof v.retryable !== "boolean") fail(`${path}.retryable`, "must be a boolean");
    const result: AgentError = {
      code: oneOf(v.code, `${path}.code`, ["INVALID_REQUEST", "INVALID_CONTEXT", "SIGNATURE_INVALID", "CONTEXT_EXPIRED", "REPLAY_DETECTED", "CONTRACT_VERSION_UNSUPPORTED", "TOOL_NOT_REGISTERED", "AGENT_NOT_REGISTERED", "TOOL_NOT_ALLOWED", "TOOL_PROHIBITED", "SCOPE_DENIED", "TENANT_MISMATCH", "LOCATION_DENIED", "APPROVAL_REQUIRED", "IDEMPOTENCY_REQUIRED", "IDEMPOTENCY_CONFLICT", "INPUT_INVALID", "OUTPUT_INVALID", "EVIDENCE_INVALID", "STRUCTURED_OUTPUT_INVALID", "USAGE_LIMIT_EXCEEDED", "EXECUTION_TIMEOUT", "EXECUTION_CANCELLED", "TOOL_FAILED"] as const),
      message: string(v.message, `${path}.message`), retryable: v.retryable,
    };
    const correlationId = optionalString(v, "correlationId", path); if (correlationId) result.correlationId = correlationId;
    if (v.details !== undefined) result.details = jsonObject(v.details, `${path}.details`);
    return result;
  },
};
