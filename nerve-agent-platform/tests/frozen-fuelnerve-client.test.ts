import assert from "node:assert/strict";
import test from "node:test";
import { FrozenFuelNerveReadClient, type FuelNerveReadClient, type FuelNerveScope, type FuelNerveSnapshot } from "../src/index.ts";

const scope: FuelNerveScope = { organizationId: "org-a", stationIds: ["station-a"], asOf: "2026-09-11T00:00:00.000Z" };
const snapshot = (value: number): FuelNerveSnapshot => ({ data: { value }, evidence: [], calculatedAt: scope.asOf });

test("frozen client captures each scoped read once and returns defensive copies", async () => {
  let calls = 0;
  const read = async () => snapshot(++calls);
  const source = new Proxy({}, { get: () => read }) as FuelNerveReadClient;
  const frozen = new FrozenFuelNerveReadClient(source);
  const first = await frozen.inventoryPosition(scope, AbortSignal.timeout(100));
  first.data.value = 99;
  const second = await frozen.inventoryPosition(scope, AbortSignal.timeout(100));
  assert.equal(calls, 1);
  assert.equal(second.data.value, 1);
  await frozen.journalProfit(scope, AbortSignal.timeout(100));
  assert.equal(calls, 2);
});

test("frozen client does not cache failed reads", async () => {
  let calls = 0;
  const source = new Proxy({}, { get: () => async () => { calls += 1; if (calls === 1) throw new Error("offline"); return snapshot(calls); } }) as FuelNerveReadClient;
  const frozen = new FrozenFuelNerveReadClient(source);
  await assert.rejects(frozen.dashboardFacts(scope, AbortSignal.timeout(100)), /offline/);
  assert.equal((await frozen.dashboardFacts(scope, AbortSignal.timeout(100))).data.value, 2);
});
