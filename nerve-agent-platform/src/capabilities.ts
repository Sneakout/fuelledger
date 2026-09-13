import type { JsonObject } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";
import { jsonObject, object, string, stringArray, type Validator } from "./validation.ts";

export type CapabilityKey =
  | "inventory.position.read"
  | "reconciliation.exceptions.read"
  | "receivables.ageing.read"
  | "purchases.history.read"
  | "purchases.anomalies.read"
  | "profit.summary.read"
  | "evidence.record.resolve"
  | "proposal.create"
  | "approved-action.execute";

export type ScopedQuery = JsonObject & { locationIds: string[]; asOf: string };
export const scopedQuerySchema: Validator<ScopedQuery> = (value, path = "input") => {
  const v = object(value, path);
  const asOf = string(v.asOf, `${path}.asOf`);
  if (!Number.isFinite(Date.parse(asOf))) throw new AgentSdkError("INPUT_INVALID", `${path}.asOf must be an ISO date-time.`);
  return { locationIds: stringArray(v.locationIds, `${path}.locationIds`), asOf };
};

export function enforcePermittedLocations(requested: string[], permitted: string[]): void {
  const denied = requested.filter(id => !permitted.includes(id));
  if (denied.length) throw new AgentSdkError("LOCATION_DENIED", "One or more requested locations are not permitted.", false, { deniedLocationIds: denied });
}

export const capabilityOutputSchema = jsonObject;
