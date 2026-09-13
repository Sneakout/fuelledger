export const CONTRACT_VERSION = "1.0" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ActionClass = "OBSERVE" | "PROPOSE" | "APPROVE" | "EXECUTE" | "PROHIBITED";
export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export type ExecutionContext = {
  contractVersion: string;
  applicationId: string;
  environment: "development" | "staging" | "production";
  tenantId: string;
  actorId: string;
  roles: string[];
  permittedLocationIds: string[];
  grantedScopes: string[];
  correlationId: string;
  issuedAt: string;
  expiresAt: string;
};

export type EvidenceReference = {
  evidenceId: string;
  evidenceType: string;
  applicationId: string;
  tenantId: string;
  resourceId: string;
  label: string;
  observedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  version?: string;
  resolverPath?: string;
};

export type ToolDefinition = {
  toolId: string;
  contractVersion: string;
  description: string;
  actionClass: ActionClass;
  riskLevel: RiskLevel;
  requiredScopes: string[];
  requiresApproval: boolean;
  idempotent: boolean;
  timeoutMs: number;
  inputSchemaId: string;
  outputSchemaId: string;
};

export type ToolRequest<TInput extends JsonObject = JsonObject> = {
  requestId: string;
  toolId: string;
  contractVersion: string;
  context: ExecutionContext;
  input: TInput;
  idempotencyKey?: string;
  approvalId?: string;
};

export type ToolResult<TOutput extends JsonObject = JsonObject> = {
  requestId: string;
  toolId: string;
  contractVersion: string;
  status: "SUCCEEDED";
  output: TOutput;
  evidence: EvidenceReference[];
  calculatedAt: string;
};

export type FindingSeverity = "INFORMATION" | "POSITIVE" | "ATTENTION" | "URGENT";

export type AgentFinding = {
  findingId: string;
  runId: string;
  agentKey: string;
  agentVersion: string;
  tenantId: string;
  locationIds: string[];
  type: string;
  severity: FindingSeverity;
  title: string;
  summary: string;
  factIds: string[];
  evidence: EvidenceReference[];
  detectedAt: string;
  deduplicationKey: string;
};

export type AgentProposal<TPayload extends JsonObject = JsonObject> = {
  proposalId: string;
  findingId: string;
  tenantId: string;
  proposalType: string;
  targetToolId: string;
  payload: TPayload;
  explanation: string;
  payloadHash: string;
  factHash: string;
  evidenceHash: string;
  riskLevel: RiskLevel;
  requiredApproverRoles: string[];
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "STALE";
  createdAt: string;
  expiresAt: string;
};

export type ApprovalRequest = {
  approvalId: string;
  proposalId: string;
  tenantId: string;
  payloadHash: string;
  factHash: string;
  evidenceHash: string;
  policyVersion: string;
  requiredRoleSets: string[][];
  requiredApprovals: number;
  decisions: ApprovalDecision[];
  requestedAt: string;
  expiresAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "STALE" | "CONSUMED";
  decidedByActorId?: string;
  decidedAt?: string;
};

export type ApprovalDecision = {
  decisionId: string;
  actorId: string;
  actorRoles: string[];
  decision: "APPROVE" | "REJECT";
  decidedAt: string;
  reason?: string;
};

export type ExecutionReceipt = {
  executionId: string;
  approvalId: string;
  applicationId: string;
  tenantId: string;
  toolId: string;
  idempotencyKeyHash: string;
  status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "REJECTED";
  sourceCommandId?: string;
  executedAt: string;
  result?: JsonObject;
  error?: AgentError;
};

export type AgentRun = {
  runId: string;
  correlationId: string;
  applicationId: string;
  tenantId: string;
  actorId: string;
  agentKey: string;
  agentVersion: string;
  triggerType: "USER" | "EVENT" | "SCHEDULE" | "RETRY" | "EVALUATION";
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  toolRequestIds: string[];
  findingIds: string[];
  startedAt: string;
  completedAt?: string;
  error?: AgentError;
};

export type AgentErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CONTEXT"
  | "SIGNATURE_INVALID"
  | "CONTEXT_EXPIRED"
  | "REPLAY_DETECTED"
  | "CONTRACT_VERSION_UNSUPPORTED"
  | "TOOL_NOT_REGISTERED"
  | "AGENT_NOT_REGISTERED"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_PROHIBITED"
  | "SCOPE_DENIED"
  | "TENANT_MISMATCH"
  | "LOCATION_DENIED"
  | "APPROVAL_REQUIRED"
  | "IDEMPOTENCY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "INPUT_INVALID"
  | "OUTPUT_INVALID"
  | "EVIDENCE_INVALID"
  | "STRUCTURED_OUTPUT_INVALID"
  | "USAGE_LIMIT_EXCEEDED"
  | "EXECUTION_TIMEOUT"
  | "EXECUTION_CANCELLED"
  | "TOOL_FAILED";

export type AgentError = {
  code: AgentErrorCode;
  message: string;
  correlationId?: string;
  retryable: boolean;
  details?: JsonObject;
};

export type AgentErrorEnvelope = { error: AgentError };

export type SignedEnvelope<T> = {
  keyId: string;
  algorithm: "HMAC-SHA256";
  nonce: string;
  signedAt: string;
  payload: T;
  signature: string;
};
