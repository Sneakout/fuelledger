import { randomUUID } from "node:crypto";
import type { JsonObject } from "../contracts.ts";
import type { MeterEvent, PlatformEnvironment, PlatformStore } from "./contracts.ts";
export class UsageBillingMeter {
  constructor(store: PlatformStore) { this.store = store; }
  private readonly store: PlatformStore;
  record(input: Omit<MeterEvent, "eventId" | "occurredAt">) { return this.store.saveMeterEvent({ ...input, eventId: randomUUID(), occurredAt: new Date().toISOString() }); }
  async summary(applicationId: string, tenantId: string) { const rows = await this.store.meterEvents(applicationId, tenantId); return rows.reduce<Record<string, number>>((totals, row) => ({ ...totals, [row.kind]: (totals[row.kind] ?? 0) + row.quantity }), {}); }
  run(applicationId: string, tenantId: string, environment: PlatformEnvironment, dimensions: JsonObject = {}) { return this.record({ applicationId, tenantId, environment, kind: "RUN", quantity: 1, dimensions }); }
}
