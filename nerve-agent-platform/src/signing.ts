import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignedEnvelope } from "./contracts.ts";
import { AgentSdkError } from "./errors.ts";

export type SigningKey = { keyId: string; secret: string };
export type VerificationKeyResolver = (keyId: string) => Promise<string | undefined> | string | undefined;
export interface NonceStore { consume(keyId: string, nonce: string, expiresAt: Date): Promise<boolean>; }

export class InMemoryNonceStore implements NonceStore {
  private readonly entries = new Map<string, number>();
  async consume(keyId: string, nonce: string, expiresAt: Date): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiry] of this.entries) if (expiry <= now) this.entries.delete(key);
    const id = `${keyId}:${nonce}`;
    if (this.entries.has(id)) return false;
    this.entries.set(id, expiresAt.getTime());
    return true;
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function signingInput<T>(envelope: Omit<SignedEnvelope<T>, "signature">): string {
  return canonical(envelope);
}

export function signEnvelope<T>(payload: T, key: SigningKey, options: { nonce: string; signedAt?: Date }): SignedEnvelope<T> {
  const unsigned = { keyId: key.keyId, algorithm: "HMAC-SHA256" as const, nonce: options.nonce, signedAt: (options.signedAt ?? new Date()).toISOString(), payload };
  return { ...unsigned, signature: createHmac("sha256", key.secret).update(signingInput(unsigned)).digest("base64url") };
}

export async function verifyEnvelope<T>(
  envelope: SignedEnvelope<T>, resolveKey: VerificationKeyResolver, nonceStore: NonceStore,
  options: { now?: Date; maximumClockSkewMs?: number } = {},
): Promise<T> {
  if (envelope.algorithm !== "HMAC-SHA256") throw new AgentSdkError("SIGNATURE_INVALID", "Unsupported signing algorithm.");
  const secret = await resolveKey(envelope.keyId);
  if (!secret) throw new AgentSdkError("SIGNATURE_INVALID", "Unknown signing key.");
  const { signature, ...unsigned } = envelope;
  const expected = createHmac("sha256", secret).update(signingInput(unsigned)).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { throw new AgentSdkError("SIGNATURE_INVALID", "Invalid request signature."); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AgentSdkError("SIGNATURE_INVALID", "Invalid request signature.");
  const now = options.now ?? new Date();
  const signedAt = new Date(envelope.signedAt);
  const skew = options.maximumClockSkewMs ?? 5 * 60_000;
  if (!Number.isFinite(signedAt.getTime()) || Math.abs(now.getTime() - signedAt.getTime()) > skew) throw new AgentSdkError("SIGNATURE_INVALID", "Request signing time is outside the permitted window.");
  if (!await nonceStore.consume(envelope.keyId, envelope.nonce, new Date(now.getTime() + skew))) throw new AgentSdkError("REPLAY_DETECTED", "This signed request was already used.");
  return envelope.payload;
}
