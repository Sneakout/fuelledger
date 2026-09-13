import { AgentSdkError } from "../errors.ts";
import type { InMemoryJobQueue } from "../service/queue.ts";
import type { PlatformEnvironment } from "../service/contracts.ts";

export type QuietPeriod = { start: string; end: string };
export type TenantSchedule = { scheduleId: string; applicationId: string; tenantId: string; environment: PlatformEnvironment; agentKey: string; timezone: string; cadence: { type: "HOURLY"; minute: number } | { type: "DAILY"; hour: number; minute: number }; enabled: boolean; quietPeriods: QuietPeriod[] };

export class ProactiveScheduler {
  private readonly occurrenceKeys = new Set<string>();
  constructor(queue: InMemoryJobQueue) { this.queue = queue; }
  private readonly queue: InMemoryJobQueue;
  tick(schedules: TenantSchedule[], now = new Date()) {
    const jobs = [];
    for (const schedule of schedules.filter(item => item.enabled)) {
      validateSchedule(schedule); const local = localParts(now, schedule.timezone); const due = schedule.cadence.type === "HOURLY" ? local.minute === schedule.cadence.minute : local.hour === schedule.cadence.hour && local.minute === schedule.cadence.minute; if (!due) continue;
      const bucket = schedule.cadence.type === "HOURLY" ? `${local.date}T${pad(local.hour)}` : local.date; const occurrenceKey = `${schedule.scheduleId}:${bucket}`; if (this.occurrenceKeys.has(occurrenceKey)) continue; this.occurrenceKeys.add(occurrenceKey);
      jobs.push(this.queue.enqueue("scheduled-analysis", { scheduleId: schedule.scheduleId, applicationId: schedule.applicationId, tenantId: schedule.tenantId, environment: schedule.environment, agentKey: schedule.agentKey, occurrenceKey, scheduledAt: now.toISOString() }, { deduplicationKey: occurrenceKey }));
    }
    return jobs;
  }
}

export function isQuietTime(now: Date, timezone: string, periods: QuietPeriod[]) { const local = localParts(now, timezone); const minute = local.hour * 60 + local.minute; return periods.some(period => { const start = parseClock(period.start); const end = parseClock(period.end); return start <= end ? minute >= start && minute < end : minute >= start || minute < end; }); }

function validateSchedule(schedule: TenantSchedule) { try { new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone }).format(); } catch { throw new AgentSdkError("INVALID_REQUEST", "Tenant timezone must be a valid IANA timezone."); } if (schedule.cadence.minute < 0 || schedule.cadence.minute > 59 || (schedule.cadence.type === "DAILY" && (schedule.cadence.hour < 0 || schedule.cadence.hour > 23))) throw new AgentSdkError("INVALID_REQUEST", "Schedule time is invalid."); schedule.quietPeriods.forEach(period => { parseClock(period.start); parseClock(period.end); }); }
function localParts(now: Date, timezone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "00"; return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) }; }
function parseClock(value: string) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new AgentSdkError("INVALID_REQUEST", "Quiet-period time must use HH:mm."); const [hour, minute] = value.split(":").map(Number); return hour! * 60 + minute!; }
const pad = (value: number) => String(value).padStart(2, "0");
