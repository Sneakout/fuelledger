import { beforeEach, expect, it, vi } from 'vitest';
import { ownerNotificationSettingsSchema } from '@fuelledger/shared';
const mock = vi.hoisted(() => ({ preference: vi.fn(), settings: vi.fn(), welcome: vi.fn(), queue: vi.fn() }));
const tx = vi.hoisted(() => ({ ownerEmailPreference: { upsert: mock.preference }, ownerNotificationSettings: { upsert: mock.settings } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { $transaction: (run: (db: typeof tx) => Promise<unknown>) => run(tx) } }));
vi.mock('../src/modules/notifications/email-queue.js', () => ({ queueOwnerEmail: mock.queue, queueEmailWelcome: mock.welcome }));
import { updateSettings } from '../src/modules/notifications/service.js';
const input = () => ownerNotificationSettingsSchema.parse({ whatsappNumber: '', whatsappOptedIn: false, emailEnabled: true, densityMissingEnabled: true, lowStockEnabled: true, shiftVarianceEnabled: true, unclosedShiftEnabled: true, dailySummaryEnabled: true, overdueCustomerEnabled: true, lowStockPercent: 20, varianceThreshold: 500, stockVarianceTolerance: 50, dailySummaryHour: 20 });
beforeEach(() => { vi.resetAllMocks(); mock.settings.mockResolvedValue({ whatsappNumber: null, whatsappOptedIn: false, varianceThreshold: 500, stockVarianceTolerance: 50 }); });
it('stores opt-in for the authenticated owner and queues welcome in the same transaction', async () => {
 const result = await updateSettings('org-a', input(), 'Owner', 'owner-a');
 expect(mock.preference).toHaveBeenCalledWith({ where: { ownerId: 'owner-a' }, create: { organizationId: 'org-a', ownerId: 'owner-a', enabled: true }, update: { enabled: true } });
 expect(mock.welcome).toHaveBeenCalledWith('org-a', tx); expect(result.emailEnabled).toBe(true);
});
it('opting out affects that owner only and does not queue another welcome', async () => {
 const result = await updateSettings('org-a', { ...input(), emailEnabled: false }, 'Owner', 'owner-b');
 expect(mock.preference.mock.calls[0][0].where).toEqual({ ownerId: 'owner-b' }); expect(mock.welcome).not.toHaveBeenCalled(); expect(result.emailEnabled).toBe(false);
});

it('email-only preparation queues email without writing WhatsApp deliveries, alerts or push', async () => {
 const { prepareEmailNotifications, sendOwnerNotification } = await import('../src/modules/notifications/service.js');
 const { prisma } = await import('../src/lib/prisma.js');
 Object.assign(prisma, { ownerNotificationSettings: { findUnique: vi.fn().mockResolvedValue({ dailySummaryEnabled: true }) }, organization: { findUnique: vi.fn().mockResolvedValue({}) } });
 await prepareEmailNotifications(() => sendOwnerNotification({ organizationId: 'org-a', type: 'DAILY_SUMMARY', dedupeKey: 'daily-summary:org-a:2026-11-20',
 packet: { subjectName: 'Daily operating summary', recordType: 'CORE_DAILY_SUMMARY', product: null, eventDate: '2026-11-20T15:00:00Z', dueDate: null, amount: null, quantity: null, status: 'COMPLETE', daysOverdueOrWaiting: null, station: { id: null, name: 'All fuel stations' }, evidence: [{ label: 'Daily reports', path: '/reports', recordType: 'REPORT', recordId: '2026-11-20' }], availableActions: ['VIEW_RECORD'] }, message: () => 'Verified daily figures' }));
 expect(mock.queue).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a', type: 'DAILY_SUMMARY', message: 'Verified daily figures' }));
});
