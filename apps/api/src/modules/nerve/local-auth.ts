import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../lib/errors.js";

export type LocalNerveCredentials = {
  enabled: boolean;
  nodeEnv: string;
  keyId?: string;
  sharedSecret?: string;
  organizationId?: string;
  stationId?: string;
};

const seenNonces = new Map<string, number>();
const maximumClockSkewMs = 60_000;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

export function localNerveSignature(secret: string, timestamp: string, nonce: string, body: unknown): string {
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${canonicalJson(body)}`).digest("hex");
}

export function authenticateLocalNerve(input: {
  credentials: LocalNerveCredentials;
  keyId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
  body: unknown;
  now?: number;
}): { organizationId: string; stationId: string } {
  const { credentials } = input;
  if (!credentials.enabled || credentials.nodeEnv === "production") throw new AppError(404, "NOT_FOUND", "The requested resource was not found.");
  if (!credentials.keyId || !credentials.sharedSecret || !credentials.organizationId || !credentials.stationId) throw new AppError(503, "NERVE_SHADOW_NOT_CONFIGURED", "Local Nerve shadow mode is not fully configured.");
  if (input.keyId !== credentials.keyId || !input.timestamp || !input.nonce || !input.signature) throw new AppError(401, "NERVE_AUTH_INVALID", "Nerve service authentication failed.");
  const timestampMs = Date.parse(input.timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maximumClockSkewMs) throw new AppError(401, "NERVE_REQUEST_EXPIRED", "Nerve request timestamp is outside the allowed window.");
  for (const [nonce, expiresAt] of seenNonces) if (expiresAt <= now) seenNonces.delete(nonce);
  if (seenNonces.has(input.nonce)) throw new AppError(409, "NERVE_REPLAY_DETECTED", "This Nerve request was already used.");
  const expected = localNerveSignature(credentials.sharedSecret, input.timestamp, input.nonce, input.body);
  const actualBuffer = Buffer.from(input.signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new AppError(401, "NERVE_SIGNATURE_INVALID", "Nerve request signature is invalid.");
  seenNonces.set(input.nonce, now + maximumClockSkewMs);
  return { organizationId: credentials.organizationId, stationId: credentials.stationId };
}

export function clearLocalNerveNoncesForTests(): void { seenNonces.clear(); }

export function assertLocalNerveScope(requested: { organizationId: string; stationIds: string[] }, trusted: { organizationId: string; stationId: string }): void {
  if (requested.organizationId !== trusted.organizationId) throw new AppError(403, "NERVE_TENANT_DENIED", "Nerve requested a different organization.");
  if (requested.stationIds.length !== 1 || requested.stationIds[0] !== trusted.stationId) throw new AppError(403, "NERVE_STATION_DENIED", "Nerve requested a different fuel station.");
}
