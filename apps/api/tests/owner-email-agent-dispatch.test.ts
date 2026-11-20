import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), station: vi.fn(), receipt: vi.fn(), send: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { nerveReviewJob: mock, station: { findFirst: mock.station } } }));
vi.mock('../src/modules/notifications/message-facts.js', () => ({ readReceiptMessageFacts: mock.receipt }));
vi.mock('../src/modules/notifications/service.js', () => ({ getSettings: vi.fn(), sendOwnerNotification: mock.send, prepareEmailNotifications: (run: () => unknown) => run() }));
import { drainAgentMessages } from '../src/modules/notifications/agent-dispatch.js';
const job = () => ({ id: 'j1', organizationId: 'org-a', stationId: 's1', agentKey: 'purchase-check', eventType: 'RECEIPT_RECORDED', resourceId: 'r1', createdAt: new Date(), occurredAt: new Date(), emailNextAt: new Date(), notificationNextAt: new Date() });
beforeEach(() => { vi.resetAllMocks(); mock.findMany.mockResolvedValue([]); mock.updateMany.mockResolvedValue({ count: 1 }); mock.station.mockResolvedValue({ organization: { intelligenceEnabledAt: new Date('2026-01-01') } }); });
it('requires an explicit email scope and claims only the email progress fields', async () => {
 await drainAgentMessages({ channel: 'EMAIL' }); expect(mock.findMany).not.toHaveBeenCalled();
 const old = { ...job(), occurredAt: new Date(Date.now() - 86_400_001) }; mock.findMany.mockResolvedValue([old]);
 await drainAgentMessages({ channel: 'EMAIL', organizationIds: ['org-a'] });
 expect(mock.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: { in: ['org-a'] }, emailHandledAt: null });
 const claim = mock.updateMany.mock.calls[0][0]; expect(claim.where).toMatchObject({ emailHandledAt: null, emailNextAt: old.emailNextAt }); expect(claim.data.emailNextAt).toBeInstanceOf(Date);
 expect(claim.data.notificationNextAt).toBeUndefined(); expect(mock.update.mock.calls[0][0].data.emailHandledAt).toBeInstanceOf(Date);
 expect(mock.receipt).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
});
it('does not process a simultaneous email claim twice', async () => {
 mock.findMany.mockResolvedValue([job()]); mock.updateMany.mockResolvedValue({ count: 0 });
 await drainAgentMessages({ channel: 'EMAIL', organizationIds: ['org-a'] }); expect(mock.station).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
});
it('preserves the original WhatsApp dispatcher fields', async () => {
 await drainAgentMessages(); expect(mock.findMany.mock.calls[0][0].where).toMatchObject({ notificationHandledAt: null }); expect(mock.findMany.mock.calls[0][0].where.emailHandledAt).toBeUndefined();
});
