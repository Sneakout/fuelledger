import { randomUUID } from "node:crypto";
export type PlatformJob<T = unknown> = { jobId: string; type: string; payload: T; deduplicationKey?: string; attempts: number; maximumAttempts: number; availableAt: string; status: "QUEUED" | "RUNNING" | "COMPLETED" | "DEAD_LETTER"; lastError?: string };
export class InMemoryJobQueue {
  private readonly jobs: PlatformJob[] = [];
  enqueue<T>(type: string, payload: T, options: { maximumAttempts?: number; availableAt?: Date; deduplicationKey?: string } = {}) { if (options.deduplicationKey) { const existing = this.jobs.find(item => item.type === type && item.deduplicationKey === options.deduplicationKey); if (existing) return structuredClone(existing as PlatformJob<T>); } const job: PlatformJob<T> = { jobId: randomUUID(), type, payload: structuredClone(payload), ...(options.deduplicationKey ? { deduplicationKey: options.deduplicationKey } : {}), attempts: 0, maximumAttempts: options.maximumAttempts ?? 3, availableAt: (options.availableAt ?? new Date()).toISOString(), status: "QUEUED" }; this.jobs.push(job as PlatformJob); return structuredClone(job); }
  next(now = new Date()) { const job = this.jobs.find(item => item.status === "QUEUED" && new Date(item.availableAt) <= now); if (!job) return undefined; job.status = "RUNNING"; job.attempts += 1; return structuredClone(job); }
  complete(jobId: string) { const job = this.require(jobId); job.status = "COMPLETED"; }
  fail(jobId: string, error: unknown, retryDelayMs = 1_000) { const job = this.require(jobId); job.lastError = error instanceof Error ? error.message : "Job failed"; if (job.attempts >= job.maximumAttempts) job.status = "DEAD_LETTER"; else { job.status = "QUEUED"; job.availableAt = new Date(Date.now() + retryDelayMs).toISOString(); } }
  deadLetters() { return structuredClone(this.jobs.filter(item => item.status === "DEAD_LETTER")); }
  retryDeadLetter(jobId: string) { const job = this.require(jobId); if (job.status !== "DEAD_LETTER") throw new Error("Only dead-letter jobs can be retried."); job.status = "QUEUED"; job.attempts = 0; job.lastError = undefined; job.availableAt = new Date().toISOString(); return structuredClone(job); }
  snapshot() { return structuredClone(this.jobs); }
  private require(jobId: string) { const job = this.jobs.find(item => item.jobId === jobId); if (!job) throw new Error("Job not found."); return job; }
}
export class PlatformWorker {
  constructor(queue: InMemoryJobQueue, handlers: Record<string, (payload: unknown) => Promise<void>>) { this.queue = queue; this.handlers = handlers; }
  private readonly queue: InMemoryJobQueue; private readonly handlers: Record<string, (payload: unknown) => Promise<void>>;
  async runOne(now = new Date()) { const job = this.queue.next(now); if (!job) return false; const handler = this.handlers[job.type]; try { if (!handler) throw new Error("No job handler registered."); await handler(job.payload); this.queue.complete(job.jobId); } catch (error) { this.queue.fail(job.jobId, error, 0); } return true; }
}
export class PlatformScheduler {
  constructor(privateQueue: InMemoryJobQueue) { this.queue = privateQueue; }
  private readonly queue: InMemoryJobQueue;
  schedule(type: string, payload: unknown, runAt: Date) { return this.queue.enqueue(type, payload, { availableAt: runAt }); }
}
