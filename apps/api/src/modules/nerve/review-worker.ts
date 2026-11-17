import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { hasActiveIntelligence } from '@fuelledger/shared';
import { indiaDate } from '../../lib/india-time.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { reviewJobs } from './review-events.js';
import { runReview } from './review-runtime.js';

const maxAttempts = 5;
const leaseMs = 120_000;

export async function scheduleDailyReviews(now = new Date()) {
  const stations = await prisma.station.findMany({
    where: { active: true, organization: { intelligenceEnabledAt: { lte: now }, OR: [{ intelligenceExpiresAt: null }, { intelligenceExpiresAt: { gt: now } }] } },
    select: { id: true, organizationId: true },
  });
  const date = indiaDate(now);
  let queued = 0;
  for (let index = 0; index < stations.length; index += 100) {
    const data = stations.slice(index, index + 100).flatMap(station => reviewJobs({
      type: 'DAILY_REVIEW', organizationId: station.organizationId, stationId: station.id, resourceId: date, occurredAt: now,
    }));
    queued += (await prisma.nerveReviewJob.createMany({ data, skipDuplicates: true })).count;
  }
  return queued;
}

export async function drainReviewJobs() {
  const totals = { completed: 0, retried: 0, failed: 0, skipped: 0 };
  const started = Date.now();
  for (let slot = 0; slot < 4 && Date.now() - started < 85_000; slot++) {
    const now = new Date();
    const available = { completedAt: null, failedAt: null, availableAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] };
    const job = await prisma.nerveReviewJob.findFirst({ where: available, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] });
    if (!job) break;
    const leaseToken = randomUUID();
    const lease = await prisma.nerveReviewJob.updateMany({
      where: { id: job.id, ...available },
      data: { leaseToken, leaseUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } },
    });
    if (!lease.count) continue;
    const owned = { id: job.id, leaseToken, completedAt: null, failedAt: null };
    const release = { leaseToken: null, leaseUntil: null };
    try {
      if (job.attempts >= maxAttempts) {
        const saved = await prisma.nerveReviewJob.updateMany({ where: owned, data: { ...release, failedAt: now, lastError: 'RETRY_LIMIT' } });
        totals.failed += saved.count;
        continue;
      }
      const station = await prisma.station.findFirst({
        where: { id: job.stationId, organizationId: job.organizationId, active: true },
        select: { organization: { select: { intelligenceEnabledAt: true, intelligenceExpiresAt: true } } },
      });
      const allowed = station && hasActiveIntelligence(station.organization);
      const outcome = allowed ? await runReview(job, AbortSignal.timeout(20_000)) : { skipped: true };
      const saved = await prisma.nerveReviewJob.updateMany({
        where: { ...owned, leaseUntil: { gt: new Date() } },
        data: { ...release, completedAt: new Date(), lastError: null, outcome: JSON.parse(JSON.stringify(outcome)) as Prisma.InputJsonValue },
      });
      totals[allowed ? 'completed' : 'skipped'] += saved.count;
    } catch (error) {
      const attempts = job.attempts + 1;
      const terminal = attempts >= maxAttempts;
      const saved = await prisma.nerveReviewJob.updateMany({
        where: owned,
        data: { ...release, lastError: error instanceof Error ? error.name : 'ReviewError',
          ...(terminal ? { failedAt: new Date() } : { availableAt: new Date(Date.now() + 60_000 * 2 ** (attempts - 1)) }) },
      });
      totals[terminal ? 'failed' : 'retried'] += saved.count;
      logger.warn({ jobId: job.id, agentKey: job.agentKey, attempts, errorName: error instanceof Error ? error.name : 'ReviewError' }, 'Agent review failed');
    }
  }
  return totals;
}
