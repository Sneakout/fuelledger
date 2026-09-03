import type { OwnerNotificationSettingsInput } from '@fuelledger/shared';
import { OwnerNotificationType, Prisma } from '@prisma/client';
import { env, whatsappConfigured } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { buildReport } from '../reports/service.js';

type DeliveryResult = { status: 'SENT' | 'FAILED' | 'SKIPPED'; reason?: string };
const indiaTimeZone = 'Asia/Kolkata';
const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const defaults = {
  whatsappNumber: null as string | null,
  whatsappOptedIn: false,
  densityMissingEnabled: true,
  lowStockEnabled: true,
  shiftVarianceEnabled: true,
  unclosedShiftEnabled: true,
  dailySummaryEnabled: true,
  overdueCustomerEnabled: true,
  lowStockPercent: 20,
  varianceThreshold: 500,
  dailySummaryHour: 20,
};
type NotificationSettingFields = Omit<typeof defaults, 'varianceThreshold'> & { varianceThreshold: unknown };

function indiaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: indiaTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}
function indiaDate(date = new Date()) { const value = indiaParts(date); return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`; }
function indiaDayStart(date = new Date()) { return new Date(`${indiaDate(date)}T00:00:00+05:30`); }
function featureEnabled(settings: typeof defaults, type: OwnerNotificationType) {
  return type === 'DENSITY_MISSING' ? settings.densityMissingEnabled
    : type === 'LOW_STOCK' ? settings.lowStockEnabled
    : type === 'SHIFT_VARIANCE' ? settings.shiftVarianceEnabled
    : type === 'SHIFT_OPEN' ? settings.unclosedShiftEnabled
    : type === 'DAILY_SUMMARY' ? settings.dailySummaryEnabled
    : type === 'OVERDUE_CUSTOMER' ? settings.overdueCustomerEnabled
    : true;
}
function presentSettings(settings: (NotificationSettingFields & { id?: string; updatedAt?: Date }) | null) {
  const value = settings ?? defaults;
  return { ...value, varianceThreshold: Number(value.varianceThreshold), providerReady: whatsappConfigured };
}

export async function getSettings(organizationId: string) {
  return presentSettings(await prisma.ownerNotificationSettings.findUnique({ where: { organizationId } }));
}

export async function updateSettings(organizationId: string, input: OwnerNotificationSettingsInput) {
  const data = {
    whatsappNumber: input.whatsappNumber || null,
    whatsappOptedIn: input.whatsappOptedIn,
    densityMissingEnabled: input.densityMissingEnabled,
    lowStockEnabled: input.lowStockEnabled,
    shiftVarianceEnabled: input.shiftVarianceEnabled,
    unclosedShiftEnabled: input.unclosedShiftEnabled,
    dailySummaryEnabled: input.dailySummaryEnabled,
    overdueCustomerEnabled: input.overdueCustomerEnabled,
    lowStockPercent: input.lowStockPercent,
    varianceThreshold: new Prisma.Decimal(input.varianceThreshold),
    dailySummaryHour: input.dailySummaryHour,
  };
  const settings = await prisma.ownerNotificationSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return presentSettings(settings);
}

export async function recentDeliveries(organizationId: string) {
  return prisma.ownerNotificationDelivery.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, type: true, station: { select: { name: true, code: true } }, destination: true, message: true, status: true, errorMessage: true, sentAt: true, createdAt: true } });
}

async function sendTemplate(destination: string, message: string) {
  const response = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destination, type: 'template', template: { name: env.WHATSAPP_TEMPLATE_NAME, language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE }, components: [{ type: 'body', parameters: [{ type: 'text', text: message }] }] } }),
  });
  const body = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `WhatsApp API returned ${response.status}.`);
  return body?.messages?.[0]?.id ?? null;
}

export async function sendOwnerNotification(input: { organizationId: string; stationId?: string; type: OwnerNotificationType; dedupeKey: string; message: string }): Promise<DeliveryResult> {
  const existing = await prisma.ownerNotificationDelivery.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { status: true } });
  if (existing) return { status: existing.status === 'SENT' ? 'SENT' : 'SKIPPED', reason: 'already_processed' };
  const raw = await prisma.ownerNotificationSettings.findUnique({ where: { organizationId: input.organizationId } });
  const settings = raw ? { ...raw, varianceThreshold: Number(raw.varianceThreshold) } : defaults;
  if (!settings.whatsappOptedIn || !settings.whatsappNumber) return { status: 'SKIPPED', reason: 'owner_not_opted_in' };
  if (!featureEnabled(settings, input.type)) return { status: 'SKIPPED', reason: 'disabled_by_owner' };
  if (!whatsappConfigured) return { status: 'SKIPPED', reason: 'whatsapp_not_configured' };
  let delivery;
  try {
    delivery = await prisma.ownerNotificationDelivery.create({ data: { organizationId: input.organizationId, stationId: input.stationId ?? null, type: input.type, dedupeKey: input.dedupeKey, destination: settings.whatsappNumber, message: input.message } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 'SKIPPED', reason: 'already_processed' };
    throw error;
  }
  try {
    const providerMessageId = await sendTemplate(settings.whatsappNumber, input.message);
    await prisma.ownerNotificationDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', providerMessageId, sentAt: new Date() } });
    return { status: 'SENT' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message.slice(0, 500) : 'WhatsApp delivery failed.';
    logger.warn({ organizationId: input.organizationId, type: input.type, error: errorMessage }, 'WhatsApp notification delivery failed');
    await prisma.ownerNotificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', errorMessage } });
    return { status: 'FAILED', reason: errorMessage };
  }
}

export async function sendTestNotification(organizationId: string) {
  const settings = await getSettings(organizationId);
  if (!settings.whatsappOptedIn || !settings.whatsappNumber) throw new AppError(400, 'WHATSAPP_OPT_IN_REQUIRED', 'Save an opted-in WhatsApp number before sending a test.');
  if (!settings.providerReady) throw new AppError(503, 'WHATSAPP_NOT_CONFIGURED', 'WhatsApp delivery is not configured yet.');
  return sendOwnerNotification({ organizationId, type: 'SYSTEM_TEST', dedupeKey: `test:${organizationId}:${Date.now()}`, message: `FuelLedger test message\n\nWhatsApp alerts are connected for ${indiaDate()}. You will receive only the alerts you enable in FuelLedger.\n\nOpen FuelLedger: ${env.APP_URL}` });
}

export async function notifyShiftVariance(organizationId: string, shift: { id: string; station: { id: string; name: string }; shiftNumber: number; totals: { variance: number } | null }) {
  const variance = Math.abs(shift.totals?.variance ?? 0);
  const settings = await getSettings(organizationId);
  if (variance < settings.varianceThreshold) return { status: 'SKIPPED' as const, reason: 'below_threshold' };
  return sendOwnerNotification({ organizationId, stationId: shift.station.id, type: 'SHIFT_VARIANCE', dedupeKey: `shift-variance:${shift.id}`, message: `FuelLedger alert\n\n${shift.station.name}, Shift #${shift.shiftNumber} has a collection variance of ${money(variance)}.\n\nPlease review and reconcile it: ${env.APP_URL}/reconciliation` });
}

export async function notifyLowStock(organizationId: string, tankId: string) {
  const tank = await prisma.tank.findFirst({ where: { id: tankId, status: 'ACTIVE', configuration: { active: true, station: { organizationId } } }, include: { product: { select: { name: true, code: true } }, configuration: { include: { station: { select: { id: true, name: true } } } }, inventoryLedger: { select: { quantityDelta: true } } } });
  if (!tank) return { status: 'SKIPPED' as const, reason: 'tank_not_found' };
  const stock = Number(tank.openingStock) + tank.inventoryLedger.reduce((total, entry) => total + Number(entry.quantityDelta), 0);
  const fillPercent = Number(tank.workingCapacity) ? Math.max(0, stock / Number(tank.workingCapacity) * 100) : 0;
  const settings = await getSettings(organizationId);
  if (fillPercent > settings.lowStockPercent) return { status: 'SKIPPED' as const, reason: 'stock_healthy' };
  const date = indiaDate();
  return sendOwnerNotification({ organizationId, stationId: tank.configuration.station.id, type: 'LOW_STOCK', dedupeKey: `low-stock:${tank.id}:${date}`, message: `FuelLedger stock alert\n\n${tank.configuration.station.name}: ${tank.product.code} tank ${tank.code} is at ${fillPercent.toFixed(1)}% (${Math.max(0, stock).toLocaleString('en-IN')} L).\n\nReview inventory: ${env.APP_URL}/inventory` });
}

export async function runScheduledNotifications(now = new Date()) {
  const { hour } = indiaParts(now);
  const date = indiaDate(now);
  const settings = await prisma.ownerNotificationSettings.findMany({ where: { whatsappOptedIn: true, whatsappNumber: { not: null } }, select: { organizationId: true, dailySummaryHour: true } });
  const results: DeliveryResult[] = [];
  for (const setting of settings) {
    if (hour === 9) results.push(await notifyMissingDensity(setting.organizationId, date, now));
    if (hour === 23) results.push(await notifyUnclosedShifts(setting.organizationId, date));
    if (hour === setting.dailySummaryHour) {
      results.push(await notifyDailySummary(setting.organizationId, date));
      results.push(await notifyOverdueCustomers(setting.organizationId, date));
    }
  }
  return { date, checkedOrganizations: settings.length, sent: results.filter(result => result.status === 'SENT').length, failed: results.filter(result => result.status === 'FAILED').length, skipped: results.filter(result => result.status === 'SKIPPED').length };
}

async function notifyMissingDensity(organizationId: string, date: string, now: Date) {
  const tanks = await prisma.tank.findMany({ where: { status: 'ACTIVE', product: { category: 'FUEL' }, configuration: { active: true, station: { organizationId } }, densityReadings: { none: { recordedAt: { gte: indiaDayStart(now) } } } }, include: { product: { select: { code: true } }, configuration: { include: { station: { select: { id: true, name: true } } } } } });
  if (!tanks.length) return { status: 'SKIPPED' as const, reason: 'all_density_recorded' };
  const examples = tanks.slice(0, 3).map(tank => `${tank.configuration.station.name} · ${tank.product.code} ${tank.code}`).join(', ');
  return sendOwnerNotification({ organizationId, type: 'DENSITY_MISSING', dedupeKey: `density-missing:${organizationId}:${date}`, message: `FuelLedger morning check\n\nDensity has not been entered for ${tanks.length} fuel tank${tanks.length === 1 ? '' : 's'} today.\n${examples}${tanks.length > 3 ? '…' : ''}\n\nOpen FuelLedger: ${env.APP_URL}/inventory` });
}

async function notifyUnclosedShifts(organizationId: string, date: string) {
  const shifts = await prisma.shift.findMany({ where: { status: 'OPEN', station: { organizationId } }, select: { id: true, shiftNumber: true, station: { select: { id: true, name: true } } } });
  if (!shifts.length) return { status: 'SKIPPED' as const, reason: 'no_open_shifts' };
  const examples = shifts.slice(0, 3).map(shift => `${shift.station.name} · Shift #${shift.shiftNumber}`).join(', ');
  return sendOwnerNotification({ organizationId, type: 'SHIFT_OPEN', dedupeKey: `open-shifts:${organizationId}:${date}`, message: `FuelLedger closing check\n\n${shifts.length} shift${shifts.length === 1 ? ' is' : 's are'} still open: ${examples}${shifts.length > 3 ? '…' : ''}\n\nPlease close or review: ${env.APP_URL}/operations` });
}

async function notifyDailySummary(organizationId: string, date: string) {
  const report = await buildReport(organizationId, { startDate: date, endDate: date });
  return sendOwnerNotification({ organizationId, type: 'DAILY_SUMMARY', dedupeKey: `daily-summary:${organizationId}:${date}`, message: `FuelLedger daily summary — ${date}\n\nSales: ${money(report.summary.grossSales)} (${report.summary.transactions} transactions)\nFuel sold: ${Math.round(report.summary.meteredVolume).toLocaleString('en-IN')} L\nExpenses: ${money(report.summary.expenses)}\nNet result: ${money(report.summary.netProfit)}\n\nView reports: ${env.APP_URL}/reports` });
}

async function notifyOverdueCustomers(organizationId: string, date: string) {
  const report = await buildReport(organizationId, { startDate: date, endDate: date });
  const overdue = report.customers.map(customer => ({ ...customer, overdue: customer.ageing.days1to30 + customer.ageing.days31to60 + customer.ageing.days61to90 + customer.ageing.days90plus })).filter(customer => customer.overdue > 0.005);
  if (!overdue.length) return { status: 'SKIPPED' as const, reason: 'no_overdue_customers' };
  const total = overdue.reduce((sum, customer) => sum + customer.overdue, 0);
  const examples = overdue.slice(0, 3).map(customer => customer.customer).join(', ');
  return sendOwnerNotification({ organizationId, type: 'OVERDUE_CUSTOMER', dedupeKey: `overdue-customers:${organizationId}:${date}`, message: `FuelLedger receivables alert\n\n${overdue.length} customer${overdue.length === 1 ? '' : 's'} have overdue payments totalling ${money(total)}.\n${examples}${overdue.length > 3 ? '…' : ''}\n\nReview customers: ${env.APP_URL}/customers` });
}
