import assert from "node:assert/strict";
import test from "node:test";
import { OwnerAssistantReleaseMonitor, releaseRoute } from "../src/index.ts";

test("Owner Assistant release defaults and rollback keep production on the legacy route", () => {
  assert.equal(releaseRoute({ stage: "OFF", rolloutPercent: 100, rollback: false }, "production", "org-a", "owner-a"), "LEGACY_ASSISTANT");
  assert.equal(releaseRoute({ stage: "PRODUCTION", rolloutPercent: 100, rollback: true }, "production", "org-a", "owner-a"), "LEGACY_ASSISTANT");
});

test("Owner Assistant only enters environments explicitly reached by the release stage", () => {
  assert.equal(releaseRoute({ stage: "LOCAL", rolloutPercent: 100, rollback: false }, "development", "org-a", "owner-a"), "SPECIALIST_COORDINATOR");
  assert.equal(releaseRoute({ stage: "LOCAL", rolloutPercent: 100, rollback: false }, "staging", "org-a", "owner-a"), "LEGACY_ASSISTANT");
  assert.equal(releaseRoute({ stage: "STAGING", rolloutPercent: 100, rollback: false }, "production", "org-a", "owner-a"), "LEGACY_ASSISTANT");
});

test("percentage routing is stable for a tenant and owner", () => {
  const config = { stage: "PRODUCTION" as const, rolloutPercent: 37, rollback: false };
  const first = releaseRoute(config, "production", "org-a", "owner-a");
  assert.equal(releaseRoute(config, "production", "org-a", "owner-a"), first);
});

test("monitor recommends rollback for evidence, snapshot, reliability, fallback, or latency failures", () => {
  const monitor = new OwnerAssistantReleaseMonitor();
  monitor.record({ completed: true, fallbackUsed: false, scopeDenied: false, unsupported: false, evidenceValid: true, snapshotConsistent: true, durationMs: 250 });
  assert.equal(monitor.health().rollbackRecommended, false);
  monitor.record({ completed: true, fallbackUsed: false, scopeDenied: false, unsupported: false, evidenceValid: false, snapshotConsistent: true, durationMs: 250 });
  assert.equal(monitor.health().rollbackRecommended, true);
});
