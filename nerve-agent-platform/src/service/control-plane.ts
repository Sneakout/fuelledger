import { randomBytes, randomUUID } from "node:crypto";
import { AgentSdkError } from "../errors.ts";
import type { ApplicationRegistration, PlatformEnvironment, PlatformStore, TenantMapping } from "./contracts.ts";
import { secretHash, secretsEqual, ServiceTokenIssuer } from "./security.ts";

export class PlatformControlPlane {
  constructor(store: PlatformStore, tokens: ServiceTokenIssuer) { this.store = store; this.tokens = tokens; }
  private readonly store: PlatformStore;
  private readonly tokens: ServiceTokenIssuer;

  async registerApplication(input: Omit<ApplicationRegistration, "createdAt" | "status">) {
    if (await this.store.getApplication(input.applicationId)) throw new AgentSdkError("INVALID_REQUEST", "Application is already registered.");
    const application: ApplicationRegistration = { ...input, createdAt: new Date().toISOString(), status: "ACTIVE" }; await this.store.saveApplication(application); return application;
  }
  async createCredential(applicationId: string, environment: PlatformEnvironment, expiresAt?: string) {
    const app = await this.requireApplication(applicationId, environment); const secret = randomBytes(32).toString("base64url"); const credential = { applicationId: app.applicationId, environment, keyId: randomUUID(), secretHash: secretHash(secret), validFrom: new Date().toISOString(), ...(expiresAt ? { expiresAt } : {}) }; await this.store.saveCredential(credential); return { keyId: credential.keyId, secret };
  }
  async rotateCredential(applicationId: string, environment: PlatformEnvironment, oldKeyId: string, overlapMinutes = 15) {
    const rows = await this.store.credentials(applicationId, environment); const old = rows.find(item => item.keyId === oldKeyId && !item.revokedAt); if (!old) throw new AgentSdkError("SIGNATURE_INVALID", "Active application credential was not found."); old.expiresAt = new Date(Date.now() + overlapMinutes * 60_000).toISOString(); await this.store.saveCredential(old); return this.createCredential(applicationId, environment);
  }
  async mapTenant(input: Omit<TenantMapping, "createdAt">) { await this.requireApplication(input.applicationId, input.environment); const mapping: TenantMapping = { ...input, createdAt: new Date().toISOString() }; await this.store.saveTenantMapping(mapping); return mapping; }
  async setAgentEnabled(applicationId: string, tenantId: string, environment: PlatformEnvironment, agentKey: string, enabled: boolean) { const mapping = await this.store.getTenantMapping(applicationId, tenantId, environment); if (!mapping) throw new AgentSdkError("TENANT_MISMATCH", "Tenant is not mapped to this application environment."); mapping.enabledAgentKeys = enabled ? [...new Set([...mapping.enabledAgentKeys, agentKey])] : mapping.enabledAgentKeys.filter(value => value !== agentKey); await this.store.saveTenantMapping(mapping); return mapping; }
  async issueToken(input: { applicationId: string; applicationTenantId: string; environment: PlatformEnvironment; keyId: string; secret: string; scopes: string[]; ttlSeconds?: number }) {
    const app = await this.requireApplication(input.applicationId, input.environment); if (app.status !== "ACTIVE") throw new AgentSdkError("SIGNATURE_INVALID", "Application is suspended.");
    const credential = (await this.store.credentials(input.applicationId, input.environment)).find(item => item.keyId === input.keyId && !item.revokedAt && (!item.expiresAt || new Date(item.expiresAt) > new Date()));
    if (!credential || !secretsEqual(input.secret, credential.secretHash)) throw new AgentSdkError("SIGNATURE_INVALID", "Application credential is invalid.");
    const mapping = await this.store.getTenantMapping(input.applicationId, input.applicationTenantId, input.environment); if (!mapping) throw new AgentSdkError("TENANT_MISMATCH", "Tenant is not registered for this application environment.");
    return this.tokens.issue({ applicationId: input.applicationId, environment: input.environment, nerveTenantId: mapping.nerveTenantId, applicationTenantId: mapping.applicationTenantId, scopes: input.scopes }, input.ttlSeconds);
  }
  verifyToken(token: string) { return this.tokens.verify(token); }
  private async requireApplication(applicationId: string, environment: PlatformEnvironment) { const app = await this.store.getApplication(applicationId); if (!app || !app.environments.includes(environment)) throw new AgentSdkError("INVALID_CONTEXT", "Application environment is not registered."); return app; }
}
