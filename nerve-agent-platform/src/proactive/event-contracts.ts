import type { EvidenceReference, JsonObject, SignedEnvelope } from "../contracts.ts";
import type { PlatformEnvironment } from "../service/contracts.ts";

export const businessEventTypes = ["shift.closed", "reconciliation.completed", "inventory.movement.recorded", "tank.reading.recorded", "invoice.created", "customer.balance.changed", "journal.posted"] as const;
export type BusinessEventType = typeof businessEventTypes[number];
export type BusinessEvent = {
  eventId: string;
  applicationId: string;
  tenantId: string;
  environment: PlatformEnvironment;
  type: BusinessEventType;
  streamId: string;
  sequence: number;
  occurredAt: string;
  subject: { resourceType: string; resourceId: string; locationId?: string };
  evidence: EvidenceReference[];
  attributes: JsonObject;
};
export type SignedBusinessEvent = SignedEnvelope<BusinessEvent>;
export type EventDisposition = "ACCEPTED" | "BUFFERED_GAP" | "DUPLICATE";
export type EventIngestionResult = { disposition: EventDisposition; eventId: string; releasedEventIds: string[]; expectedSequence: number };
export type StoredEvent = BusinessEvent & { receivedAt: string; status: "BUFFERED" | "RELEASED" };

export interface EventStore {
  ingest(event: BusinessEvent): Promise<EventIngestionResult>;
  events(tenantId: string, options?: { from?: string; to?: string; types?: BusinessEventType[] }): Promise<StoredEvent[]>;
  get(applicationId: string, eventId: string): Promise<StoredEvent | undefined>;
}
