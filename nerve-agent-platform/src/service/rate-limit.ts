import { AgentSdkError } from "../errors.ts";
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(limit: number, windowMs: number) { this.limit = limit; this.windowMs = windowMs; }
  private readonly limit: number; private readonly windowMs: number;
  consume(key: string, now = Date.now()) { let row = this.windows.get(key); if (!row || now - row.start >= this.windowMs) { row = { start: now, count: 0 }; this.windows.set(key, row); } if (row.count >= this.limit) throw new AgentSdkError("USAGE_LIMIT_EXCEEDED", "Application rate limit exceeded."); row.count += 1; }
}
