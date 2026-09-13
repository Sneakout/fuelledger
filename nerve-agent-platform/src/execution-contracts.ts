import type { ExecutionContext, ExecutionReceipt, JsonObject, RiskLevel } from "./contracts.ts";
import type { ApprovedActionEnvelope, GovernanceStore } from "./governance-contracts.ts";

export const controlledActionIds = [
  "findings.review.execute",
  "alerts.acknowledge.execute",
  "communications.reminder-draft.save",
  "follow-ups.internal.create",
  "communications.customer-reminder.send",
  "inventory.adjustment.submit",
  "inventory.adjustment.apply",
  "purchases.invoice-correction.submit",
] as const;
export type ControlledActionId = typeof controlledActionIds[number];

export const prohibitedActionIds = [
  "sales.completed.edit",
  "sales.completed.delete",
  "inventory.history.rewrite",
  "accounting.journal-lines.modify",
  "shifts.locked.reopen",
  "evidence.delete",
  "access.change",
  "suppliers.payment.initiate",
  "communications.customer-reminder.auto-send",
] as const;

export type ControlledActionPolicy = {
  actionId: ControlledActionId;
  riskLevel: RiskLevel;
  requiredScope: string;
  requiresNerveApproval: boolean;
  sourceChecks: Array<"FINAL_AUTHORIZATION" | "FACTS_RELOADED" | "LEDGER_INVARIANTS" | "JOURNAL_INVARIANTS" | "EXPLICIT_MESSAGE_POLICY">;
};

export type ControlledActionRequest = {
  context: ExecutionContext;
  actionId: ControlledActionId;
  payload: JsonObject;
  idempotencyKey: string;
  approvedAction?: ApprovedActionEnvelope;
};

export type SourceActionRequest = Omit<ControlledActionRequest, "approvedAction"> & {
  approvalId?: string;
  payloadHash: string;
  evidenceHash?: string;
};

export type SourceActionResult = {
  status: ExecutionReceipt["status"];
  sourceCommandId?: string;
  result?: JsonObject;
  error?: ExecutionReceipt["error"];
  checks: { finalAuthorization: boolean; factsReloaded: boolean; ledgerInvariants?: boolean; journalInvariants?: boolean; explicitMessagePolicy?: boolean };
};

export interface SourceActionExecutor {
  applicationId: string;
  execute(request: SourceActionRequest, signal?: AbortSignal): Promise<SourceActionResult>;
}

export type ExecutionClaim =
  | { status: "CLAIMED" }
  | { status: "REPLAY"; receipt: ExecutionReceipt }
  | { status: "IN_PROGRESS" }
  | { status: "CONFLICT" };

export interface ExecutionReceiptStore {
  claim(tenantId: string, actionId: string, idempotencyKeyHash: string, requestHash: string): Promise<ExecutionClaim>;
  complete(tenantId: string, actionId: string, idempotencyKeyHash: string, receipt: ExecutionReceipt): Promise<void>;
  list(tenantId: string): Promise<ExecutionReceipt[]>;
}

export type ControlledActionDependencies = { governance: GovernanceStore; receipts: ExecutionReceiptStore; source: SourceActionExecutor; killSwitch?: { assertActionAllowed(tenantId: string, actionId: string): void } };
