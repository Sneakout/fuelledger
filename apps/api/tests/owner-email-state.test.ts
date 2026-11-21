import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ owner: vi.fn(), preference: vi.fn(), organization: vi.fn(), settings: vi.fn(), welcome: vi.fn(), ready: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { user: { findFirst: mock.owner }, ownerEmailPreference: { findFirst: mock.preference }, organization: { findUnique: mock.organization }, ownerNotificationSettings: { findUnique: mock.settings }, ownerEmailDelivery: { findFirst: mock.welcome } } }));
vi.mock('../src/modules/notifications/email-queue.js', () => ({ emailDeliveryReady: mock.ready, validOwnerEmail: (value: string) => value.includes('@') }));
import { nextEmailSummary, readOwnerEmailState } from '../src/modules/notifications/email-owner-state.js';
const now = new Date('2026-11-21T02:00:00Z');
beforeEach(() => {
 vi.resetAllMocks(); mock.owner.mockResolvedValue({ id: 'owner', name: 'Owner', email: 'Owner@example.com' }); mock.preference.mockResolvedValue({ enabled: true, adminPaused: false });
 mock.organization.mockResolvedValue({ lifetimeAccessPaidAt: null, subscriptionActivatedAt: new Date('2026-01-01'), subscriptionExpiresAt: null });
 mock.settings.mockResolvedValue({ dailySummaryEnabled: true, dailySummaryHour: 20 }); mock.welcome.mockResolvedValue(null); mock.ready.mockReturnValue(true);
});
it('keeps setup pending until an exact-recipient welcome is accepted', async () => {
 for (const status of ['PENDING','PROCESSING','FAILED','UNKNOWN']) {
  mock.welcome.mockResolvedValue({ id: 'welcome', status, acceptedAt: null });
  expect(await readOwnerEmailState('org', 'owner', now)).toMatchObject({ state: 'SETUP', nextSummaryAt: null });
 }
 expect(mock.welcome.mock.calls[0][0].where).toEqual({ organizationId: 'org', ownerId: 'owner', destination: 'owner@example.com', type: 'OWNER_WELCOME' });
});
it('only reports active when consent, subscription, welcome and rollout all permit sending', async () => {
 mock.welcome.mockResolvedValue({ id: 'welcome', status: 'ACCEPTED', acceptedAt: new Date('2026-11-20') });
 expect(await readOwnerEmailState('org', 'owner', now)).toMatchObject({ state: 'ACTIVE', nextSummaryAt: '2026-11-21T14:30:00.000Z' });
 mock.ready.mockReturnValue(false); expect((await readOwnerEmailState('org', 'owner', now)).state).toBe('PAUSED');
 mock.ready.mockReturnValue(true); mock.organization.mockResolvedValue({ subscriptionActivatedAt: new Date('2026-01-01'), subscriptionExpiresAt: new Date('2026-11-20') });
 expect((await readOwnerEmailState('org', 'owner', now)).state).toBe('PAUSED');
 mock.preference.mockResolvedValue({ enabled: false }); expect((await readOwnerEmailState('org', 'owner', now)).state).toBe('OFF');
});
it('supports support pauses without removing welcome acceptance or owner consent', async () => {
 mock.welcome.mockResolvedValue({ id: 'welcome', status: 'ACCEPTED', acceptedAt: new Date('2026-11-20') });
 mock.preference.mockResolvedValue({ enabled: true, adminPaused: true });
 expect(await readOwnerEmailState('org','owner',now)).toMatchObject({ state: 'PAUSED', consent: true, welcomeStatus: 'ACCEPTED', nextSummaryAt: null });
});
it('shows the next future IST summary across midnight and activation after the scheduled hour', () => {
 expect(nextEmailSummary(20, new Date('2026-11-21T15:00:00Z'), new Date('2026-11-21T16:00:00Z'))).toBe('2026-11-22T14:30:00.000Z');
 expect(nextEmailSummary(0, new Date('2026-11-20'), new Date('2026-11-21T18:29:00Z'))).toBe('2026-11-21T18:30:00.000Z');
});
