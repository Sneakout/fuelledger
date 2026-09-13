import type { ExecutionReceipt } from "./contracts.ts";
import type { ExecutionClaim, ExecutionReceiptStore } from "./execution-contracts.ts";

type Entry = { requestHash: string; receipt?: ExecutionReceipt };

export class InMemoryExecutionReceiptStore implements ExecutionReceiptStore {
  private readonly entries = new Map<string, Entry>();

  async claim(tenantId: string, actionId: string, idempotencyKeyHash: string, requestHash: string): Promise<ExecutionClaim> {
    const key = `${tenantId}:${actionId}:${idempotencyKeyHash}`;
    const existing = this.entries.get(key);
    if (!existing) { this.entries.set(key, { requestHash }); return { status: "CLAIMED" }; }
    if (existing.requestHash !== requestHash) return { status: "CONFLICT" };
    if (existing.receipt) return { status: "REPLAY", receipt: structuredClone(existing.receipt) };
    return { status: "IN_PROGRESS" };
  }

  async complete(tenantId: string, actionId: string, idempotencyKeyHash: string, receipt: ExecutionReceipt): Promise<void> {
    const key = `${tenantId}:${actionId}:${idempotencyKeyHash}`;
    const existing = this.entries.get(key);
    if (!existing) throw new Error("Execution was not claimed.");
    existing.receipt = structuredClone(receipt);
  }

  async list(tenantId: string): Promise<ExecutionReceipt[]> {
    return [...this.entries.entries()].filter(([key, value]) => key.startsWith(`${tenantId}:`) && value.receipt).map(([, value]) => structuredClone(value.receipt!));
  }
}
