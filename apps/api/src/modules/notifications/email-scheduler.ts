import { hasActiveIntelligence } from '@fuelledger/shared';
import { prisma } from '../../lib/prisma.js';
import { addIndiaDays, indiaDate, indiaParts } from '../../lib/india-time.js';
import { DAILY_EMAIL_RECOVERY_DAYS } from './email-report-period.js';
import { logger } from '../../lib/logger.js';
import { drainAgentMessages } from './agent-dispatch.js';
import { emailDeliveryReady } from './email-queue.js';
import { notifyDailySummary, notifyOverdueCustomers, prepareEmailNotifications } from './service.js';

export async function enabledEmailOrganizations() {
  if (!emailDeliveryReady()) return [];
  const organizations = await prisma.organization.findMany({
    where: {
      ownerEmailPreferences: { some: { enabled: true, adminPaused: false, owner: { active: true, loginEnabled: true, role: 'OWNER' } } },
      ownerEmailDeliveries: { some: { type: 'OWNER_WELCOME', status: 'ACCEPTED', acceptedAt: { not: null } } },
    },
    select: { id: true, ownerEmailPreferences: { where: { enabled: true, adminPaused: false, owner: { active: true, loginEnabled: true, role: 'OWNER' } }, select: { ownerId: true, owner: { select: { email: true } } } },
      ownerEmailDeliveries: { where: { type: 'OWNER_WELCOME', status: 'ACCEPTED', acceptedAt: { not: null } }, select: { ownerId: true, destination: true } } },
  });
  return organizations.filter(organization => organization.ownerEmailPreferences.some(preference => organization.ownerEmailDeliveries.some(welcome => welcome.ownerId === preference.ownerId && welcome.destination === preference.owner.email.trim().toLowerCase()))).map(organization => organization.id);
}

/** Stable event identities protect retries and overlapping schedulers. Recover only
 * recent daily summaries; debt reports are always prepared from today's balances. */
export async function scheduleOwnerEmails(now = new Date()) {
  const ids = await enabledEmailOrganizations();
  const date = indiaDate(now);
  const result = { date, checkedOrganizations: 0, prepared: 0, failed: 0 };
  if (!ids.length) return result;
  const organizations = await prisma.organization.findMany({
    where: { id: { in: ids }, ownerEmailPreferences: { some: { enabled: true, adminPaused: false, owner: { active: true, loginEnabled: true, role: 'OWNER' } } } },
    select: { id: true, subscriptionActivatedAt: true, subscriptionExpiresAt: true, lifetimeAccessPaidAt: true,
      intelligenceEnabledAt: true, intelligenceExpiresAt: true, notificationSettings: { select: { dailySummaryEnabled: true, dailySummaryHour: true, overdueCustomerEnabled: true, creditReportHour: true } } },
  });
  const { hour } = indiaParts(now);
  for (const organization of organizations) {
    result.checkedOrganizations++;
    const active = organization.lifetimeAccessPaidAt || (organization.subscriptionActivatedAt && organization.subscriptionActivatedAt <= now && (!organization.subscriptionExpiresAt || organization.subscriptionExpiresAt > now));
    if (!active || !organization.notificationSettings) continue;
    const settings = organization.notificationSettings;
    // Bound each request. Already prepared reports need no repeated balance reads.
    const reports: Array<{ type: 'DAILY_SUMMARY' | 'OVERDUE_CUSTOMER'; date: string }> = [];
    if (settings.dailySummaryEnabled) {
      for (let days = DAILY_EMAIL_RECOVERY_DAYS; days >= 0; days--) {
        if (days === 0 && hour < settings.dailySummaryHour) continue;
        const reportDate = addIndiaDays(date, -days);
        const dueAt = new Date(`${reportDate}T${String(settings.dailySummaryHour).padStart(2, '0')}:00:00+05:30`);
        // Recovery must not invent entitlement before the paid plan began.
        const entitledAtDueTime = (organization.lifetimeAccessPaidAt && organization.lifetimeAccessPaidAt <= dueAt)
          || (organization.subscriptionActivatedAt && organization.subscriptionActivatedAt <= dueAt
            && (!organization.subscriptionExpiresAt || organization.subscriptionExpiresAt > dueAt));
        if (days === 0 || entitledAtDueTime) reports.push({ type: 'DAILY_SUMMARY', date: reportDate });
      }
    }
    if (hasActiveIntelligence(organization, now) && settings.overdueCustomerEnabled && hour >= settings.creditReportHour) reports.push({ type: 'OVERDUE_CUSTOMER', date });
    for (const { type, date: reportDate } of reports) {
      const eventKey = `${type === 'DAILY_SUMMARY' ? 'daily-summary' : 'overdue-customers'}:${organization.id}:${reportDate}`;
      const prepared = await prisma.ownerEmailDelivery.findFirst({ where: { organizationId: organization.id, type, eventKey }, select: { id: true, status: true, attempts: true, suppressionReason: true } });
      const recoverable = type === 'DAILY_SUMMARY' && prepared?.attempts === 0 && (prepared.status === 'PENDING' || (prepared.status === 'SUPPRESSED' && ['source_changed', 'message_expired'].includes(prepared.suppressionReason ?? '')));
      if (prepared && !recoverable) continue;
      try {
        await prepareEmailNotifications(() => type === 'DAILY_SUMMARY' ? notifyDailySummary(organization.id, reportDate, now) : notifyOverdueCustomers(organization.id, reportDate, now));
        result.prepared++;
      } catch (error) {
        result.failed++;
        logger.warn({ organizationId: organization.id, category: type, errorName: error instanceof Error ? error.name : 'EmailScheduleError' }, 'Owner email schedule failed');
      }
    }
  }
  return result;
}

export async function prepareAgentEmails() {
  const organizationIds = await enabledEmailOrganizations();
  if (!organizationIds.length) return { handled: 0, deferred: 0 };
  return prepareEmailNotifications(() => drainAgentMessages({ channel: 'EMAIL', organizationIds }));
}
