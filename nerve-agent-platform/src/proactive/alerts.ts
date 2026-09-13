import { randomUUID } from "node:crypto";
import type { EvidenceReference, FindingSeverity } from "../contracts.ts";
import type { QuietPeriod } from "./schedules.ts";
import { isQuietTime } from "./schedules.ts";

export type ProactiveAlert = { alertId: string; tenantId: string; agentKey: string; deduplicationKey: string; severity: FindingSeverity; title: string; evidence: EvidenceReference[]; status: "OPEN" | "RESOLVED"; occurrenceCount: number; firstDetectedAt: string; lastDetectedAt: string; resolvedAt?: string };
export type NotificationPreference = { tenantId: string; enabledChannels: Array<"IN_APP" | "EMAIL" | "PUSH">; minimumSeverity: FindingSeverity; timezone: string; quietPeriods: QuietPeriod[] };
export type AlertDelivery = { deliveryId: string; alertId: string; channel: "IN_APP" | "EMAIL" | "PUSH"; status: "SENT" | "SUPPRESSED_QUIET" | "DISABLED"; createdAt: string };

export class ProactiveAlertStore {
  private readonly alerts = new Map<string, ProactiveAlert>(); private readonly deliveries = new Map<string, AlertDelivery>();
  upsert(input: Omit<ProactiveAlert, "alertId" | "status" | "occurrenceCount" | "firstDetectedAt" | "lastDetectedAt">, now = new Date()) { const key = `${input.tenantId}:${input.deduplicationKey}`; const existing = this.alerts.get(key); if (existing) { existing.lastDetectedAt = now.toISOString(); existing.occurrenceCount += 1; existing.evidence = structuredClone(input.evidence); if (existing.status === "RESOLVED") { existing.status = "OPEN"; existing.resolvedAt = undefined; } return structuredClone(existing); } const alert: ProactiveAlert = { ...structuredClone(input), alertId: randomUUID(), status: "OPEN", occurrenceCount: 1, firstDetectedAt: now.toISOString(), lastDetectedAt: now.toISOString() }; this.alerts.set(key, alert); return structuredClone(alert); }
  resolve(tenantId: string, deduplicationKey: string, now = new Date()) { const alert = this.alerts.get(`${tenantId}:${deduplicationKey}`); if (!alert) return undefined; alert.status = "RESOLVED"; alert.resolvedAt = now.toISOString(); return structuredClone(alert); }
  notify(alert: ProactiveAlert, channel: AlertDelivery["channel"], preference: NotificationPreference, now = new Date()) { const key = `${alert.alertId}:${channel}`; const existing = this.deliveries.get(key); if (existing) return structuredClone(existing); const enabled = preference.tenantId === alert.tenantId && preference.enabledChannels.includes(channel) && severityRank(alert.severity) >= severityRank(preference.minimumSeverity); const status: AlertDelivery["status"] = !enabled ? "DISABLED" : channel !== "IN_APP" && isQuietTime(now, preference.timezone, preference.quietPeriods) ? "SUPPRESSED_QUIET" : "SENT"; const delivery: AlertDelivery = { deliveryId: randomUUID(), alertId: alert.alertId, channel, status, createdAt: now.toISOString() }; this.deliveries.set(key, delivery); return structuredClone(delivery); }
  list(tenantId: string) { return structuredClone([...this.alerts.values()].filter(item => item.tenantId === tenantId)); }
}
const severityRank = (severity: FindingSeverity) => ({ INFORMATION: 0, POSITIVE: 0, ATTENTION: 1, URGENT: 2 })[severity];
