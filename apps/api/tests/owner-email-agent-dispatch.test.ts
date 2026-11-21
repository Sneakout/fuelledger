import { Prisma } from '@prisma/client';
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), station: vi.fn(), receipt: vi.fn(), shift: vi.fn(), previousEmail: vi.fn(), send: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { nerveReviewJob: mock, station: { findFirst: mock.station }, ownerEmailDelivery: { findFirst: mock.previousEmail } } }));
vi.mock('../src/modules/notifications/message-facts.js', () => ({ readReceiptMessageFacts: mock.receipt, readShiftMessageFacts: mock.shift }));
vi.mock('../src/modules/notifications/service.js', () => ({ getSettings: vi.fn(), sendOwnerNotification: mock.send, prepareEmailNotifications: (run: () => unknown) => run() }));
import { drainAgentMessages, prepareReconciledShiftEmail } from '../src/modules/notifications/agent-dispatch.js';
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

it('prepares only the newly reconciled shift without draining unrelated events or sending WhatsApp', async () => {
 await prepareReconciledShiftEmail('org-a', 'shift-new');
 expect(mock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
   organizationId: { in: ['org-a'] }, resourceId: 'shift-new', eventType: 'SHIFT_RECONCILED',
   agentKey: 'reconciliation-review', emailHandledAt: null,
 }) }));
 expect(mock.send).not.toHaveBeenCalled();
});

it('prepares a complete reconciled summary immediately and leaves incomplete facts retryable', async () => {
 const review = { ...job(), agentKey: 'reconciliation-review', eventType: 'SHIFT_RECONCILED', resourceId: 'shift-new' };
 mock.findMany.mockResolvedValue([review]);
 const d = (n: number) => new Prisma.Decimal(n);
 const facts = { shiftId: 'shift-new', shiftNumber: 2, completeness: 'COMPLETE', closedAt: new Date(),
   station: { id: 's1', name: 'Test fuel station' }, sales: [], tanks: [],
   collections: { reconciliationId: 'recon-2', actual: d(1000), expected: d(1000), adjustedExpected: d(1000), difference: d(0) } };
 mock.shift.mockResolvedValue(facts); mock.send.mockResolvedValue({ status: 'QUEUED' });
 await prepareReconciledShiftEmail('org-a', 'shift-new');
 expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'SHIFT_CLOSED_SUMMARY',
   organizationId: 'org-a', stationId: 's1', dedupeKey: 'shift-summary:shift-new:recon-2' }));
 expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ data: { emailHandledAt: expect.any(Date) } }));
 mock.send.mockClear(); mock.update.mockClear(); mock.shift.mockResolvedValue({ ...facts, completeness: 'INCOMPLETE' });
 const result = await prepareReconciledShiftEmail('org-a', 'shift-new');
 expect(result.deferred).toBe(1); expect(mock.send).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
});
