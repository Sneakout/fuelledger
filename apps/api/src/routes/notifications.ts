import { Router } from 'express';
import { ownerNotificationSettingsSchema } from '@fuelledger/shared';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { requireOwner } from '../lib/station-access.js';
import { authenticate } from '../middleware/authenticate.js';
import { getSettings, recentDeliveries, runScheduledNotifications, sendTestNotification, updateSettings } from '../modules/notifications/service.js';

export const notificationsRouter = Router();

notificationsRouter.get('/cron/daily', async (req, res) => {
  if (!env.CRON_SECRET || req.get('authorization') !== `Bearer ${env.CRON_SECRET}`) throw new AppError(401, 'CRON_UNAUTHORIZED', 'This scheduled task is not authorized.');
  res.json(await runScheduledNotifications());
});

notificationsRouter.use(authenticate);
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
