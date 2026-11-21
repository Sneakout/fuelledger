import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ organizations: vi.fn(), delivery: vi.fn(), daily: vi.fn(), credit: vi.fn(), agents: vi.fn(), ready: vi.fn(), context: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: { organization: { findMany: mock.organizations }, ownerEmailDelivery: { findFirst: mock.delivery } } }));
vi.mock('../src/modules/notifications/email-queue.js', () => ({ emailDeliveryReady: mock.ready }));
vi.mock('../src/modules/notifications/agent-dispatch.js', () => ({ drainAgentMessages: mock.agents }));
vi.mock('../src/modules/notifications/service.js', () => ({ prepareEmailNotifications: mock.context, notifyDailySummary: mock.daily, notifyOverdueCustomers: mock.credit }));
import { enabledEmailOrganizations, prepareAgentEmails, scheduleOwnerEmails } from '../src/modules/notifications/email-scheduler.js';
const organization = () => ({ ownerEmailPreferences:[{ownerId:'owner-a',owner:{email:'owner@example.com'}}],ownerEmailDeliveries:[{ownerId:'owner-a',destination:'owner@example.com'}],id: 'org-a', subscriptionActivatedAt: new Date('2026-01-01'), subscriptionExpiresAt: null, lifetimeAccessPaidAt: null, intelligenceEnabledAt: null, intelligenceExpiresAt: null,
 notificationSettings: { dailySummaryEnabled: true, dailySummaryHour: 20, overdueCustomerEnabled: true, creditReportHour: 20 } });
const after = new Date('2026-11-20T15:07:00Z'); // 20:37 IST
beforeEach(() => { vi.resetAllMocks(); mock.ready.mockReturnValue(true); mock.organizations.mockResolvedValue([organization()]); mock.delivery.mockResolvedValue(null); mock.context.mockImplementation(run => run()); });
it('discovers all current and future accounts after consent and exact-recipient welcome acceptance', async () => {
 expect(await enabledEmailOrganizations()).toEqual(['org-a']); await scheduleOwnerEmails(after);
 expect(mock.organizations.mock.calls[0][0].where).toMatchObject({ ownerEmailPreferences: { some: { enabled: true, adminPaused:false, owner: { active: true, loginEnabled: true, role: 'OWNER' } } },ownerEmailDeliveries:{some:{type:'OWNER_WELCOME',status:'ACCEPTED',acceptedAt:{not:null}}} });
 expect(mock.organizations.mock.calls[0][0].where.id).toBeUndefined();
 expect(mock.daily).toHaveBeenCalledWith('org-a', '2026-11-20', after); expect(mock.credit).not.toHaveBeenCalled();
 mock.organizations.mockResolvedValue([{...organization(),id:'future-org'}]);
 expect(await enabledEmailOrganizations()).toEqual(['future-org']);
});
it('does not start automation for a prepared welcome, a different owner or an old email address',async()=>{
 for(const ownerEmailDeliveries of [[],[{ownerId:'other-owner',destination:'owner@example.com'}],[{ownerId:'owner-a',destination:'old@example.com'}]]) {
  mock.organizations.mockResolvedValue([{...organization(),ownerEmailDeliveries}]);
  await scheduleOwnerEmails(after);await prepareAgentEmails();
 }
 expect(mock.daily).not.toHaveBeenCalled();expect(mock.agents).not.toHaveBeenCalled();
});
it('catches up within the India business day and does not prepare before the selected hour', async () => {
 await scheduleOwnerEmails(new Date('2026-11-20T14:29:00Z')); expect(mock.daily).not.toHaveBeenCalled();
 await scheduleOwnerEmails(after); expect(mock.daily).toHaveBeenCalledTimes(1);
 await scheduleOwnerEmails(new Date('2026-11-20T18:31:00Z')); // next day 00:01 IST
 expect(mock.daily).toHaveBeenCalledTimes(1);
});
it('does not reread balances for an already prepared daily report, including accepted or suppressed reports', async () => {
 mock.delivery.mockResolvedValue({ id: 'existing' }); await scheduleOwnerEmails(after);
 expect(mock.delivery.mock.calls[0][0].where).toMatchObject({ type: 'DAILY_SUMMARY', eventKey: 'daily-summary:org-a:2026-11-20' }); expect(mock.daily).not.toHaveBeenCalled();
});
it('gives Intelligence email subscribers the daily summary and due credit report', async () => {
 mock.organizations.mockResolvedValue([{ ...organization(), intelligenceEnabledAt: new Date('2026-01-01') }]);
 await scheduleOwnerEmails(after); expect(mock.daily).toHaveBeenCalledOnce(); expect(mock.credit).toHaveBeenCalledWith('org-a', '2026-11-20', after);
});
it('respects expiry, future activation and disabled categories', async () => {
 for (const change of [{ subscriptionExpiresAt: new Date('2026-11-19') }, { subscriptionActivatedAt: new Date('2026-11-21') }, { notificationSettings: { ...organization().notificationSettings, dailySummaryEnabled: false, overdueCustomerEnabled: false } }]) {
 mock.organizations.mockResolvedValue([{ ...organization(), ...change }]); await scheduleOwnerEmails(after);
 }
 expect(mock.daily).not.toHaveBeenCalled(); expect(mock.credit).not.toHaveBeenCalled();
});
it('pauses all stages when delivery is disabled and isolates email dispatch', async () => {
 mock.ready.mockReturnValue(false); await scheduleOwnerEmails(after); expect(mock.organizations).not.toHaveBeenCalled();
 mock.ready.mockReturnValue(true); await prepareAgentEmails();
 expect(mock.agents).toHaveBeenCalledWith({ channel: 'EMAIL', organizationIds: ['org-a'] }); expect(mock.context).toHaveBeenCalledOnce();
});
it('reports preparation failures while continuing the other categories', async () => {
 mock.organizations.mockResolvedValue([{ ...organization(), intelligenceEnabledAt: new Date('2026-01-01') }]); mock.daily.mockRejectedValue(new Error('source unavailable'));
 expect(await scheduleOwnerEmails(after)).toMatchObject({ failed: 1, prepared: 1 }); expect(mock.credit).toHaveBeenCalledOnce();
});
