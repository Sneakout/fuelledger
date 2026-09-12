import { describe, expect, it, beforeEach } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { assertLocalNerveScope, authenticateLocalNerve, clearLocalNerveNoncesForTests, localNerveSignature } from "../src/modules/nerve/local-auth.js";

const credentials = { enabled: true, nodeEnv: "development", keyId: "local-key", sharedSecret: "a-local-test-secret-that-is-long-enough", organizationId: "org-a", stationId: "station-a" };
const body = { capability: "inventory", organizationId: "org-a", stationIds: ["station-a"], asOf: "2026-09-07T12:00:00.000Z" };

describe("local Nerve shadow authentication", () => {
  beforeEach(() => clearLocalNerveNoncesForTests());

  it("accepts a fresh signed request and binds it to configured scope", () => {
    const timestamp = "2026-09-07T12:00:00.000Z", nonce = "nonce-1";
    expect(authenticateLocalNerve({ credentials, keyId: "local-key", timestamp, nonce, signature: localNerveSignature(credentials.sharedSecret, timestamp, nonce, body), body, now: Date.parse(timestamp) })).toEqual({ organizationId: "org-a", stationId: "station-a" });
  });

  it("rejects tampering, replay, expiry, disabled mode, and production", () => {
    const timestamp = "2026-09-07T12:00:00.000Z", nonce = "nonce-1", signature = localNerveSignature(credentials.sharedSecret, timestamp, nonce, body), now = Date.parse(timestamp);
    expect(() => authenticateLocalNerve({ credentials, keyId: "local-key", timestamp, nonce, signature, body: { ...body, organizationId: "org-b" }, now })).toThrowError(AppError);
    authenticateLocalNerve({ credentials, keyId: "local-key", timestamp, nonce, signature, body, now });
    expect(() => authenticateLocalNerve({ credentials, keyId: "local-key", timestamp, nonce, signature, body, now })).toThrowError(/already used/i);
    expect(() => authenticateLocalNerve({ credentials, keyId: "local-key", timestamp, nonce: "nonce-2", signature: localNerveSignature(credentials.sharedSecret, timestamp, "nonce-2", body), body, now: now + 61_000 })).toThrowError(/timestamp/i);
    expect(() => authenticateLocalNerve({ credentials: { ...credentials, enabled: false }, body })).toThrowError(AppError);
    expect(() => authenticateLocalNerve({ credentials: { ...credentials, nodeEnv: "production" }, body })).toThrowError(AppError);
  });

  it("rejects cross-organization and cross-station reads", () => {
    const trusted = { organizationId: "org-a", stationId: "station-a" };
    expect(() => assertLocalNerveScope({ organizationId: "org-b", stationIds: ["station-a"] }, trusted)).toThrowError(/different organization/i);
    expect(() => assertLocalNerveScope({ organizationId: "org-a", stationIds: ["station-b"] }, trusted)).toThrowError(/different fuel station/i);
    expect(() => assertLocalNerveScope({ organizationId: "org-a", stationIds: ["station-a", "station-b"] }, trusted)).toThrowError(/different fuel station/i);
  });
});
