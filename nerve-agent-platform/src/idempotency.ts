import { createHash } from "node:crypto";
import type { ToolResult } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";

type Entry = { fingerprint: string; result: ToolResult };
export interface IdempotencyStore { get(key: string): Promise<Entry | undefined>; put(key: string, entry: Entry): Promise<void>; }
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  async get(key: string) { return this.entries.get(key); }
  async put(key: string, entry: Entry) { this.entries.set(key, entry); }
}
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function replayOrConflict(store: IdempotencyStore, key: string, requestFingerprint: string): Promise<ToolResult | undefined> {
  const prior = await store.get(key);
  if (!prior) return undefined;
  if (prior.fingerprint !== requestFingerprint) throw new AgentSdkError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with different request details.");
  return prior.result;
}
