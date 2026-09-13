import { AgentSdkError } from "./errors.ts";

export type TenantUsagePolicy = { maxRuns: number; maxToolCalls: number; maxInputTokens: number; maxOutputTokens: number };
export type TenantUsage = { runs: number; toolCalls: number; inputTokens: number; outputTokens: number };
export interface UsageStore { get(key: string): Promise<TenantUsage>; set(key: string, usage: TenantUsage): Promise<void>; }

export class InMemoryUsageStore implements UsageStore {
  private readonly usage = new Map<string, TenantUsage>();
  async get(key: string) { return structuredClone(this.usage.get(key) ?? { runs: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 }); }
  async set(key: string, usage: TenantUsage) { this.usage.set(key, structuredClone(usage)); }
}

export class TenantUsageLimiter {
  constructor(privateStore: UsageStore, privatePolicy: TenantUsagePolicy) { this.store = privateStore; this.policy = privatePolicy; }
  private readonly store: UsageStore;
  private readonly policy: TenantUsagePolicy;

  async reserve(tenantId: string, toolCalls: number, maximumOutputTokens = 0): Promise<string> {
    const key = this.key(tenantId);
    const usage = await this.store.get(key);
    if (usage.runs + 1 > this.policy.maxRuns || usage.toolCalls + toolCalls > this.policy.maxToolCalls || usage.outputTokens + maximumOutputTokens > this.policy.maxOutputTokens) throw new AgentSdkError("USAGE_LIMIT_EXCEEDED", "Tenant run, tool-call, or output-token limit exceeded.");
    await this.store.set(key, { ...usage, runs: usage.runs + 1, toolCalls: usage.toolCalls + toolCalls });
    return key;
  }

  async recordTokens(key: string, inputTokens: number, outputTokens: number): Promise<void> {
    const usage = await this.store.get(key);
    if (usage.inputTokens + inputTokens > this.policy.maxInputTokens || usage.outputTokens + outputTokens > this.policy.maxOutputTokens) throw new AgentSdkError("USAGE_LIMIT_EXCEEDED", "Tenant model-token limit exceeded.");
    await this.store.set(key, { ...usage, inputTokens: usage.inputTokens + inputTokens, outputTokens: usage.outputTokens + outputTokens });
  }

  async current(tenantId: string) { return this.store.get(this.key(tenantId)); }
  private key(tenantId: string) { return `${tenantId}:${new Date().toISOString().slice(0, 7)}`; }
}
