import type { PlatformHealth } from "./contracts.ts";
export type HealthCheck = () => Promise<{ status: "UP" | "DEGRADED" | "DOWN"; detail?: string }>;
export class HealthMonitor {
  constructor(checks: Record<string, HealthCheck>) { this.checks = checks; }
  private readonly checks: Record<string, HealthCheck>;
  async check(): Promise<PlatformHealth> { const components: PlatformHealth["components"] = {}; for (const [name, check] of Object.entries(this.checks)) { try { components[name] = await check(); } catch { components[name] = { status: "DOWN" }; } } const statuses = Object.values(components).map(value => value.status); return { status: statuses.includes("DOWN") ? "UNHEALTHY" : statuses.includes("DEGRADED") ? "DEGRADED" : "HEALTHY", checkedAt: new Date().toISOString(), components }; }
}
