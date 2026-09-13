import type { ApplicationCredential, ApplicationRegistration, MeterEvent, PlatformEnvironment, PlatformStore, TenantMapping } from "./contracts.ts";

export class InMemoryPlatformStore implements PlatformStore {
  private readonly applications = new Map<string, ApplicationRegistration>();
  private readonly credentialRows: ApplicationCredential[] = [];
  private readonly mappings = new Map<string, TenantMapping>();
  private readonly meters: MeterEvent[] = [];
  async saveApplication(value: ApplicationRegistration) { this.applications.set(value.applicationId, structuredClone(value)); }
  async getApplication(applicationId: string) { const value = this.applications.get(applicationId); return value ? structuredClone(value) : undefined; }
  async saveCredential(value: ApplicationCredential) { const index = this.credentialRows.findIndex(item => item.keyId === value.keyId); if (index >= 0) this.credentialRows[index] = structuredClone(value); else this.credentialRows.push(structuredClone(value)); }
  async credentials(applicationId: string, environment: PlatformEnvironment) { return structuredClone(this.credentialRows.filter(item => item.applicationId === applicationId && item.environment === environment)); }
  async saveTenantMapping(value: TenantMapping) { this.mappings.set(key(value.applicationId, value.applicationTenantId, value.environment), structuredClone(value)); }
  async getTenantMapping(applicationId: string, applicationTenantId: string, environment: PlatformEnvironment) { const value = this.mappings.get(key(applicationId, applicationTenantId, environment)); return value ? structuredClone(value) : undefined; }
  async saveMeterEvent(value: MeterEvent) { this.meters.push(structuredClone(value)); }
  async meterEvents(applicationId: string, nerveTenantId: string) { return structuredClone(this.meters.filter(item => item.applicationId === applicationId && item.tenantId === nerveTenantId)); }
}
const key = (applicationId: string, tenantId: string, environment: PlatformEnvironment) => `${applicationId}:${environment}:${tenantId}`;
