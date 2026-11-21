import { prisma } from '../../lib/prisma.js';
import { addIndiaDays, indiaDate } from '../../lib/india-time.js';
import { emailDeliveryReady, validOwnerEmail } from './email-queue.js';

export function emailPlanActive(organization: { lifetimeAccessPaidAt: Date | null; subscriptionActivatedAt: Date | null; subscriptionExpiresAt: Date | null } | null, now: Date) {
  return Boolean(organization && (organization.lifetimeAccessPaidAt || (organization.subscriptionActivatedAt && organization.subscriptionActivatedAt <= now && (!organization.subscriptionExpiresAt || organization.subscriptionExpiresAt > now))));
}
export function nextEmailSummary(hour: number, activatedAt: Date, now: Date) {
  let date = indiaDate(now);
  let at = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+05:30`);
  if (at <= now || at < activatedAt) { date = addIndiaDays(date, 1); at = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+05:30`); }
  return at.toISOString();
}
export async function readOwnerEmailState(organizationId: string, ownerId: string, now = new Date()) {
  const [owner, preference, organization, settings] = await Promise.all([
    prisma.user.findFirst({ where: { id: ownerId, organizationId, role: 'OWNER', active: true, loginEnabled: true }, select: { id: true, name: true, email: true } }),
    prisma.ownerEmailPreference.findFirst({ where: { ownerId, organizationId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.ownerNotificationSettings.findUnique({ where: { organizationId } }),
  ]);
  const destination = owner?.email.trim().toLowerCase() ?? '';
  const welcome = owner ? await prisma.ownerEmailDelivery.findFirst({ where: { organizationId, ownerId, destination, type: 'OWNER_WELCOME' }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, acceptedAt: true } }) : null;
  const accepted = welcome?.status === 'ACCEPTED' && welcome.acceptedAt;
  const available = emailDeliveryReady(organizationId);
  const subscribed = emailPlanActive(organization, now);
  const state = !preference?.enabled ? 'OFF' : preference.adminPaused ? 'PAUSED' : !accepted ? 'SETUP' : !available || !subscribed || !owner || !validOwnerEmail(destination) ? 'PAUSED' : 'ACTIVE';
  return {
    state, destination, ownerName: owner?.name ?? '', consent: Boolean(preference?.enabled), adminPaused: Boolean(preference?.adminPaused),
    welcomeStatus: welcome?.status ?? null, welcomeId: welcome?.id ?? null, activatedAt: accepted || null,
    nextSummaryAt: state === 'ACTIVE' && settings?.dailySummaryEnabled ? nextEmailSummary(settings.dailySummaryHour, accepted as Date, now) : null,
    blocker: !owner || !validOwnerEmail(destination) ? 'Review the owner’s sign-in email.' : !preference?.enabled ? 'The owner must enable email updates in Settings.' : preference.adminPaused ? 'Email updates are paused by support.' : !available ? 'Enable this account in the email rollout and check the sending configuration.' : !accepted ? welcome?.status === 'UNKNOWN' ? 'Check SMTP2GO for the send outcome before attempting another welcome.' : welcome?.status === 'FAILED' ? 'The welcome was rejected. Review the message details, then retry the rejected email.' : welcome?.status === 'PROCESSING' ? 'The welcome is being sent. Refresh shortly to check the result.' : 'Preview and send the welcome email to start updates.' : !subscribed ? 'An active subscription is required for automated updates.' : null,
  };
}
