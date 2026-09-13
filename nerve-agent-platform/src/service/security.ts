import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AgentSdkError } from "../errors.ts";
import type { ServiceTokenClaims } from "./contracts.ts";

export const secretHash = (secret: string) => createHash("sha256").update(secret).digest("base64url");
export function secretsEqual(secret: string, expectedHash: string) { const supplied = Buffer.from(secretHash(secret)); const expected = Buffer.from(expectedHash); return supplied.length === expected.length && timingSafeEqual(supplied, expected); }

export class ServiceTokenIssuer {
  constructor(privateKey: string) { this.key = privateKey; }
  private readonly key: string;
  issue(input: Omit<ServiceTokenClaims, "tokenId" | "issuedAt" | "expiresAt">, ttlSeconds = 300) {
    if (ttlSeconds < 1 || ttlSeconds > 900) throw new AgentSdkError("INVALID_REQUEST", "Service-token lifetime must be between 1 and 900 seconds.");
    const now = new Date(); const claims: ServiceTokenClaims = { ...input, tokenId: randomUUID(), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString() };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url"); const signature = createHmac("sha256", this.key).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, expiresAt: claims.expiresAt };
  }
  verify(token: string, now = new Date()): ServiceTokenClaims {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new AgentSdkError("SIGNATURE_INVALID", "Malformed service token.");
    const expected = createHmac("sha256", this.key).update(payload).digest(); const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AgentSdkError("SIGNATURE_INVALID", "Invalid service token.");
    let claims: ServiceTokenClaims; try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ServiceTokenClaims; } catch { throw new AgentSdkError("SIGNATURE_INVALID", "Invalid service-token payload."); }
    if (new Date(claims.expiresAt) <= now) throw new AgentSdkError("CONTEXT_EXPIRED", "Service token has expired.");
    return claims;
  }
}

export class EncryptedConfigurationVault {
  constructor(masterKey: Buffer) { if (masterKey.length !== 32) throw new Error("Vault master key must contain 32 bytes."); this.masterKey = masterKey; }
  private readonly masterKey: Buffer;
  encrypt(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv); const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`; }
  decrypt(value: string) { const [iv, tag, ciphertext] = value.split("."); if (!iv || !tag || !ciphertext) throw new Error("Encrypted configuration is invalid."); const decipher = createDecipheriv("aes-256-gcm", this.masterKey, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"); }
}
