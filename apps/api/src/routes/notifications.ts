import { readOwnerEmailState } from '../modules/notifications/email-owner-state.js';
import { prepareAgentEmails, scheduleOwnerEmails } from '../modules/notifications/email-scheduler.js';
import { drainEmailQueue } from '../modules/notifications/email-queue.js';
import { Router } from 'express';
import { hasActiveIntelligence, ownerNotificationSettingsSchema } from '@fuelledger/shared';
import { indiaParts } from '../lib/india-time.js';
import { scheduleCustomerReminders } from '../modules/notifications/customer-reminders.js';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { assertStationAccess, permittedStationIds, requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { drainReviewJobs, scheduleDailyReviews } from '../modules/nerve/review-worker.js';
import { drainAgentMessages } from '../modules/notifications/agent-dispatch.js';
import { readRollout } from '../modules/notifications/whatsapp-rollout.js';
import { drainWhatsAppQueue } from '../modules/notifications/delivery-queue.js';
import { listAlerts, markAlert, notifyMarketPriceOutlook, registerPushDevice, runScheduledNotifications, unregisterPushDevice, getSettings, recentDeliveries, sendTestNotification, updateSettings } from '../modules/notifications/service.js';

export const notificationsRouter = Router();

notificationsRouter.get('/cron/email-schedule', async (req, res) => {
  if (!env.EMAIL_CRON_SECRET || req.get('authorization') !== `Bearer ${env.EMAIL_CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  const result = await scheduleOwnerEmails();
  res.status(result.failed ? 503 : 200).json(result);
});

notificationsRouter.get('/cron/email-agent-messages', async (req, res) => {
  if (!env.EMAIL_CRON_SECRET || req.get('authorization') !== `Bearer ${env.EMAIL_CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  res.json(await prepareAgentEmails());
});

notificationsRouter.get('/cron/email-delivery', async (req, res) => {
  if (!env.EMAIL_CRON_SECRET || req.get('authorization') !== `Bearer ${env.EMAIL_CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  res.json(await drainEmailQueue());
});

notificationsRouter.get('/cron/whatsapp-delivery', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  res.json(await drainWhatsAppQueue());
});

notificationsRouter.get('/cron/agent-messages', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  res.json(await drainAgentMessages());
});

notificationsRouter.get('/cron/agent-reviews', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  const queued = await scheduleDailyReviews();
  res.json({ queued, ...await drainReviewJobs() });
});

notificationsRouter.get('/cron/daily', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  const now = new Date();
  const result = await runScheduledNotifications(now);
  res.json({ ...result, customerRemindersQueued: await scheduleCustomerReminders(indiaParts(now).hour, now) });
});

const marketOutlookSchema = z.object({
  organizationId: z.string().cuid(),
  stationId: z.string().cuid(),
  signalId: z.string().trim().min(1).max(120),
  observedAt: z.iso.datetime(),
  rationale: z.string().trim().min(20).max(500),
});
notificationsRouter.post('/cron/market-outlook', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This market outlook is not authorized.');
  const parsed = marketOutlookSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'MARKET_OUTLOOK_INVALID', 'Review the market outlook details.', parsed.error.flatten());
  res.json(await notifyMarketPriceOutlook({ ...parsed.data, observedAt: new Date(parsed.data.observedAt) }));
});

notificationsRouter.use(authenticate);
notificationsRouter.get('/alerts', async (req, res) => {
  requireOwner(req.user!);
  const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : undefined;
  if (stationId) assertStationAccess(req.user!, stationId);
  res.json({ alerts: await listAlerts(req.user!.organization.id, permittedStationIds(req.user!), stationId) });
});
notificationsRouter.post('/alerts/:id/read', async (req, res) => {
  requireOwner(req.user!);
  res.json({ alert: await markAlert(req.user!.organization.id, req.user!.id, req.params.id, 'read', permittedStationIds(req.user!)) });
});
notificationsRouter.post('/alerts/:id/acknowledge', async (req, res) => {
  requireOwner(req.user!);
  res.json({ alert: await markAlert(req.user!.organization.id, req.user!.id, req.params.id, 'acknowledge', permittedStationIds(req.user!)) });
});
const deviceSchema = z.object({ token: z.string().regex(/^[a-fA-F0-9]{32,}$/), environment: z.enum(['DEVELOPMENT', 'PRODUCTION']).default('PRODUCTION') });
notificationsRouter.post('/devices', async (req, res) => {
  requireOwner(req.user!);
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'PUSH_DEVICE_INVALID', 'This device could not be registered for alerts.');
  res.status(201).json({ device: await registerPushDevice(req.user!.organization.id, req.user!.id, parsed.data.token.toLowerCase(), parsed.data.environment) });
});
notificationsRouter.delete('/devices', async (req, res) => {
  requireOwner(req.user!);
  const parsed = deviceSchema.pick({ token: true }).safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'PUSH_DEVICE_INVALID', 'This device could not be removed from alerts.');
  await unregisterPushDevice(req.user!.organization.id, req.user!.id, parsed.data.token.toLowerCase());
  res.status(204).send();
});
notificationsRouter.get('/email-status', async (req, res) => {
  requireOwner(req.user!);
  const email = await readOwnerEmailState(req.user!.organization.id, req.user!.id);
  res.json({ emailStatus: { state: email.state, activatedAt: email.activatedAt, nextSummaryAt: email.nextSummaryAt } });
});

notificationsRouter.get('/', async (req, res) => {
  const user = req.user!;
  requireOwner(user);
  const [settings, deliveries, organization, policy, emailPreference] = await Promise.all([
    getSettings(user.organization.id), recentDeliveries(user.organization.id, permittedStationIds(user)),
    prisma.organization.findUnique({ where: { id: user.organization.id } }), readRollout(),
    prisma.ownerEmailPreference.findFirst({ where: { ownerId: user.id, organizationId: user.organization.id, enabled: true } }),
  ]);
  const deliveryAvailable = settings.providerReady && policy.stage !== 'SHADOW' && !policy.paused
    && policy.organizationIds.includes(user.organization.id) && policy.enabledCategories.length > 0;
  const email = await readOwnerEmailState(user.organization.id, user.id);
  res.json({ emailStatus: { state: email.state, activatedAt: email.activatedAt, nextSummaryAt: email.nextSummaryAt }, settings: { ...settings, emailEnabled: Boolean(emailPreference) }, deliveries, emailAddress: user.email, intelligenceActive: hasActiveIntelligence(organization),
    deliveryAvailable, testAvailable: deliveryAvailable && policy.enabledCategories.includes('SYSTEM_TEST') });
});

notificationsRouter.put('/', async (req, res) => {
  const user = req.user!;
  requireOwner(user);
  const parsed = ownerNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'NOTIFICATION_SETTINGS_INVALID', parsed.error.issues[0]?.message ?? 'Review your WhatsApp preferences.');
  if (parsed.data.customerReminderScheduled && !hasActiveIntelligence(await prisma.organization.findUnique({ where: { id: user.organization.id } }))) {
    throw new AppError(403, 'INTELLIGENCE_REQUIRED', 'Scheduled reminders are included with Core + Intelligence.');
  }
  const current = await getSettings(user.organization.id);
  if (parsed.data.whatsappNumber !== (current.whatsappNumber ?? '') && parsed.data.whatsappOptedIn && req.body.confirmNewNumber !== true) {
    throw new AppError(400, 'OWNER_CONSENT_REQUIRED', 'Confirm consent for the new WhatsApp number.');
  }
  const settings = await updateSettings(user.organization.id, parsed.data, user.name, user.id);
  const email = await readOwnerEmailState(user.organization.id, user.id);
  res.json({ settings, emailStatus: { state: email.state, activatedAt: email.activatedAt, nextSummaryAt: email.nextSummaryAt } });
});

notificationsRouter.post('/test', async (req, res) => {
  requireOwner(req.user!);
  res.json({ delivery: await sendTestNotification(req.user!.organization.id) });
});
