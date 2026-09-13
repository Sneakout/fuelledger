import assert from "node:assert/strict";
import test from "node:test";
import {
  EventIngestionService,
  InMemoryEventStore,
  InMemoryJobQueue,
  InMemoryNonceStore,
  InMemoryPlatformStore,
  ProactiveAlertStore,
  ProactiveScheduler,
  isQuietTime,
  signEnvelope,
  type BusinessEvent,
  type SigningKey,
  type TenantSchedule,
} from "../src/index.ts";

const signingKey: SigningKey = { keyId: "fuelnerve-events-v1", secret: "event-signing-secret-that-is-long-enough" };

test("signed events are tenant-validated, deduplicated, and released in stream order", async () => {
  const setup = await eventFixture();
  const second = await setup.ingestion.ingest(signed(event(2), "nonce-2"));
  assert.equal(second.disposition, "BUFFERED_GAP"); assert.equal(setup.queue.snapshot().length, 0);
  const first = await setup.ingestion.ingest(signed(event(1), "nonce-1"));
  assert.deepEqual(first.releasedEventIds, ["event-1", "event-2"]);
  assert.deepEqual(setup.queue.snapshot().map(job => (job.payload as { eventId: string }).eventId), ["event-1", "event-2"]);
  const duplicate = await setup.ingestion.ingest(signed(event(1), "nonce-duplicate"));
  assert.equal(duplicate.disposition, "DUPLICATE"); assert.equal(setup.queue.snapshot().length, 2);
});

test("invalid signatures and cross-tenant evidence never enter the event store", async () => {
  const setup = await eventFixture(); const invalid = signed(event(1), "bad-nonce"); invalid.signature = "tampered";
  await assert.rejects(() => setup.ingestion.ingest(invalid));
  const crossing = event(1); crossing.evidence[0]!.tenantId = "org-b";
  await assert.rejects(() => setup.ingestion.ingest(signed(crossing, "crossing-nonce")));
  assert.equal((await setup.events.events("org-a")).length, 0);
});

test("bounded replay requeues immutable event references with replay deduplication", async () => {
  const setup = await eventFixture(); await setup.ingestion.ingest(signed(event(1), "nonce-1"));
  const first = await setup.ingestion.replay({ applicationId: "fuelnerve", tenantId: "org-a", environment: "production", replayId: "replay-1" });
  const duplicate = await setup.ingestion.replay({ applicationId: "fuelnerve", tenantId: "org-a", environment: "production", replayId: "replay-1" });
  assert.equal(first.queued, 1); assert.equal(duplicate.queued, 1); assert.equal(setup.queue.snapshot().length, 2);
  assert.equal((setup.queue.snapshot()[1]?.payload as { replay: boolean }).replay, true);
});

test("daily and hourly schedules use tenant local time and deduplicate occurrences", () => {
  const queue = new InMemoryJobQueue(); const scheduler = new ProactiveScheduler(queue); const now = new Date("2026-09-07T05:30:00.000Z");
  const schedules: TenantSchedule[] = [
    { scheduleId: "daily-owner", applicationId: "fuelnerve", tenantId: "org-a", environment: "production", agentKey: "owner-assistant", timezone: "Asia/Kolkata", cadence: { type: "DAILY", hour: 11, minute: 0 }, enabled: true, quietPeriods: [] },
    { scheduleId: "hourly-stock", applicationId: "fuelnerve", tenantId: "org-a", environment: "production", agentKey: "stock-watch", timezone: "Asia/Kolkata", cadence: { type: "HOURLY", minute: 0 }, enabled: true, quietPeriods: [] },
  ];
  assert.equal(scheduler.tick(schedules, now).length, 2); assert.equal(scheduler.tick(schedules, now).length, 0); assert.equal(queue.snapshot().length, 2);
});

test("quiet periods suppress external delivery while alerts deduplicate and resolve", () => {
  const alerts = new ProactiveAlertStore(); const now = new Date("2026-09-07T18:00:00.000Z"); // 23:30 in Kolkata
  const input = { tenantId: "org-a", agentKey: "stock-watch", deduplicationKey: "low-stock:tank-1", severity: "ATTENTION" as const, title: "Low stock", evidence: [event(1).evidence[0]!] };
  const first = alerts.upsert(input, now); const repeated = alerts.upsert(input, new Date(now.getTime() + 1_000));
  assert.equal(first.alertId, repeated.alertId); assert.equal(repeated.occurrenceCount, 2);
  const preference = { tenantId: "org-a", enabledChannels: ["IN_APP", "PUSH"] as Array<"IN_APP" | "PUSH">, minimumSeverity: "ATTENTION" as const, timezone: "Asia/Kolkata", quietPeriods: [{ start: "22:00", end: "07:00" }] };
  assert.equal(alerts.notify(repeated, "PUSH", preference, now).status, "SUPPRESSED_QUIET");
  assert.equal(alerts.notify(repeated, "IN_APP", preference, now).status, "SENT");
  assert.equal(alerts.resolve("org-a", input.deduplicationKey, now)?.status, "RESOLVED");
  assert.equal(isQuietTime(now, "Asia/Kolkata", preference.quietPeriods), true);
});

test("dead-letter operator retry is explicit and recoverable", () => {
  const queue = new InMemoryJobQueue(); const job = queue.enqueue("event", {}, { maximumAttempts: 1 }); const running = queue.next()!; queue.fail(running.jobId, new Error("broken"), 0);
  assert.equal(queue.deadLetters()[0]?.jobId, job.jobId); const retried = queue.retryDeadLetter(job.jobId); assert.equal(retried.status, "QUEUED"); assert.equal(retried.attempts, 0);
});

async function eventFixture() {
  const platform = new InMemoryPlatformStore(); await platform.saveApplication({ applicationId: "fuelnerve", displayName: "FuelNerve", environments: ["production"], regions: ["ap-south"], createdAt: new Date().toISOString(), status: "ACTIVE" });
  await platform.saveTenantMapping({ applicationId: "fuelnerve", applicationTenantId: "org-a", nerveTenantId: "nerve-a", environment: "production", region: "ap-south", enabledAgentKeys: ["stock-watch"], createdAt: new Date().toISOString() });
  const events = new InMemoryEventStore(); const queue = new InMemoryJobQueue(); const ingestion = new EventIngestionService({ events, platform, queue, resolveKey: keyId => keyId === signingKey.keyId ? signingKey.secret : undefined, nonces: new InMemoryNonceStore() }); return { events, queue, ingestion };
}
function signed(value: BusinessEvent, nonce: string) { return signEnvelope(value, signingKey, { nonce }); }
function event(sequence: number): BusinessEvent { return { eventId: `event-${sequence}`, applicationId: "fuelnerve", tenantId: "org-a", environment: "production", type: "inventory.movement.recorded", streamId: "tank-1", sequence, occurredAt: `2026-09-07T10:00:0${sequence}.000Z`, subject: { resourceType: "tank", resourceId: "tank-1", locationId: "station-a1" }, evidence: [{ evidenceId: `evidence-${sequence}`, evidenceType: "INVENTORY_LEDGER", applicationId: "fuelnerve", tenantId: "org-a", resourceId: `movement-${sequence}`, label: "Inventory movement", version: `v${sequence}` }], attributes: { movementType: "RECEIPT" } }; }
