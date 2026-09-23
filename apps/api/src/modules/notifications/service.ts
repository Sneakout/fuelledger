import { ownerNotificationPacketSchema, type OwnerNotificationPacket, type OwnerNotificationSettingsInput } from '@fuelledger/shared';
import { OwnerNotificationType, Prisma } from '@prisma/client';
import { apnsConfigured, env, whatsappConfigured } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { bookStockAt } from '../../lib/stock.js';
import { buildReport } from '../reports/service.js';
import { dailyBriefing } from '../intelligence/daily-briefing.js';
import { sendApns } from './apns.js';
import { buildApprovalScenario, buildMissingRecordScenario, buildProfitScenario, buildShiftScenario, buildStockScenario } from './scenario-builders.js';

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
  stockVarianceTolerance: 50,
  dailySummaryHour: 20,
};
type NotificationSettingFields = Omit<typeof defaults, 'varianceThreshold' | 'stockVarianceTolerance'> & { varianceThreshold: unknown; stockVarianceTolerance: unknown };

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

const agentForType: Partial<Record<OwnerNotificationType, NonNullable<OwnerNotificationPacket['responsibleAgent']>>> = {
  DENSITY_MISSING: { key: 'inventory-watch', name: 'Stock Agent', responsibility: 'Tanks, readings, receipts and fuel movement' },
  LOW_STOCK: { key: 'inventory-watch', name: 'Stock Agent', responsibility: 'Tanks, readings, receipts and fuel movement' },
  SHIFT_VARIANCE: { key: 'reconciliation-review', name: 'Shift Agent', responsibility: 'Shifts, collections and handovers' },
  SHIFT_OPEN: { key: 'reconciliation-review', name: 'Shift Agent', responsibility: 'Shifts, collections and handovers' },
  APPROVAL_REQUIRED: { key: 'inventory-watch', name: 'Stock Agent', responsibility: 'Tanks, readings, receipts and fuel movement' },
  OVERDUE_CUSTOMER: { key: 'receivables-watch', name: 'Credit Agent', responsibility: 'Customer balances, ageing and payment follow-up' },
  DAILY_SUMMARY: { key: 'profit-insight', name: 'Profit Agent', responsibility: 'Margin, costs and financial changes' },
};
const purchaseAgent = { key: 'purchase-check', name: 'Purchase Agent', responsibility: 'Supplier invoices, rates, quantities and receipts' } as const;
const nerveAssistant = { key: 'owner-assistant', name: 'Nerve Assistant', responsibility: 'Coordinates questions across FuelNerve specialists' } as const;
function responsibleAgent(type: OwnerNotificationType, recordType: string) {
  if (recordType === 'DAILY_BRIEFING') return nerveAssistant;
  if (recordType === 'PURCHASE_INVOICE' || recordType === 'SUPPLIER_PAYABLE' || recordType === 'PURCHASE_RECEIPT' || recordType === 'PRODUCT_PRICE_CHANGE_REQUEST' || recordType === 'MARKET_PRICE_OUTLOOK') return purchaseAgent;
  return agentForType[type] ?? null;
}
function presentSettings(settings: (NotificationSettingFields & { id?: string; updatedAt?: Date }) | null) {
  const value = settings ?? defaults;
  return { ...value, varianceThreshold: Number(value.varianceThreshold), stockVarianceTolerance: Number(value.stockVarianceTolerance), providerReady: whatsappConfigured };
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
    stockVarianceTolerance: new Prisma.Decimal(input.stockVarianceTolerance),
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

type BaseNotificationPacket = Omit<OwnerNotificationPacket, 'schemaVersion' | 'responsibleAgent'>;
type AlertInput = { organizationId: string; stationId?: string; type: OwnerNotificationType; dedupeKey: string; title?: (packet: OwnerNotificationPacket) => string; message: (packet: OwnerNotificationPacket) => string; packet: BaseNotificationPacket; severity?: 'INFORMATION' | 'ATTENTION' | 'URGENT'; evidenceSourceType?: string; evidenceSourceId?: string };

function alertPresentation(input: AlertInput, packet: OwnerNotificationPacket, intelligenceActive = false) {
  const byType = {
    DENSITY_MISSING: ['Morning density is due', '/inventory'], LOW_STOCK: ['Fuel stock needs attention', '/inventory'],
    SHIFT_VARIANCE: ['Shift variance needs review', '/reconciliation'], SHIFT_OPEN: ['A shift is still open', '/operations'],
    APPROVAL_REQUIRED: ['An owner decision is waiting', '/inventory'],
    MARKET_PRICE_OUTLOOK: ['Plan ahead of a possible price rise', '/inventory'],
    DAILY_SUMMARY: ['Your daily owner briefing', '/reports'], OVERDUE_CUSTOMER: ['Customer balances need follow-up', '/customers'],
    SYSTEM_TEST: ['FuelNerve alert test', '/notifications'],
  } as const;
  const [title, path] = byType[input.type];
  const agent = intelligenceActive ? agentForType[input.type] : undefined;
  return { title: input.title?.(packet) ?? (agent ? agent.name + ': ' + title : title), path: packet.evidence[0]?.path ?? path, severity: input.severity ?? (input.type === 'DAILY_SUMMARY' || input.type === 'SYSTEM_TEST' ? 'INFORMATION' : 'ATTENTION') };
}

async function deliverPush(alert: { id: string; organizationId: string; type: OwnerNotificationType; title: string; message: string; evidencePath: string; evidenceSourceType: string | null; evidenceSourceId: string | null }) {
  if (!apnsConfigured) return;
  const devices = await prisma.ownerPushDevice.findMany({ where: { organizationId: alert.organizationId, active: true } });
  await Promise.all(devices.map(async device => {
    const delivery = await prisma.ownerPushDelivery.upsert({ where: { alertId_deviceId: { alertId: alert.id, deviceId: device.id } }, create: { organizationId: alert.organizationId, alertId: alert.id, deviceId: device.id }, update: {} });
    if (delivery.status === 'SENT') return;
    try {
      const providerMessageId = await sendApns(device.token, { title: alert.title, body: alert.message.replace(/https?:\/\/\S+/g, '').trim().slice(0, 180), path: alert.evidencePath, alertId: alert.id, type: alert.type, approvalId: alert.evidenceSourceType === 'APPROVAL_REQUEST' ? alert.evidenceSourceId : null }, device.environment);
      await prisma.ownerPushDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', providerMessageId, sentAt: new Date(), errorMessage: null } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.slice(0, 500) : 'Push delivery failed.';
      await prisma.ownerPushDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', errorMessage } });
      if (/BadDeviceToken|Unregistered/.test(errorMessage)) await prisma.ownerPushDevice.update({ where: { id: device.id }, data: { active: false } });
      logger.warn({ alertId: alert.id, deviceId: device.id, error: errorMessage }, 'APNs delivery failed');
    }
  }));
}

export async function sendOwnerNotification(input: AlertInput): Promise<DeliveryResult> {
  const [raw, organization] = await Promise.all([
    prisma.ownerNotificationSettings.findUnique({ where: { organizationId: input.organizationId } }),
    prisma.organization.findUnique({ where: { id: input.organizationId }, select: { intelligenceEnabledAt: true, intelligenceExpiresAt: true } }),
  ]);
  const settings = raw ? { ...raw, varianceThreshold: Number(raw.varianceThreshold), stockVarianceTolerance: Number(raw.stockVarianceTolerance) } : defaults;
  if (!featureEnabled(settings, input.type)) return { status: 'SKIPPED', reason: 'disabled_by_owner' };
  const now = new Date();
  const intelligenceActive = Boolean(organization?.intelligenceEnabledAt && (!organization.intelligenceExpiresAt || organization.intelligenceExpiresAt > now));
  const packet = ownerNotificationPacketSchema.parse({ schemaVersion: 1, ...input.packet, responsibleAgent: intelligenceActive ? responsibleAgent(input.type, input.packet.recordType) : null });
  const presentation = alertPresentation(input, packet, intelligenceActive);
  const message = input.message(packet);
  const alertMessage = message.replace(/\n*[^\n]*https?:\/\/\S+/g, '').trim();
  const primaryEvidence = packet.evidence[0]!;
  const alert = await prisma.ownerAlert.upsert({ where: { dedupeKey: input.dedupeKey }, create: { organizationId: input.organizationId, stationId: input.stationId ?? null, type: input.type, dedupeKey: input.dedupeKey, title: presentation.title, message: alertMessage, severity: presentation.severity, evidenceLabel: primaryEvidence.label, evidencePath: presentation.path, evidenceSourceType: input.evidenceSourceType ?? null, evidenceSourceId: input.evidenceSourceId ?? null, packet: packet as unknown as Prisma.InputJsonValue }, update: {} });
  await deliverPush(alert);
  if (!settings.whatsappOptedIn || !settings.whatsappNumber) return { status: 'SKIPPED', reason: 'owner_not_opted_in' };
  if (!whatsappConfigured) return { status: 'SKIPPED', reason: 'whatsapp_not_configured' };
  const existing = await prisma.ownerNotificationDelivery.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { status: true } });
  if (existing) return { status: existing.status === 'SENT' ? 'SENT' : 'SKIPPED', reason: 'already_processed' };
  let delivery;
  try {
    delivery = await prisma.ownerNotificationDelivery.create({ data: { organizationId: input.organizationId, stationId: input.stationId ?? null, type: input.type, dedupeKey: input.dedupeKey, destination: settings.whatsappNumber, message } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { status: 'SKIPPED', reason: 'already_processed' };
    throw error;
  }
  try {
    const providerMessageId = await sendTemplate(settings.whatsappNumber, message);
    await prisma.ownerNotificationDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', providerMessageId, sentAt: new Date() } });
    return { status: 'SENT' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message.slice(0, 500) : 'WhatsApp delivery failed.';
    logger.warn({ organizationId: input.organizationId, type: input.type, error: errorMessage }, 'WhatsApp notification delivery failed');
    await prisma.ownerNotificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', errorMessage } });
    return { status: 'FAILED', reason: errorMessage };
  }
}

export async function notifyApprovalRequired(input: {
  id: string;
  organizationId: string;
  stationId: string;
  stationName: string;
  productCode: string;
  tankCode?: string | null;
  quantityDelta: number;
  requesterName: string;
  requestedAt?: Date;
}) {
  const scenario = buildApprovalScenario({
    approvalId: input.id, requesterName: input.requesterName, requestedAt: input.requestedAt ?? new Date(),
    subjectName: input.productCode + (input.tankCode ? ` tank ${input.tankCode}` : ' stock'),
    product: { name: input.productCode, code: input.productCode }, quantityDelta: input.quantityDelta,
    exactAction: `an inventory adjustment for ${input.productCode}${input.tankCode ? ` tank ${input.tankCode}` : ''}`,
    station: { id: input.stationId, name: input.stationName },
    evidence: [{ label: 'Review inventory records', path: '/inventory', recordType: 'APPROVAL_REQUEST', recordId: input.id }],
  });
  return sendOwnerNotification({
    organizationId: input.organizationId,
    stationId: input.stationId,
    type: 'APPROVAL_REQUIRED',
    dedupeKey: 'approval-required:' + input.id,
    severity: 'ATTENTION',
    title: () => scenario.title, packet: scenario.facts, message: () => scenario.sentence,
    evidenceSourceType: 'APPROVAL_REQUEST',
    evidenceSourceId: input.id,
  });
}

export async function notifyProductPriceApprovalRequired(input: {
  id: string;
  organizationId: string;
  stationId: string;
  stationName: string;
  productName: string;
  productCode: string;
  previousPurchasePrice: number;
  proposedPurchasePrice: number;
  proposedSellingPrice: number;
  invoiceNumber: string;
  requesterName: string;
  requestedAt?: Date;
}) {
  const change = input.proposedPurchasePrice - input.previousPurchasePrice;
  const direction = change > 0 ? 'increased' : 'decreased';
  const scenario = buildApprovalScenario({
    approvalId: input.id,
    requesterName: input.requesterName,
    requestedAt: input.requestedAt ?? new Date(),
    subjectName: `${input.productCode} price change`,
    product: { name: input.productName, code: input.productCode },
    exactAction: `${input.productCode} purchase price ${direction} from ${money(input.previousPurchasePrice)} to ${money(input.proposedPurchasePrice)} per litre on invoice ${input.invoiceNumber}; review the proposed selling price of ${money(input.proposedSellingPrice)}`,
    recordType: 'PRODUCT_PRICE_CHANGE_REQUEST',
    station: { id: input.stationId, name: input.stationName },
    evidence: [{ label: 'Review supplier invoice', path: '/purchases', recordType: 'APPROVAL_REQUEST', recordId: input.id }],
  });
  return sendOwnerNotification({
    organizationId: input.organizationId,
    stationId: input.stationId,
    type: 'APPROVAL_REQUIRED',
    dedupeKey: `approval-required:${input.id}`,
    severity: 'ATTENTION',
    title: () => `${input.productCode} price changed — confirm selling price`,
    packet: scenario.facts,
    message: () => scenario.sentence,
    evidenceSourceType: 'APPROVAL_REQUEST',
    evidenceSourceId: input.id,
  });
}

export async function listAlerts(organizationId: string, stationIds: string[] | undefined, requestedStationId?: string) {
  return prisma.ownerAlert.findMany({ where: { organizationId, type: { not: 'APPROVAL_REQUIRED' }, ...(requestedStationId ? { stationId: requestedStationId } : stationIds ? { OR: [{ stationId: null }, { stationId: { in: stationIds } }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, type: true, severity: true, title: true, message: true, packet: true, evidenceLabel: true, evidencePath: true, evidenceSourceType: true, evidenceSourceId: true, readAt: true, acknowledgedAt: true, resolvedAt: true, createdAt: true, station: { select: { id: true, name: true, code: true } } } });
}

export async function markAlert(organizationId: string, userId: string, alertId: string, action: 'read' | 'acknowledge', stationIds?: string[]) {
  const alert = await prisma.ownerAlert.findFirst({ where: { id: alertId, organizationId, ...(stationIds ? { OR: [{ stationId: null }, { stationId: { in: stationIds } }] } : {}) }, select: { id: true } });
  if (!alert) throw new AppError(404, 'ALERT_NOT_FOUND', 'This alert is no longer available.');
  const now = new Date();
  return prisma.ownerAlert.update({ where: { id: alertId }, data: action === 'read' ? { readAt: now } : { readAt: now, acknowledgedAt: now, acknowledgedById: userId } });
}

export async function registerPushDevice(organizationId: string, userId: string, token: string, environment: 'DEVELOPMENT' | 'PRODUCTION') {
  return prisma.ownerPushDevice.upsert({ where: { token }, create: { organizationId, userId, token, environment }, update: { organizationId, userId, environment, active: true, lastSeenAt: new Date() }, select: { id: true, platform: true, environment: true, active: true, lastSeenAt: true } });
}

export async function unregisterPushDevice(organizationId: string, userId: string, token: string) {
  await prisma.ownerPushDevice.updateMany({ where: { organizationId, userId, token }, data: { active: false } });
}

export async function sendTestNotification(organizationId: string) {
  const settings = await getSettings(organizationId);
  if (!settings.whatsappOptedIn || !settings.whatsappNumber) throw new AppError(400, 'WHATSAPP_OPT_IN_REQUIRED', 'Save an opted-in WhatsApp number before sending a test.');
  if (!settings.providerReady) throw new AppError(503, 'WHATSAPP_NOT_CONFIGURED', 'WhatsApp delivery is not configured yet.');
  const now = new Date();
  return sendOwnerNotification({ organizationId, type: 'SYSTEM_TEST', dedupeKey: `test:${organizationId}:${now.getTime()}`, packet: { subjectName: 'Owner notification test', recordType: 'SYSTEM_TEST', product: null, eventDate: now.toISOString(), dueDate: null, amount: null, quantity: null, status: 'TEST', daysOverdueOrWaiting: null, station: { id: null, name: 'All fuel stations' }, evidence: [{ label: 'Open notification settings', path: '/notifications', recordType: 'NOTIFICATION_SETTINGS', recordId: null }], availableActions: ['ACKNOWLEDGE', 'VIEW_RECORD'] }, message: () => `FuelNerve test message\n\nWhatsApp alerts are connected for ${indiaDate()}. You will receive only the alerts you enable in FuelNerve.\n\nOpen FuelNerve: ${env.APP_URL}` });
}

export async function notifyMarketPriceOutlook(input: {
  organizationId: string;
  stationId: string;
  signalId: string;
  observedAt: Date;
  rationale: string;
}) {
  const [organization, station] = await Promise.all([
    prisma.organization.findUnique({ where: { id: input.organizationId }, select: { intelligenceEnabledAt: true, intelligenceExpiresAt: true } }),
    prisma.station.findFirst({ where: { id: input.stationId, organizationId: input.organizationId }, select: { id: true, name: true } }),
  ]);
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'The fuel station for this market outlook was not found.');
  const now = new Date();
  if (!organization?.intelligenceEnabledAt || (organization.intelligenceExpiresAt && organization.intelligenceExpiresAt <= now)) {
    return { status: 'SKIPPED' as const, reason: 'intelligence_plan_inactive' };
  }
  return sendOwnerNotification({
    organizationId: input.organizationId,
    stationId: station.id,
    type: 'MARKET_PRICE_OUTLOOK',
    dedupeKey: `market-price-outlook:${input.organizationId}:${station.id}:${input.signalId}`,
    title: () => 'Plan ahead of a possible price rise',
    severity: 'ATTENTION',
    packet: {
      subjectName: 'Fuel purchase price outlook',
      recordType: 'MARKET_PRICE_OUTLOOK',
      product: null,
      eventDate: input.observedAt.toISOString(),
      dueDate: null,
      amount: null,
      quantity: null,
      status: 'PRICE_INCREASE_POSSIBLE',
      daysOverdueOrWaiting: null,
      station: { id: station.id, name: station.name },
      evidence: [{ label: 'Review live tank stock', path: '/inventory', recordType: 'TANK_STOCK', recordId: null }],
      availableActions: ['ACKNOWLEDGE', 'REMIND_LATER', 'VIEW_RECORD', 'PREPARE_DRAFT'],
    },
    message: () => `${input.rationale}\n\nThis is a market outlook, not a confirmed supplier price change.`,
  });
}

export async function notifyShiftVariance(organizationId: string, shift: { id: string; station: { id: string; name: string }; shiftNumber: number; closedAt?: Date | null; totals: { variance: number } | null }) {
  const variance = Math.abs(shift.totals?.variance ?? 0);
  const settings = await getSettings(organizationId);
  if (variance < settings.varianceThreshold) return { status: 'SKIPPED' as const, reason: 'below_threshold' };
  const scenario = buildShiftScenario({ shiftId: shift.id, shiftNumber: shift.shiftNumber, eventAt: shift.closedAt ?? new Date(), state: 'COLLECTION_VARIANCE', collectionVariance: variance, station: shift.station, evidence: [{ label: `Open Shift ${shift.shiftNumber} reconciliation`, path: '/reconciliation', recordType: 'SHIFT', recordId: shift.id }] });
  return sendOwnerNotification({ organizationId, stationId: shift.station.id, type: 'SHIFT_VARIANCE', dedupeKey: `shift-variance:${shift.id}`, title: () => scenario.title, packet: scenario.facts, message: () => scenario.sentence });
}

export async function notifyLowStock(organizationId: string, tankId: string) {
  const tank = await prisma.tank.findFirst({ where: { id: tankId, status: 'ACTIVE', configuration: { active: true, station: { organizationId } } }, include: { product: { select: { name: true, code: true } }, configuration: { include: { station: { select: { id: true, name: true } } } } } });
  if (!tank) return { status: 'SKIPPED' as const, reason: 'tank_not_found' };
  const stock = Number(await bookStockAt(prisma, { organizationId, stationId: tank.configuration.station.id, productId: tank.productId, tankId: tank.id }));
  const fillPercent = Number(tank.workingCapacity) ? Math.max(0, stock / Number(tank.workingCapacity) * 100) : 0;
  const settings = await getSettings(organizationId);
  if (fillPercent > settings.lowStockPercent) return { status: 'SKIPPED' as const, reason: 'stock_healthy' };
  const date = indiaDate();
  const now = new Date();
  const scenario = buildStockScenario({ tankId: tank.id, tankCode: tank.code, product: tank.product, measuredAt: now, availableQuantity: Math.max(0, stock), state: stock <= 0 ? 'EMPTY' : 'LOW_STOCK', station: tank.configuration.station, evidence: [{ label: `Open ${tank.product.code} tank ${tank.code}`, path: '/inventory', recordType: 'TANK', recordId: tank.id }] });
  return sendOwnerNotification({ organizationId, stationId: tank.configuration.station.id, type: 'LOW_STOCK', dedupeKey: `low-stock:${tank.id}:${date}`, title: () => scenario.title, packet: scenario.facts, message: () => scenario.sentence });
}

export async function runScheduledNotifications(now = new Date()) {
  const { hour } = indiaParts(now);
  const date = indiaDate(now);
  const organizations = await prisma.organization.findMany({ select: { id: true, intelligenceEnabledAt: true, intelligenceExpiresAt: true, notificationSettings: { select: { dailySummaryHour: true } } } });
  const results: DeliveryResult[] = [];
  for (const organization of organizations) {
    if (hour === 9) results.push(await notifyMissingDensity(organization.id, date, now));
    if (hour === 23) results.push(await notifyUnclosedShifts(organization.id, date));
    if (hour === (organization.notificationSettings?.dailySummaryHour ?? defaults.dailySummaryHour)) {
      const intelligenceActive = Boolean(organization.intelligenceEnabledAt && (!organization.intelligenceExpiresAt || organization.intelligenceExpiresAt > now));
      if (intelligenceActive) {
        const briefing = await dailyBriefing(organization.id);
        const briefingCalculatedAt = new Date(briefing.calculatedAt);
        results.push(await sendOwnerNotification({ organizationId: organization.id, type: 'DAILY_SUMMARY', dedupeKey: `daily-briefing:${organization.id}:${date}`, title: () => briefing.narrative.headline, severity: 'INFORMATION', packet: { subjectName: 'Daily owner brief', recordType: 'DAILY_BRIEFING', product: null, eventDate: briefingCalculatedAt.toISOString(), dueDate: null, amount: null, quantity: null, status: 'READY', daysOverdueOrWaiting: null, station: { id: null, name: 'All fuel stations' }, evidence: [{ label: 'Open verified daily records', path: '/reports', recordType: 'DAILY_BRIEFING', recordId: null }], availableActions: ['ACKNOWLEDGE', 'VIEW_RECORD', 'GIVE_DETAILS'] }, message: () => `${briefing.narrative.headline}\n\n${briefing.narrative.summary}\n\nReview the verified briefing: ${env.APP_URL}/reports` }));
      } else results.push(await notifyDailySummary(organization.id, date));
      results.push(await notifyOverdueCustomers(organization.id, date));
    }
  }
  return { date, checkedOrganizations: organizations.length, sent: results.filter(result => result.status === 'SENT').length, failed: results.filter(result => result.status === 'FAILED').length, skipped: results.filter(result => result.status === 'SKIPPED').length };
}

async function notifyMissingDensity(organizationId: string, date: string, now: Date) {
  const tanks = await prisma.tank.findMany({ where: { status: 'ACTIVE', product: { category: 'FUEL' }, configuration: { active: true, station: { organizationId } }, densityReadings: { none: { recordedAt: { gte: indiaDayStart(now) } } } }, include: { product: { select: { code: true } }, configuration: { include: { station: { select: { id: true, name: true } } } } } });
  if (!tanks.length) return { status: 'SKIPPED' as const, reason: 'all_density_recorded' };
  const first = tanks[0]!;
  const sameStation = tanks.every(tank => tank.configuration.station.id === first.configuration.station.id);
  const subjectName = tanks.length === 1 ? `${first.product.code} tank ${first.code}` : `${tanks.length} fuel tanks`;
  const scenario = buildMissingRecordScenario({ subjectName, recordType: 'DENSITY_READING', expectedAt: indiaDayStart(now), now,
    product: tanks.length === 1 ? { name: first.product.code, code: first.product.code } : null,
    missingDescription: tanks.length === 1 ? 'The morning density reading' : `Morning density readings for ${tanks.length} tanks`,
    station: sameStation ? first.configuration.station : { id: null, name: 'multiple fuel stations' },
    evidence: tanks.slice(0, 3).map(tank => ({ label: `${tank.configuration.station.name} · ${tank.product.code} tank ${tank.code}`, path: '/inventory', recordType: 'TANK', recordId: tank.id })),
  });
  return sendOwnerNotification({ organizationId, type: 'DENSITY_MISSING', dedupeKey: `density-missing:${organizationId}:${date}`, title: () => scenario.title, packet: scenario.facts, message: () => scenario.sentence });
}

async function notifyUnclosedShifts(organizationId: string, date: string) {
  const shifts = await prisma.shift.findMany({ where: { status: 'OPEN', station: { organizationId } }, select: { id: true, shiftNumber: true, openedAt: true, station: { select: { id: true, name: true } } }, orderBy: { openedAt: 'asc' } });
  if (!shifts.length) return { status: 'SKIPPED' as const, reason: 'no_open_shifts' };
  const first = shifts[0]!;
  const sameStation = shifts.every(shift => shift.station.id === first.station.id);
  const scenario = buildShiftScenario({ shiftId: first.id, shiftNumber: first.shiftNumber, eventAt: first.openedAt, state: 'OPEN', relatedCount: shifts.length,
    station: sameStation ? first.station : { id: null, name: 'multiple fuel stations' },
    evidence: shifts.slice(0, 3).map(shift => ({ label: `${shift.station.name} · Shift ${shift.shiftNumber}`, path: '/operations', recordType: 'SHIFT', recordId: shift.id })),
  });
  return sendOwnerNotification({ organizationId, type: 'SHIFT_OPEN', dedupeKey: `open-shifts:${organizationId}:${date}`, title: () => scenario.title, packet: scenario.facts, message: () => scenario.sentence });
}

async function notifyDailySummary(organizationId: string, date: string) {
  const report = await buildReport(organizationId, { startDate: date, endDate: date });
  const calculatedAt = new Date();
  const scenario = buildProfitScenario({ periodLabel: date, calculatedAt, netResult: report.summary.netProfit, station: { id: null, name: 'All fuel stations' }, evidence: [{ label: 'Open daily reports', path: '/reports', recordType: 'REPORT', recordId: date }] });
  return sendOwnerNotification({ organizationId, type: 'DAILY_SUMMARY', dedupeKey: `daily-summary:${organizationId}:${date}`, title: () => scenario.title, packet: scenario.facts, message: () => scenario.sentence });
}

async function notifyOverdueCustomers(organizationId: string, date: string) {
  const report = await buildReport(organizationId, { startDate: date, endDate: date });
  const overdue = report.customers.map(customer => ({ ...customer, overdue: customer.ageing.days1to30 + customer.ageing.days31to60 + customer.ageing.days61to90 + customer.ageing.days90plus })).filter(customer => customer.overdue > 0.005);
  if (!overdue.length) return { status: 'SKIPPED' as const, reason: 'no_overdue_customers' };
  const total = overdue.reduce((sum, customer) => sum + customer.overdue, 0);
  const examples = overdue.slice(0, 3).map(customer => customer.customer).join(', ');
  const now = new Date();
  const first = overdue[0]!;
  return sendOwnerNotification({ organizationId, type: 'OVERDUE_CUSTOMER', dedupeKey: `overdue-customers:${organizationId}:${date}`, packet: { subjectName: overdue.length === 1 ? first.customer : `${overdue.length} customers`, recordType: 'CUSTOMER_RECEIVABLE', product: null, eventDate: now.toISOString(), dueDate: null, amount: { value: total, currency: 'INR' }, quantity: null, status: 'OVERDUE', daysOverdueOrWaiting: null, station: { id: null, name: 'All fuel stations' }, evidence: [{ label: overdue.length === 1 ? `Open ${first.customer} ledger` : 'Open customer ledgers', path: '/customers', recordType: 'CUSTOMER_LEDGER', recordId: null }], availableActions: ['ACKNOWLEDGE', 'REMIND_LATER', 'VIEW_RECORD', 'GIVE_DETAILS'] }, message: () => `FuelNerve receivables alert\n\n${overdue.length} customer${overdue.length === 1 ? '' : 's'} have overdue payments totalling ${money(total)}.\n${examples}${overdue.length > 3 ? '…' : ''}\n\nReview customers: ${env.APP_URL}/customers` });
}
