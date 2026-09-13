import { randomUUID } from "node:crypto";
export type RetainedRecord = { recordId: string; tenantId: string; category: "RUN" | "AUDIT" | "FINDING" | "PROPOSAL" | "EVENT" | "METER"; createdAt: string; expiresAt: string; legalHold?: boolean };
export type DeletionReceipt = { deletionId: string; tenantId: string; requestedAt: string; completedAt: string; deletedByCategory: Record<string, number>; retainedLegalHoldIds: string[] };
export class InMemoryRetentionStore {
  constructor(records: RetainedRecord[] = []) { this.records = structuredClone(records); } private records: RetainedRecord[];
  expired(now = new Date()) { return structuredClone(this.records.filter(item => !item.legalHold && new Date(item.expiresAt) <= now)); }
  deleteExpired(now = new Date()) { const expired = this.expired(now); const ids = new Set(expired.map(item => item.recordId)); this.records = this.records.filter(item => !ids.has(item.recordId)); return expired; }
  deleteTenant(tenantId: string, now = new Date()): DeletionReceipt { const selected = this.records.filter(item => item.tenantId === tenantId); const deletable = selected.filter(item => !item.legalHold); const ids = new Set(deletable.map(item => item.recordId)); this.records = this.records.filter(item => !ids.has(item.recordId)); const deletedByCategory = deletable.reduce<Record<string, number>>((out, item) => ({ ...out, [item.category]: (out[item.category] ?? 0) + 1 }), {}); return { deletionId: randomUUID(), tenantId, requestedAt: now.toISOString(), completedAt: now.toISOString(), deletedByCategory, retainedLegalHoldIds: selected.filter(item => item.legalHold).map(item => item.recordId) }; }
  list(tenantId: string) { return structuredClone(this.records.filter(item => item.tenantId === tenantId)); }
}
