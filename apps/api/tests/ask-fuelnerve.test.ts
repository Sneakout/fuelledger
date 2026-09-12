import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {} }));
import { matchAskIntent } from '../src/modules/intelligence/ask.js';
import { matchOwnerFollowUp, ownerAssistantReleaseRoute } from '../src/modules/intelligence/owner-assistant-coordinator.js';

describe('Ask FuelNerve controlled routing', () => {
  it.each([
    ['How is stock today?', 'STOCK_POSITION'],
    ['Are any shifts still open?', 'OPEN_SHIFTS'],
    ['How much did we collect by UPI?', 'COLLECTIONS'],
    ['What is today profit?', 'PROFIT'],
    ['Who owes us money?', 'CUSTOMER_DUES'],
    ['What supplier invoices are due?', 'SUPPLIER_DUES'],
    ['How is the business doing today?', 'TODAY_OVERVIEW'],
  ])('routes %s to %s', (question, intent) => expect(matchAskIntent(question)).toBe(intent));

  it('does not guess about unsupported topics', () => {
    expect(matchAskIntent('Should I hire another attendant?')).toBeNull();
    expect(matchAskIntent('Change yesterday’s sales')).toBeNull();
  });

  it.each([
    ['Give me details', 'GIVE_DETAILS'],
    ['Why first?', 'WHY_FIRST'],
    ['Show the records', 'SHOW_RECORDS'],
  ])('recognises the controlled follow-up %s', (question, followUp) => expect(matchOwnerFollowUp(question)).toBe(followUp));

  it('keeps production on legacy unless explicitly released and supports immediate rollback', () => {
    const base = { rolloutPercent: 100, environment: 'production' as const, organizationId: 'org-a', userId: 'owner-a' };
    expect(ownerAssistantReleaseRoute({ ...base, stage: 'OFF', rollback: false })).toBe('LEGACY');
    expect(ownerAssistantReleaseRoute({ ...base, stage: 'STAGING', rollback: false })).toBe('LEGACY');
    expect(ownerAssistantReleaseRoute({ ...base, stage: 'PRODUCTION', rollback: false })).toBe('COORDINATOR');
    expect(ownerAssistantReleaseRoute({ ...base, stage: 'PRODUCTION', rollback: true })).toBe('LEGACY');
  });
});
