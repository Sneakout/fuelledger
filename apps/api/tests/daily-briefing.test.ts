import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  dailyOwnerBriefing: {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(async (input: { create: { calculatedAt: Date } }) => input.create),
  },
}));
vi.mock('../src/config/env.js', () => ({ env: { OPENAI_API_KEY: 'model-fixture', OPENAI_BRIEFING_MODEL: 'fixture' } }));
vi.mock('../src/modules/dashboard/service.js', () => ({
  bootstrap: vi.fn().mockResolvedValue({
    today: { grossSales: 1412510, netProfit: 11420, receivables: 0, payables: 0 },
    operations: { pendingReconciliations: 0, openShifts: 0 }, tankStocks: [], actions: [],
  }),
}));
vi.mock('../src/modules/reports/service.js', () => ({ buildReport: vi.fn().mockResolvedValue({ summary: { grossSales: 0 } }) }));
vi.mock('../src/modules/intelligence/history-completeness.js', () => ({ missingDailyRecords: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));

import { dailyBriefing, requireIntelligenceAccess } from '../src/modules/intelligence/daily-briefing.js';

describe('Core + Intelligence access', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');
  beforeEach(() => vi.clearAllMocks());

  it('rejects a Core-only account before any briefing calculations run', async () => {
    db.organization.findUnique.mockResolvedValue({ intelligenceEnabledAt: null, intelligenceExpiresAt: null });
    await expect(requireIntelligenceAccess('org', now)).rejects.toMatchObject({ code: 'INTELLIGENCE_PLAN_REQUIRED' });
  });

  it('accepts an active Core + Intelligence account', async () => {
    db.organization.findUnique.mockResolvedValue({ intelligenceEnabledAt: new Date('2026-09-01'), intelligenceExpiresAt: new Date('2027-09-01') });
    await expect(requireIntelligenceAccess('org', now)).resolves.toBeUndefined();
  });

  it('rejects Intelligence before its activation date', async () => {
    db.organization.findUnique.mockResolvedValue({ intelligenceEnabledAt: new Date('2026-09-08'), intelligenceExpiresAt: null });
    await expect(requireIntelligenceAccess('org', now)).rejects.toMatchObject({ code: 'INTELLIGENCE_PLAN_REQUIRED' });
  });

  it('rejects expired Intelligence access', async () => {
    db.organization.findUnique.mockResolvedValue({ intelligenceEnabledAt: new Date('2026-08-01'), intelligenceExpiresAt: new Date('2026-09-01') });
    await expect(requireIntelligenceAccess('org', now)).rejects.toMatchObject({ code: 'INTELLIGENCE_PLAN_REQUIRED' });
  });
});

describe('Daily briefing model outages', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['timeout', 'unavailable'] as const)('keeps verified facts on model %s', async failure => {
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      if (failure === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    db.organization.findUnique.mockResolvedValue({ intelligenceEnabledAt: new Date(0), intelligenceExpiresAt: null });
    const brief = await dailyBriefing('org', ['station'], 'station');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(brief).toMatchObject({ narrativeMode: 'DETERMINISTIC_FALLBACK', model: null });
    expect(brief.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sales-today', value: '₹14,12,510' }),
      expect.objectContaining({ id: 'profit-today', value: '₹11,420' }),
    ]));
    expect(brief.narrative.items.map(item => item.factId)).toEqual(brief.facts.map(fact => fact.id));
  });
});
