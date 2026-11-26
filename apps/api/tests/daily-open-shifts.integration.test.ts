import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { readDailyOperatingFacts } from '../src/modules/notifications/message-facts.js';

const url = process.env.SHIFT_DSR_TEST_DATABASE_URL;
const suite = url && url === process.env.DATABASE_URL ? describe : describe.skip;

suite('daily owner open-shift attention in PostgreSQL', () => {
  afterAll(async () => { await prisma.$disconnect(); });
  it('excludes closed, cancelled, current-day and out-of-scope shifts and refreshes after closing', async () => {
    const org = await prisma.organization.create({ data: { name: 'Daily attention verification' } });
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Owner', email: `${org.id}@example.test`, passwordHash: 'unused', role: 'OWNER' } });
    const makeStation = (code: string, organizationId = org.id, active = true) => prisma.station.create({ data: { organizationId, name: code, code, active, addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000', configurations: { create: { version: 1 } } }, include: { configurations: true } });
    const station = await makeStation('S1');
    const otherStation = await makeStation('S2');
    const inactive = await makeStation('S3', org.id, false);
    const otherOrg = await prisma.organization.create({ data: { name: 'Other organization' } });
    const foreign = await makeStation('S1', otherOrg.id);
    const older = new Date('2026-11-24T02:30:00Z');
    const makeShift = (s: typeof station, shiftNumber: number, status: 'OPEN' | 'LOCKED' | 'CANCELLED' = 'OPEN', openedAt = older, closedAt: Date | null = null) => prisma.shift.create({ data: { stationId: s.id, configurationId: s.configurations[0]!.id, managerId: owner.id, shiftNumber, status, openedAt, closedAt, openingCash: 0 } });
    const pending = await makeShift(station, 1);
    await makeShift(station, 2, 'LOCKED', older, new Date('2026-11-24T12:00:00Z'));
    await makeShift(station, 3, 'CANCELLED');
    await makeShift(station, 4, 'OPEN', new Date('2026-11-25T18:30:00Z'));
    const other = await makeShift(otherStation, 1);
    await makeShift(inactive, 1);
    await makeShift(foreign, 1);
    const now = new Date('2026-11-26T12:00:00Z');
    const facts = await readDailyOperatingFacts({ organizationId: org.id, stationId: station.id }, '2026-11-25', now);
    expect(facts.openShifts.map(s => s.id)).toEqual([pending.id]);
    expect(facts.collections.incomplete).toBe(true);
    expect(facts.period.end).toEqual(new Date('2026-11-25T18:29:59.999Z'));
    const allStations = await readDailyOperatingFacts({ organizationId: org.id }, '2026-11-23', now);
    expect(allStations.openShifts.map(s => s.id).sort()).toEqual([pending.id, other.id].sort());
    expect(allStations.collections.incomplete).toBe(false);
    await prisma.shift.update({ where: { id: pending.id }, data: { status: 'LOCKED', closedAt: new Date('2026-11-26T11:00:00Z') } });
    const refreshed = await readDailyOperatingFacts({ organizationId: org.id, stationId: station.id }, '2026-11-25', now);
    expect(refreshed.openShifts).toEqual([]);
  }, 30000);
});
