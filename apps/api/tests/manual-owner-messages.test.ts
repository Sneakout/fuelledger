import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ station: vi.fn(), org: vi.fn(), owner: vi.fn(), tanks: vi.fn(), receipt: vi.fn(), shift: vi.fn(), credit: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { station: { findFirst: mock.station }, organization: { findUnique: mock.org }, user: { findFirst: mock.owner }, tank: { findMany: mock.tanks }, purchaseReceipt: { findFirst: mock.receipt }, shift: { findFirst: mock.shift } } }));
vi.mock('../src/modules/notifications/message-facts.js', () => ({ readCustomerCreditFacts: mock.credit, readDailyOperatingFacts: vi.fn(), readReceiptMessageFacts: vi.fn(), readShiftMessageFacts: vi.fn(), readTankAlertFacts: vi.fn() }));
import { prepareManualOwnerMessage } from '../src/modules/notifications/manual-owner-messages.js';
const now = new Date('2026-11-19T06:00:00Z');
const input = { stationId: 'station-a', type: 'OWNER_WELCOME' as const, date: '2026-11-19' };
const settings = { whatsappNumber: '918086306454', whatsappOptedIn: true, lowStockEnabled: true, receiptSummaryEnabled: true, overdueCustomerEnabled: true };
beforeEach(() => { vi.resetAllMocks(); mock.station.mockResolvedValue({ id: 'station-a', name: 'Mughal Petroleum' }); mock.org.mockResolvedValue({ notificationSettings: settings, intelligenceEnabledAt: new Date('2026-01-01') }); mock.owner.mockResolvedValue({ name: 'Real Owner', email: 'owner@example.com' }); });
it('uses the real owner and station for welcome without exposing passwords', async () => {
 const result = await prepareManualOwnerMessage('org-a', input, now);
 expect(result.body).toContain('Mughal Petroleum'); expect(result.body).toContain('owner@example.com'); expect(result.body).toContain('/login');
 expect(mock.owner.mock.calls[0][0].select).toEqual({ name: true, email: true });
 expect(result.destination).toBe(settings.whatsappNumber);
});
it('rejects stations outside the selected organization before reading facts', async () => {
 mock.station.mockResolvedValue(null);
 await expect(prepareManualOwnerMessage('org-a', input, now)).rejects.toMatchObject({ code: 'STATION_NOT_FOUND' });
 expect(mock.station.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-a', id: 'station-a' }); expect(mock.org).not.toHaveBeenCalled();
});
it('rechecks revoked consent on every preparation', async () => {
 await prepareManualOwnerMessage('org-a', input, now);
 mock.org.mockResolvedValue({ notificationSettings: { ...settings, whatsappOptedIn: false } });
 await expect(prepareManualOwnerMessage('org-a', input, now)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
});
it('rejects future and invalid calendar dates', async () => {
 for (const date of ['2026-11-20', '2026-02-30']) await expect(prepareManualOwnerMessage('org-a', { ...input, date }, now)).rejects.toMatchObject({ code: 'INVALID_DATE' });
});
it('does not allow Core to prepare intelligence messages', async () => {
 mock.org.mockResolvedValue({ notificationSettings: settings, intelligenceEnabledAt: null });
 await expect(prepareManualOwnerMessage('org-a', { ...input, type: 'LOW_STOCK' }, now)).rejects.toMatchObject({ code: 'PLAN_REQUIRED' });
});
it('does not fabricate low-stock or receipt messages', async () => {
 mock.tanks.mockResolvedValue([]); mock.receipt.mockResolvedValue(null);
 for (const type of ['LOW_STOCK', 'PURCHASE_RECEIPT_SUMMARY'] as const) await expect(prepareManualOwnerMessage('org-a', { ...input, type }, now)).rejects.toMatchObject({ code: 'NO_ELIGIBLE_RECORDS' });
});
it('reads current station-scoped balances and exposes disputed or unknown dues', async () => {
 mock.credit.mockResolvedValue([{ customerName: 'ABC', outstanding: 200, overdueAmount: 50, oldestDaysOverdue: 3, hasDisputedBalance: true }]);
 const result = await prepareManualOwnerMessage('org-a', { ...input, type: 'OVERDUE_CUSTOMER' }, now);
 expect(mock.credit).toHaveBeenCalledWith({ organizationId: 'org-a', stationId: 'station-a' }, now);
 expect(result.body).toContain('200'); expect(result.body).toContain('3 days overdue'); expect(result.body).toContain('disputed');
});
it('respects disabled owner categories even for manual sharing', async () => {
 mock.org.mockResolvedValue({ notificationSettings: { ...settings, lowStockEnabled: false }, intelligenceEnabledAt: new Date('2026-01-01') });
 await expect(prepareManualOwnerMessage('org-a', { ...input, type: 'LOW_STOCK' }, now)).rejects.toMatchObject({ code: 'CATEGORY_DISABLED' }); expect(mock.tanks).not.toHaveBeenCalled();
});
it('scopes explicit receipt identifiers to both organization and station', async () => {
 mock.receipt.mockResolvedValue(null);
 await expect(prepareManualOwnerMessage('org-a', { ...input, type: 'PURCHASE_RECEIPT_SUMMARY', sourceId: 'foreign' }, now)).rejects.toMatchObject({ code: 'NO_ELIGIBLE_RECORDS' });
 expect(mock.receipt.mock.calls[0][0].where).toMatchObject({ id: 'foreign', organizationId: 'org-a', stationId: 'station-a' });
});
