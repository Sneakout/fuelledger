import { hasActiveIntelligence } from '@fuelledger/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { indiaDate, indiaParts } from '../../lib/india-time.js';
import { logger } from '../../lib/logger.js';
import { drainAgentMessages } from './agent-dispatch.js';
import { emailDeliveryReady } from './email-queue.js';
import { notifyDailySummary, notifyOverdueCustomers, prepareEmailNotifications } from './service.js';

export function enabledEmailOrganizations() {
  return [...new Set(env.EMAIL_ROLLOUT_ORGANIZATION_IDS.split(',').map(id => id.trim()).filter(id => id && emailDeliveryReady(id)))];
}

/** Queue only today's due reports. Stable event identities make repeated ticks safe.
 * Catch up within the day when the scheduler is late; never replay past daily reports.
 */
export async function scheduleOwnerEmails(now = new Date()) {
  const ids = enabledEmailOrganizations();
  const date = indiaDate(now);
  const result = { date, checkedOrganizations: 0, prepared: 0, failed: 0 };
  if (!ids.length) return result;
  const organizations = await prisma.organization.findMany({
    where: { id: { in: ids }, ownerEmailPreferences: { some: { enabled: true, owner: { active: true, loginEnabled: true, role: 'OWNER' } } } },
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
    const reportTypes = [
      ...(settings.dailySummaryEnabled && hour >= settings.dailySummaryHour ? ['DAILY_SUMMARY' as const] : []),
      ...(hasActiveIntelligence(organization, now) && settings.overdueCustomerEnabled && hour >= settings.creditReportHour ? ['OVERDUE_CUSTOMER' as const] : []),
    ];
    for (const type of reportTypes) {
      const eventKey = `${type === 'DAILY_SUMMARY' ? 'daily-summary' : 'overdue-customers'}:${organization.id}:${date}`;
      const prepared = await prisma.ownerEmailDelivery.findFirst({ where: { organizationId: organization.id, type, eventKey }, select: { id: true } });
      if (prepared) continue;
      try {
        await prepareEmailNotifications(() => type === 'DAILY_SUMMARY' ? notifyDailySummary(organization.id, date, now) : notifyOverdueCustomers(organization.id, date, now));
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
  const organizationIds = enabledEmailOrganizations();
  return prepareEmailNotifications(() => drainAgentMessages({ channel: 'EMAIL', organizationIds }));
}
