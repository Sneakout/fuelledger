import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { addIndiaDays, databaseDate, indiaDate } from '../src/lib/india-time.js';
import { dailyBriefWorkspace, setBriefFindingPreference } from '../src/modules/intelligence/daily-brief-workspace.js';

vi.mock('../src/lib/prisma.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasourceUrl: process.env.DAILY_BRIEF_TEST_DATABASE_URL ?? 'postgresql://unused' }) };
});

const suite = process.env.DAILY_BRIEF_TEST_DATABASE_URL ? describe : describe.skip;
suite('Daily Brief records and owner preferences', () => {
  afterAll(() => prisma.$disconnect());

  it('reports missing dates, keeps acknowledged issues open, and shows a verified reconciliation closure', async () => {
    const organization = await prisma.organization.create({ data: { name: 'Brief fixture' } });
    const organizationId = organization.id;
    const station = await prisma.station.create({ data: { organizationId, name: 'Brief station', code: 'BRIEF',
      addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const owner = (name: string) => prisma.user.create({ data: { organizationId, name, email: `${name}-${organizationId}@example.test`, passwordHash: 'test', role: 'OWNER' } });
    const [primary, second] = await Promise.all([owner('primary'), owner('second')]);
    const scope = { organizationId, stationId: station.id, userId: primary.id };
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const product = await prisma.product.create({ data: { organizationId, code: 'HSD', name: 'Diesel', category: 'FUEL', unit: 'LITRE', tankLinked: true } });
    const date = indiaDate(new Date());
    await prisma.historicalSalesImport.create({ data: { organizationId, stationId: station.id, productId: product.id,
      monthStart: databaseDate(`${addIndiaDays(date, -2).slice(0, 7)}-01`), sourceFileName: 'test.pdf', sourceMimeType: 'application/pdf',
      sourceSize: 1, sourceContent: Buffer.from('x'), sourceFingerprint: 'fixture', rows: [{ date: addIndiaDays(date, -2) }], importedById: primary.id } });
    const shift = await prisma.shift.create({ data: { stationId: station.id, configurationId: config.id, managerId: primary.id,
      shiftNumber: 1, status: 'RECONCILIATION_REQUIRED', openingCash: 0, closedAt: new Date() } });
    const initial = await dailyBriefWorkspace(scope, false);
    expect(initial.coverage.gaps[0]?.missingDates).toEqual([addIndiaDays(date, -1), date]);
    expect(initial.attention[0]).toMatchObject({ title: 'Shift #1 needs reconciliation', severity: 'URGENT',
      records: [{ path: `/reconciliation?shiftId=${shift.id}` }] });
    const key = initial.attention[0]!.key;
    await setBriefFindingPreference(scope, key, 'ACKNOWLEDGE');
    await setBriefFindingPreference(scope, key, 'REMIND_LATER');
    const acknowledged = (await dailyBriefWorkspace(scope, false)).attention.find(item => item.key === key);
    expect(acknowledged?.acknowledgedAt).toBeInstanceOf(Date);
    expect(acknowledged?.remindAt?.getTime()).toBeGreaterThan(Date.now());
    expect((await dailyBriefWorkspace({ ...scope, userId: second.id }, false)).attention.find(item => item.key === key)?.acknowledgedAt).toBeNull();
    expect((await dailyBriefWorkspace(scope, false)).resolved).toHaveLength(0);

    await prisma.shift.update({ where: { id: shift.id }, data: { status: 'LOCKED', reconciliation: { create: { reconciledById: primary.id,
      notes: 'Matched cash and card handover', collections: { create: { paymentMethod: 'CASH', expectedAmount: 100, actualAmount: 100, varianceAmount: 0 } } } } } });
    const refreshed = await dailyBriefWorkspace(scope, false);
    expect(refreshed.attention.some(item => item.key === key)).toBe(false);
    expect(refreshed.summary.collections).toBe(100);
    expect(refreshed.resolved[0]).toMatchObject({ title: 'Shift #1 reconciled', detail: 'Matched cash and card handover' });
    await expect(setBriefFindingPreference(scope, key, 'ACKNOWLEDGE')).rejects.toThrow('finding changed');
    await expect(dailyBriefWorkspace({ ...scope, organizationId: 'other-organization' }, false)).rejects.toThrow('active fuel station');
  }, 20_000);
});
