import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ organization: { findUnique: vi.fn() } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));

import { pendingPriceChangeFacts, requireIntelligenceAccess } from '../src/modules/intelligence/daily-briefing.js';

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

  it('rejects expired Intelligence access', async () => {
    db.organization.findUnique.mockResolvedValue({ intelligenceEnabledAt: new Date('2026-08-01'), intelligenceExpiresAt: new Date('2026-09-01') });
    await expect(requireIntelligenceAccess('org', now)).rejects.toMatchObject({ code: 'INTELLIGENCE_PLAN_REQUIRED' });
  });

  it('keeps each pending purchase-price decision visible to Purchase Agent', () => {
    expect(pendingPriceChangeFacts([{
      id: 'approval-hsd',
      evidence: {
        product: { code: 'HSD', unit: 'LITRE' },
        invoice: { id: 'invoice-1', invoiceNumber: 'IOCL-1' },
        currentPurchasePrice: 88,
        proposedPurchasePrice: 100.59,
      },
    }])).toEqual([expect.objectContaining({
      id: 'price-approval-approval-hsd',
      category: 'PURCHASES',
      severity: 'ATTENTION',
      label: 'HSD purchase price increased',
      value: '₹88 → ₹100.59 per litre',
      evidencePath: '/purchases?invoiceId=invoice-1',
    })]);
  });

  it('does not create a price alert when the observed price is unchanged', () => {
    expect(pendingPriceChangeFacts([{
      id: 'approval-unchanged',
      evidence: {
        product: { code: 'MS', unit: 'LITRE' },
        invoice: { id: 'invoice-2', invoiceNumber: 'IOCL-2' },
        currentPurchasePrice: 98,
        proposedPurchasePrice: 98.004,
      },
    }])).toEqual([]);
  });
});
