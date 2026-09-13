import { createHash } from "node:crypto";

export function hashedSafetyIdentifier(input: { applicationId: string; tenantId: string; actorId: string }, salt: string): string {
  if (salt.length < 16) throw new Error("Safety identifier salt must contain at least 16 characters.");
  return createHash("sha256").update(`${salt}:${input.applicationId}:${input.tenantId}:${input.actorId}`).digest("hex");
}
