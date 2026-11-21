import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Prisma, type OwnerEmailDelivery } from '@prisma/client';
const mock = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), settings: vi.fn(), owners: vi.fn(), owner: vi.fn(), org: vi.fn(), station: vi.fn(), daily: vi.fn(), tank: vi.fn(), receipt: vi.fn(), shift: vi.fn(), credit: vi.fn(), preference: vi.fn() }));
vi.mock('../src/config/env.js', () => ({ env: { EMAIL_DELIVERY_ENABLED: true, SMTP2GO_API_KEY: 'test-only-secret-not-real', EMAIL_FROM: 'hello@mindvector.tech', EMAIL_ROLLOUT_ORGANIZATION_IDS: 'org-a', APP_URL: 'https://fuel.mindvector.tech' } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { ownerEmailDelivery: mock, ownerEmailPreference: { findFirst: mock.preference }, ownerNotificationSettings: { findUnique: mock.settings }, user: { findMany: mock.owners, findFirst: mock.owner }, organization: { findUnique: mock.org }, station: { findFirst: mock.station } } }));
vi.mock('../src/modules/notifications/delivery-queue.js', () => ({ creditDeliverySnapshot: mock.credit }));
vi.mock('../src/modules/notifications/message-facts.js', () => ({ readDailyOperatingFacts: mock.daily, readTankAlertFacts: mock.tank, readReceiptMessageFacts: mock.receipt, readShiftMessageFacts: mock.shift }));
import { drainEmailQueue, emailDeliveryReady, emailFactsStillCurrent, queueOwnerEmail, sendSmtp2go } from '../src/modules/notifications/email-queue.js';
import { env } from '../src/config/env.js';
import { emailCategories, renderOwnerEmail } from '../src/modules/notifications/email-template.js';
const job = () => ({ id: 'email-a', organizationId: 'org-a', stationId: null, ownerId: 'owner-a', destination: 'owner@example.com', type: 'OWNER_WELCOME', message: 'Your account is ready.', guard: {}, createdAt: new Date(), attempts: 0, recordType: 'OWNER_WELCOME' }) as OwnerEmailDelivery;
const settings = { emailEnabled: true, dailySummaryEnabled: true, overdueCustomerEnabled: true, lowStockEnabled: true, shiftSummaryEnabled: true, receiptSummaryEnabled: true };
beforeEach(() => { env.EMAIL_DELIVERY_ENABLED=true;env.SMTP2GO_API_KEY='test-only-secret-not-real';vi.resetAllMocks(); mock.findFirst.mockResolvedValue({ id: 'accepted-welcome', acceptedAt: new Date('2026-01-01') }); mock.findMany.mockResolvedValue([]); mock.updateMany.mockResolvedValue({ count: 1 }); mock.createMany.mockResolvedValue({ count: 1 }); mock.settings.mockResolvedValue(settings); mock.owners.mockResolvedValue([{ id: 'owner-a', email: 'owner@example.com', name: 'Owner' }]); mock.owner.mockResolvedValue({ email: 'owner@example.com', name: 'Owner' }); mock.preference.mockResolvedValue({ enabled: true }); mock.org.mockResolvedValue({ name: 'Test fuel station' }); });
afterEach(() => vi.unstubAllGlobals());
const mail = { id: 'email-a', destination: 'owner@example.com', subject: 'Test', html: '<p>Test</p>', text: 'Test' };
it('renders all agreed categories with escaped content, plain text and brand styling', () => {
 for (const type of emailCategories) {
  const result = renderOwnerEmail({ type, message: 'Sales: 2,345.123 L\nAmount: ₹2,14,412.90\n<script>alert(1)</script>', ownerName: '<Owner>', stationName: 'A & B', date: '2026-11-20', appUrl: 'https://fuel.mindvector.tech', sourceId: 'shift&1' });
  expect(result.html).toContain('#123d31'); expect(result.html).toContain('#d6f16b'); expect(result.html).toContain('2,345.123 L'); expect(result.html).toContain('₹2,14,412.90'); expect(result.html).toContain('&lt;script&gt;'); expect(result.html).not.toContain('<script>'); expect(result.text).toContain('Manage email preferences: https://fuel.mindvector.tech/notifications'); expect(result.html).toContain('Hello &lt;Owner&gt;');
 }
});
it('queues independently of WhatsApp and uses stable identity for duplicate events', async () => {
 const input = { organizationId: 'org-a', type: 'LOW_STOCK' as const, eventKey: 'episode-1', recordType: 'TANK', message: 'Stock is low', guard: {} };
 await queueOwnerEmail(input); await queueOwnerEmail(input);
 expect(mock.createMany.mock.calls[0][0].data.dedupeKey).toBe(mock.createMany.mock.calls[1][0].data.dedupeKey);
 expect(mock.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: { organizationId: 'org-a', ownerId: 'owner-a', destination: 'owner@example.com' } });
 expect(mock.owners.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-a', role: 'OWNER', active: true, loginEnabled: true });
});
it('does not queue without email consent, for disabled categories, or local/demo addresses', async () => {
 const input = { organizationId: 'org-a', type: 'LOW_STOCK' as const, eventKey: 'e', recordType: 'TANK', message: 'Stock', guard: {} };
 mock.owners.mockResolvedValue([]); await queueOwnerEmail(input);
 mock.owners.mockResolvedValue([{ id: 'owner-a', email: 'owner@example.com' }]);
 mock.settings.mockResolvedValue({ ...settings, lowStockEnabled: false }); await queueOwnerEmail(input);
 mock.settings.mockResolvedValue(settings); mock.owners.mockResolvedValue([{ id: 'demo', email: 'owner@fuelledger.local' }]); await queueOwnerEmail(input);
 expect(mock.createMany).not.toHaveBeenCalled();
});
it('recognises provider acceptance and sends one recipient with reply-to and no passwords', async () => {
 const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { succeeded: 1, failed: 0, email_id: 'provider-1' } }) }); vi.stubGlobal('fetch', fetcher);
 expect(await sendSmtp2go(mail)).toEqual({ status: 'ACCEPTED', providerMessageId: 'provider-1' });
 const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body.to).toEqual(['owner@example.com']); expect(body.sender).toBe('FuelNerve <hello@mindvector.tech>'); expect(body.custom_headers[0].value).toBe('hello@mindvector.tech');
});
it('holds timeouts, 5xx and ambiguous success rather than blindly retrying', async () => {
 for (const value of [{ status: 500 }, { ok: true, status: 200, json: async () => ({ data: { succeeded: 1 } }) }]) { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(value)); expect(await sendSmtp2go(mail)).toMatchObject({ status: 'UNKNOWN' }); }
 vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout'))); expect(await sendSmtp2go(mail)).toMatchObject({ status: 'UNKNOWN' });
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429 })); expect(await sendSmtp2go(mail)).toMatchObject({ status: 'RETRY' });
});
it('claims atomically and scopes manual processing and interrupted lease recovery', async () => {
 const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { succeeded: 1, failed: 0, email_id: 'p' } }) }); vi.stubGlobal('fetch', fetcher); mock.findMany.mockResolvedValue([job()]);
 await drainEmailQueue({ organizationId: 'org-a', deliveryId: 'email-a', manualWelcome: true });
 expect(mock.updateMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: 'org-a', id: 'email-a', status: 'PROCESSING' }, data: { status: 'UNKNOWN' } });
 expect(mock.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'email-a', status: 'PENDING' }, data: { status: 'PROCESSING' } });
 expect(fetcher).toHaveBeenCalledTimes(1); expect(mock.updateMany.mock.calls.at(-1)?.[0].data.status).toBe('ACCEPTED');
 mock.updateMany.mockResolvedValue({ count: 0 }); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rechecks consent, recipient, active station, plan and organization ownership before sending', async () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); mock.findMany.mockResolvedValue([job()]);
 mock.preference.mockResolvedValue(null); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true });
 expect(mock.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'email_or_category_disabled' });
 mock.preference.mockResolvedValue({ enabled: true }); mock.settings.mockResolvedValue(settings); mock.owner.mockResolvedValue({ email: 'new@example.com', name: 'Owner' }); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true });
 expect(mock.updateMany.mock.calls.at(-1)?.[0].data.suppressionReason).toBe('recipient_changed_or_ineligible');
 mock.owner.mockResolvedValue({ email: 'owner@example.com', name: 'Owner' }); mock.findMany.mockResolvedValue([{ ...job(), type: 'LOW_STOCK', stationId: 'foreign' }]); mock.station.mockResolvedValue(null); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true });
 expect(mock.updateMany.mock.calls.at(-1)?.[0].data.suppressionReason).toBe('fuel_station_unavailable');
 mock.findMany.mockResolvedValue([{ ...job(), type: 'LOW_STOCK' }]); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true }); expect(mock.updateMany.mock.calls.at(-1)?.[0].data.suppressionReason).toBe('subscription_inactive');
 mock.owner.mockResolvedValue(null); mock.findMany.mockResolvedValue([{ ...job(), organizationId: 'other-org' }]); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true }); expect(fetcher).not.toHaveBeenCalled();
});
it('suppresses credit reports after a payment changes the current snapshot', async () => {
 mock.credit.mockResolvedValue({ snapshot: 'paid-now' }); expect(await emailFactsStillCurrent({ ...job(), type: 'OVERDUE_CUSTOMER', guard: { snapshot: 'before-payment' } }, new Date())).toBe(false);
});
it('validates tank figures against current station-scoped facts', async () => {
 mock.tank.mockResolvedValue({ completeness: 'COMPLETE', bookStock: new Prisma.Decimal(900) });
 expect(await emailFactsStillCurrent({ ...job(), type: 'LOW_STOCK', stationId: 'station-a', guard: { sourceId: 'tank-a', quantity: 1000 } }, new Date())).toBe(false);
 expect(mock.tank.mock.calls[0][0]).toEqual({ organizationId: 'org-a', stationId: 'station-a' });
});
it('keeps batches bounded and scopes manual processing without excluding new organizations', async () => {
 await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true });
 expect(mock.findMany.mock.calls[0][0]).toMatchObject({where:{id:'email-a',status:'PENDING'},take:4});
 expect(mock.findMany.mock.calls[0][0].where.organizationId).toBeUndefined();
 mock.findMany.mockClear(); await drainEmailQueue({ organizationId: 'new-organization' });
 expect(mock.findMany.mock.calls[0][0].where).toMatchObject({organizationId:'new-organization',type:{not:'OWNER_WELCOME'}});
});
it('requeues only explicit rate-limit rejections with a future retry time', async () => {
 mock.findMany.mockResolvedValue([job()]); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429 })); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true });
 const update = mock.updateMany.mock.calls.at(-1)?.[0].data;
 expect(update.status).toBe('PENDING'); expect(update.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
 mock.findMany.mockResolvedValue([{ ...job(), attempts: 3 }]); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true }); expect(mock.updateMany.mock.calls.at(-1)?.[0].data.status).toBe('FAILED');
});
it('suppresses queued messages when the subscription expires or intelligence is downgraded', async () => {
 mock.findMany.mockResolvedValue([{ ...job(), type: 'LOW_STOCK' }]); mock.org.mockResolvedValue({ subscriptionActivatedAt: new Date('2026-01-01'), subscriptionExpiresAt: new Date('2026-01-02') });
 vi.stubGlobal('fetch', vi.fn()); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true }); expect(mock.updateMany.mock.calls.at(-1)?.[0].data.suppressionReason).toBe('subscription_inactive');
 mock.org.mockResolvedValue({ subscriptionActivatedAt: new Date('2026-01-01'), subscriptionExpiresAt: null, intelligenceEnabledAt: null }); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true }); expect(mock.updateMany.mock.calls.at(-1)?.[0].data.suppressionReason).toBe('category_not_in_plan');
 expect(fetch).not.toHaveBeenCalled();
});
it('uses same-site evidence links and ignores external or malformed links', () => {
 const base = { type: 'PURCHASE_RECEIPT_SUMMARY' as const, ownerName: 'Owner', stationName: 'Station', date: '2026-11-20', appUrl: 'https://fuel.mindvector.tech' };
 expect(renderOwnerEmail({ ...base, message: 'Receipt\nReview: https://fuel.mindvector.tech/purchases?invoiceId=abc' }).html).toContain('href="https://fuel.mindvector.tech/purchases?invoiceId=abc"');
 expect(renderOwnerEmail({ ...base, message: 'Receipt\nReview: https://attacker.example/purchases' }).html).not.toContain('href="https://attacker');
});

it('does not subscribe other owners and rechecks individual email consent', async () => {
 await queueOwnerEmail({ organizationId: 'org-a', type: 'OWNER_WELCOME', eventKey: 'welcome', recordType: 'OWNER_WELCOME', message: 'Welcome', guard: {} });
 expect(mock.owners.mock.calls[0][0].where.ownerEmailPreference).toEqual({ is: { organizationId: 'org-a', enabled: true, adminPaused: false } });
 mock.findMany.mockResolvedValue([job()]); mock.preference.mockResolvedValue(null); vi.stubGlobal('fetch', vi.fn()); await drainEmailQueue({ deliveryId: 'email-a', manualWelcome: true });
 expect(mock.preference.mock.calls[0][0].where).toEqual({ ownerId: 'owner-a', organizationId: 'org-a', enabled: true, adminPaused: false });
 expect(mock.updateMany.mock.calls.at(-1)?.[0].data.suppressionReason).toBe('email_or_category_disabled'); expect(fetch).not.toHaveBeenCalled();
});

it('keeps email daily-summary entitlement independent of WhatsApp for both paid plans', async () => {
 const { allowsOwnerEmail } = await import('../src/modules/notifications/email-queue.js');
 expect(allowsOwnerEmail('DAILY_SUMMARY', 'CORE_DAILY_SUMMARY', true)).toBe(true);
 expect(allowsOwnerEmail('DAILY_SUMMARY', 'CORE_DAILY_SUMMARY', false)).toBe(true);
 expect(allowsOwnerEmail('DAILY_SUMMARY', 'DAILY_BRIEFING', true)).toBe(false);
 expect(allowsOwnerEmail('LOW_STOCK', 'TANK', false)).toBe(false);
});
it('renders informative sections, exact decimals, attention states and accessible mobile markup', () => {
 const result = renderOwnerEmail({ type: 'SHIFT_CLOSED_SUMMARY', message: 'Shift #42 reconciled\nSales: MS: 2,345.123 L · HSD: 1,234.567 L\nExpected collection: ₹5,20,000.00\nActual collection: ₹5,19,750.00\nShortage: ₹250.00\nClosing tank stock:\nMS T-1: 8,240 L measured · 8,250 L book', ownerName: 'Owner', stationName: 'Station', date: '2026-11-20', appUrl: 'https://fuel.mindvector.tech' });
 expect(result.html).toContain('20 November 2026'); expect(result.html).toContain('WHAT TO REVIEW'); expect(result.html).toContain('Customer dues and staff handovers remain separate');
 for (const value of ['2,345.123 L', '1,234.567 L', '₹5,20,000.00', '₹5,19,750.00', '₹250.00', '8,240 L measured · 8,250 L book']) expect(result.html).toContain(value);
 expect(result.html).toContain('#fff6e5'); expect(result.html).toContain('max-width:480px'); expect(result.html).toContain('role="presentation"');
});


it('never sends a prepared welcome from the automatic worker', async () => {
 mock.findMany.mockResolvedValue([job()]); const sender = vi.fn(); vi.stubGlobal('fetch', sender);
 await drainEmailQueue();
 expect(sender).not.toHaveBeenCalled();
 expect(mock.findMany.mock.calls[0][0].where.type).toEqual({ not: 'OWNER_WELCOME' });
 expect(mock.updateMany).toHaveBeenCalledTimes(1); // only expired-lease recovery
});
it('does not queue business messages before welcome acceptance for the exact recipient', async () => {
 mock.findFirst.mockResolvedValue(null);
 await queueOwnerEmail({ organizationId: 'org-a', type: 'LOW_STOCK', eventKey: 'episode', recordType: 'TANK', message: 'Stock', guard: {} });
 expect(mock.createMany).not.toHaveBeenCalled();
 expect(mock.findFirst.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-a', ownerId: 'owner-a', destination: 'owner@example.com', type: 'OWNER_WELCOME', status: 'ACCEPTED', acceptedAt: { not: null } });
});
it('holds previously queued alerts without sending or consuming an attempt until welcome acceptance', async () => {
 mock.findFirst.mockResolvedValue(null); mock.findMany.mockResolvedValue([{ ...job(), type: 'LOW_STOCK' }]);
 const sender = vi.fn(); vi.stubGlobal('fetch', sender); await drainEmailQueue();
 expect(sender).not.toHaveBeenCalled();
 expect(mock.updateMany.mock.calls.at(-1)?.[0].data).toEqual({ nextAttemptAt: expect.any(Date) });
});

it('does not replay shifts or receipts from before welcome activation', async () => {
 for (const type of ['SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY'] as const) {
  await queueOwnerEmail({ organizationId: 'org-a', type, eventKey: 'old-event', recordType: 'RECEIPT', message: 'Past record', guard: { eventAt: '2025-12-31T12:00:00Z' } });
 }
 expect(mock.createMany).not.toHaveBeenCalled();
});
it('starts scheduled summaries from the next scheduled time rather than sending a late onboarding report', async () => {
 mock.findFirst.mockResolvedValue({ id: 'welcome', acceptedAt: new Date('2026-11-21T15:00:00Z') });
 mock.settings.mockResolvedValue({ ...settings, dailySummaryHour: 20 });
 await queueOwnerEmail({ organizationId: 'org-a', type: 'DAILY_SUMMARY', eventKey: 'today', recordType: 'CORE_DAILY_SUMMARY', message: 'Today', guard: { date: '2026-11-21' } });
 expect(mock.createMany).not.toHaveBeenCalled();
 await queueOwnerEmail({ organizationId: 'org-a', type: 'DAILY_SUMMARY', eventKey: 'tomorrow', recordType: 'CORE_DAILY_SUMMARY', message: 'Tomorrow', guard: { date: '2026-11-22' } });
 expect(mock.createMany).toHaveBeenCalledOnce();
});

it('allows welcome readiness for every current and future account without a pilot list',()=>{
 expect(emailDeliveryReady('org-a')).toBe(true);expect(emailDeliveryReady('mughal')).toBe(true);expect(emailDeliveryReady('future-org')).toBe(true);
 env.EMAIL_DELIVERY_ENABLED=false;expect(emailDeliveryReady('mughal')).toBe(false);
 env.EMAIL_DELIVERY_ENABLED=true;env.SMTP2GO_API_KEY=undefined;expect(emailDeliveryReady('future-org')).toBe(false);
});
it('permits an explicitly requested welcome for a new organization while automatic workers still cannot send it',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({data:{succeeded:1,failed:0,email_id:'new-org-email'}})});vi.stubGlobal('fetch',fetcher);
 mock.findMany.mockResolvedValue([{...job(),organizationId:'future-org'}]);
 await drainEmailQueue({organizationId:'future-org',deliveryId:'email-a',manualWelcome:true});
 expect(fetcher).toHaveBeenCalledOnce();
 expect(mock.findMany.mock.calls[0][0].where).toMatchObject({organizationId:'future-org',id:'email-a'});
});
