import assert from "node:assert/strict";
import test from "node:test";
import { AgentSdkError, FuelNerveHttpReadClient } from "../src/index.ts";

const scope = { organizationId: "org-a", stationIds: ["station-a"], asOf: "2026-09-07T12:00:00.000Z" };
const secret = "local-shadow-secret-with-at-least-32-chars";

test("HTTP adapter sends only a signed local read request", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const client = new FuelNerveHttpReadClient({ baseUrl: "http://localhost:4000", keyId: "local-key", sharedSecret: secret, fetch: async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ data: { organizationId: "org-a", items: [] }, evidence: [], calculatedAt: scope.asOf }), { status: 200, headers: { "content-type": "application/json" } });
  }});
  const result = await client.inventoryPosition(scope, new AbortController().signal);
  assert.equal(captured?.url, "http://localhost:4000/api/nerve/v1/read");
  assert.equal(captured?.init?.method, "POST");
  assert.ok((captured?.init?.headers as Record<string, string>)["x-nerve-signature"]);
  assert.deepEqual(JSON.parse(String(captured?.init?.body)), { capability: "inventory", organizationId: "org-a", stationIds: ["station-a"], asOf: scope.asOf });
  assert.deepEqual(result.data, { organizationId: "org-a", items: [] });
});

test("HTTP adapter fails closed and reports FuelNerve offline without retrying writes", async () => {
  let calls = 0;
  const client = new FuelNerveHttpReadClient({ baseUrl: "http://127.0.0.1:4000", keyId: "local-key", sharedSecret: secret, fetch: async () => { calls += 1; throw new TypeError("offline"); } });
  await assert.rejects(() => client.dashboardFacts(scope, new AbortController().signal), (error: unknown) => error instanceof AgentSdkError && error.code === "TOOL_FAILED" && error.retryable);
  assert.equal(calls, 1);
});

test("HTTP adapter refuses non-local endpoints", () => {
  assert.throws(() => new FuelNerveHttpReadClient({ baseUrl: "https://fuelnerve.example", keyId: "local-key", sharedSecret: secret }), /localhost/i);
});
