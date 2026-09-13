import { AgentSdkError } from "../errors.ts";
import type { NonceStore, VerificationKeyResolver } from "../signing.ts";
import { verifyEnvelope } from "../signing.ts";
import type { InMemoryJobQueue } from "../service/queue.ts";
import type { PlatformStore } from "../service/contracts.ts";
import { businessEventTypes, type BusinessEvent, type BusinessEventType, type EventIngestionResult, type EventStore, type SignedBusinessEvent, type StoredEvent } from "./event-contracts.ts";

export class InMemoryEventStore implements EventStore {
  private readonly rows = new Map<string, StoredEvent>();
  private readonly lastSequence = new Map<string, number>();
  async ingest(event: BusinessEvent): Promise<EventIngestionResult> {
    const id = `${event.applicationId}:${event.eventId}`; const stream = `${event.applicationId}:${event.environment}:${event.tenantId}:${event.streamId}`;
    if (this.rows.has(id)) return { disposition: "DUPLICATE", eventId: event.eventId, releasedEventIds: [], expectedSequence: (this.lastSequence.get(stream) ?? 0) + 1 };
    const last = this.lastSequence.get(stream) ?? 0;
    if (event.sequence <= last) return { disposition: "DUPLICATE", eventId: event.eventId, releasedEventIds: [], expectedSequence: last + 1 };
    const row: StoredEvent = { ...structuredClone(event), receivedAt: new Date().toISOString(), status: event.sequence === last + 1 ? "RELEASED" : "BUFFERED" }; this.rows.set(id, row);
    if (row.status === "BUFFERED") return { disposition: "BUFFERED_GAP", eventId: event.eventId, releasedEventIds: [], expectedSequence: last + 1 };
    const released = [event.eventId]; let next = event.sequence + 1; this.lastSequence.set(stream, event.sequence);
    while (true) { const pending = [...this.rows.values()].find(item => item.applicationId === event.applicationId && item.environment === event.environment && item.tenantId === event.tenantId && item.streamId === event.streamId && item.sequence === next && item.status === "BUFFERED"); if (!pending) break; pending.status = "RELEASED"; released.push(pending.eventId); this.lastSequence.set(stream, next); next += 1; }
    return { disposition: "ACCEPTED", eventId: event.eventId, releasedEventIds: released, expectedSequence: next };
  }
  async events(tenantId: string, options: { from?: string; to?: string; types?: BusinessEventType[] } = {}) { return structuredClone([...this.rows.values()].filter(row => row.tenantId === tenantId && row.status === "RELEASED" && (!options.from || row.occurredAt >= options.from) && (!options.to || row.occurredAt <= options.to) && (!options.types || options.types.includes(row.type))).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.streamId.localeCompare(b.streamId) || a.sequence - b.sequence)); }
  async get(applicationId: string, eventId: string) { const row = this.rows.get(`${applicationId}:${eventId}`); return row ? structuredClone(row) : undefined; }
}

export class EventIngestionService {
  constructor(input: { events: EventStore; platform: PlatformStore; queue: InMemoryJobQueue; resolveKey: VerificationKeyResolver; nonces: NonceStore }) { this.input = input; }
  private readonly input: { events: EventStore; platform: PlatformStore; queue: InMemoryJobQueue; resolveKey: VerificationKeyResolver; nonces: NonceStore };
  async ingest(envelope: SignedBusinessEvent) {
    const event = validateEvent(await verifyEnvelope(envelope, this.input.resolveKey, this.input.nonces));
    const mapping = await this.input.platform.getTenantMapping(event.applicationId, event.tenantId, event.environment); if (!mapping) throw new AgentSdkError("TENANT_MISMATCH", "Event tenant is not mapped for this application environment.");
    const result = await this.input.events.ingest(event);
    for (const eventId of result.releasedEventIds) { const released = await this.input.events.get(event.applicationId, eventId); if (released) this.enqueue(released, false); }
    return result;
  }
  async replay(input: { applicationId: string; tenantId: string; environment: BusinessEvent["environment"]; from?: string; to?: string; types?: BusinessEventType[]; replayId: string }) {
    const mapping = await this.input.platform.getTenantMapping(input.applicationId, input.tenantId, input.environment); if (!mapping) throw new AgentSdkError("TENANT_MISMATCH", "Replay tenant is not mapped.");
    const rows = await this.input.events.events(input.tenantId, input); for (const row of rows.filter(item => item.applicationId === input.applicationId && item.environment === input.environment)) this.enqueue(row, true, input.replayId); return { replayId: input.replayId, queued: rows.length };
  }
  private enqueue(event: StoredEvent, replay: boolean, replayId?: string) { this.input.queue.enqueue("business-event", { eventId: event.eventId, applicationId: event.applicationId, tenantId: event.tenantId, environment: event.environment, type: event.type, replay }, { deduplicationKey: replay ? `replay:${replayId}:${event.eventId}` : `event:${event.applicationId}:${event.eventId}` }); }
}

function validateEvent(event: BusinessEvent): BusinessEvent {
  if (!businessEventTypes.includes(event.type) || !event.eventId || !event.applicationId || !event.tenantId || !event.streamId || !Number.isInteger(event.sequence) || event.sequence < 1 || !Number.isFinite(Date.parse(event.occurredAt))) throw new AgentSdkError("INPUT_INVALID", "Business event contract is invalid.");
  for (const evidence of event.evidence) if (evidence.applicationId !== event.applicationId || evidence.tenantId !== event.tenantId) throw new AgentSdkError("EVIDENCE_INVALID", "Event evidence crosses an application or tenant boundary.");
  return event;
}
