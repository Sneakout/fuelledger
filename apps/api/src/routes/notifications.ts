import { Router } from 'express';
import { ownerNotificationSettingsSchema } from '@fuelledger/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { assertStationAccess, permittedStationIds, requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { getSettings, listAlerts, markAlert, notifyMarketPriceOutlook, recentDeliveries, registerPushDevice, runScheduledNotifications, sendTestNotification, unregisterPushDevice, updateSettings } from '../modules/notifications/service.js';

export const notificationsRouter = Router();

notificationsRouter.get('/cron/daily', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  res.json(await runScheduledNotifications());
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
notificationsRouter.get('/', async (req, res) => {
  requireOwner(req.user!);
  const [settings, deliveries] = await Promise.all([getSettings(req.user!.organization.id), recentDeliveries(req.user!.organization.id)]);
  res.json({ settings, deliveries });
});
notificationsRouter.put('/', async (req, res) => {
  requireOwner(req.user!);
  const parsed = ownerNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'NOTIFICATION_SETTINGS_INVALID', 'Please review the WhatsApp alert settings.', parsed.error.flatten());
  res.json({ settings: await updateSettings(req.user!.organization.id, parsed.data) });
});
notificationsRouter.post('/test', async (req, res) => {
  requireOwner(req.user!);
  res.json({ delivery: await sendTestNotification(req.user!.organization.id) });
});
