import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { ownerNotificationDelivery: mock } }));
import { drainWhatsAppQueue } from '../src/modules/notifications/delivery-queue.js';
beforeEach(() => { vi.resetAllMocks(); mock.findMany.mockResolvedValue([]); mock.updateMany.mockResolvedValue({count:0}); });
it('limits manual dispatch and expired-lease recovery to the selected organization and message', async () => {
  await drainWhatsAppQueue(new Date(), {organizationId:'owner-a',deliveryId:'message-a'});
  expect(mock.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:'owner-a',id:'message-a',status:'PENDING'})}));
  for (const [query] of mock.updateMany.mock.calls) expect(query.where).toEqual(expect.objectContaining({organizationId:'owner-a',id:'message-a',status:'PROCESSING'}));
});
it('keeps scheduled worker dispatch unscoped', async () => {
  await drainWhatsAppQueue();
  const where = mock.findMany.mock.calls[0]![0].where;
  expect(where).not.toHaveProperty('organizationId');
  expect(where).not.toHaveProperty('id');
});
