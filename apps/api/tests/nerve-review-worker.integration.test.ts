import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasourceUrl: process.env.NERVE_REVIEW_TEST_DATABASE_URL ?? 'postgresql://unused' }) };
});

import { prisma } from '../src/lib/prisma.js';
import { enqueueReview } from '../src/modules/nerve/review-events.js';
import { drainReviewJobs, scheduleDailyReviews } from '../src/modules/nerve/review-worker.js';
import { completedReviewFindings } from '../src/modules/intelligence/nerve-findings.js';

const suite = process.env.NERVE_REVIEW_TEST_DATABASE_URL ? describe : describe.skip;
suite('durable production agent reviews on isolated PostgreSQL', () => {
  afterAll(() => prisma.$disconnect());

  it('rolls back events, deduplicates replays, and recovers an expired lease across concurrent workers', async () => {
    const org = await prisma.organization.create({ data: { name: 'Agent integration fixture', intelligenceEnabledAt: new Date() } });
    const station = await prisma.station.create({ data: {
      organizationId: org.id, name: 'Agent fixture station', code: 'AGENT', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000',
    } });
    const event = { type: 'CUSTOMER_PAYMENT' as const, organizationId: org.id, stationId: station.id, resourceId: 'test-payment', occurredAt: new Date() };
    await expect(prisma.$transaction(async tx => {
      await enqueueReview(tx, event);
      throw new Error('Rollback fixture');
    })).rejects.toThrow('Rollback fixture');
    expect(await prisma.nerveReviewJob.count({ where: { organizationId: org.id } })).toBe(0);
    await prisma.$transaction(async tx => {
      await enqueueReview(tx, event);
      await enqueueReview(tx, event);
    });
    const queued = await prisma.nerveReviewJob.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(await prisma.nerveReviewJob.count({ where: { organizationId: org.id } })).toBe(1);
    await prisma.nerveReviewJob.update({
      where: { id: queued.id }, data: { leaseToken: 'interrupted', leaseUntil: new Date(Date.now() - 1000), attempts: 1 },
    });
    const workers = await Promise.all([drainReviewJobs(), drainReviewJobs()]);
    expect(workers.reduce((sum, worker) => sum + worker.completed, 0)).toBe(1);
    const completed = await prisma.nerveReviewJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(completed.attempts).toBe(2);
    expect(completed.outcome).toMatchObject({ run: { status: 'COMPLETED', agentKey: 'credit-watch' }, findings: [] });
    expect(completed.leaseToken).toBeNull();

    expect(await scheduleDailyReviews()).toBe(6);
    expect(await scheduleDailyReviews()).toBe(0);
    await drainReviewJobs();
    await drainReviewJobs();
    const scheduled = await prisma.nerveReviewJob.findMany({ where: { organizationId: org.id, eventType: 'DAILY_REVIEW' } });
    expect(scheduled).toHaveLength(6);
    expect(scheduled.every(row => row.completedAt !== null)).toBe(true);
    expect(scheduled.find(row => row.agentKey === 'business-assistant')?.outcome).toMatchObject({ answer: expect.any(Object) });
    const reviews = await completedReviewFindings(org.id, station.id);
    expect(reviews).toHaveLength(5);
    expect(reviews.find(row => row.agentKey === 'profit-insight')?.sources[0]?.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ tenantId: org.id, applicationId: 'fuelnerve' })]),
    );
    expect(await completedReviewFindings('another-organization', station.id)).toEqual([]);
    expect(await completedReviewFindings(org.id, 'another-station')).toEqual([]);

    await enqueueReview(prisma, { ...event, resourceId: 'queued-before-expiry' });
    await prisma.organization.update({ where: { id: org.id }, data: { intelligenceExpiresAt: new Date(Date.now() - 1000) } });
    expect(await drainReviewJobs()).toMatchObject({ skipped: 1, completed: 0 });
  }, 30_000);
});
