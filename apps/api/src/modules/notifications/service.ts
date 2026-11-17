import { AsyncLocalStorage } from 'node:async_hooks';
import { ownerNotificationPacketSchema, type OwnerNotificationPacket, type OwnerNotificationSettingsInput } from '@fuelledger/shared';
import { allowsOwnerWhatsApp, findFuelNerveAgent, hasActiveIntelligence, intelligenceWhatsAppAgents } from '@fuelledger/shared';
import { OwnerNotificationType, Prisma } from '@prisma/client';
import { apnsConfigured, env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { indiaDate, indiaDayStart, indiaParts } from '../../lib/india-time.js';
import { readDailyOperatingFacts } from './message-facts.js';
import { sendApns } from './apns.js';
import { buildApprovalScenario, buildMissingRecordScenario, buildShiftScenario } from './scenario-builders.js';
import { creditDeliverySnapshot, queueOwnerWhatsApp } from './delivery-queue.js';
import { coreDailyMessage, money as formatMoney } from './agent-messages.js';

type DeliveryResult = { status: 'SENT' | 'FAILED' | 'SKIPPED' | 'QUEUED'; reason?: string; id?: string };
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
  shiftSummaryEnabled: true,
  receiptSummaryEnabled: true,
  creditReportHour: 20,
  customerReminderScheduled: false,
  customerReminderHour: 10,
};
type NotificationSettingFields = Omit<typeof defaults, 'varianceThreshold' | 'stockVarianceTolerance'> & { varianceThreshold: unknown; stockVarianceTolerance: unknown };

function featureEnabled(settings: typeof defaults, type: OwnerNotificationType) {
  return type === 'DENSITY_MISSING' ? settings.densityMissingEnabled
    : type === 'LOW_STOCK' ? settings.lowStockEnabled
    : type === 'SHIFT_VARIANCE' ? settings.shiftVarianceEnabled
    : type === 'SHIFT_OPEN' ? settings.unclosedShiftEnabled
    : type === 'DAILY_SUMMARY' ? settings.dailySummaryEnabled
    : type === 'OVERDUE_CUSTOMER' ? settings.overdueCustomerEnabled
    : true;
}

const agentForType: Partial<Record<OwnerNotificationType, string>> = {
  ...intelligenceWhatsAppAgents,
  DENSITY_MISSING: 'inventory-watch',
  SHIFT_VARIANCE: 'reconciliation-review',
  SHIFT_OPEN: 'reconciliation-review',
  APPROVAL_REQUIRED: 'inventory-watch',
  CREDIT_SALE: 'credit-watch',
  CATALOG_CHANGE: 'purchase-check',
};
function responsibleAgent(type: OwnerNotificationType, recordType: string) {
  const purchaseRecord = ['PURCHASE_INVOICE', 'SUPPLIER_PAYABLE', 'PURCHASE_RECEIPT', 'PRODUCT_PRICE_CHANGE_REQUEST', 'MARKET_PRICE_OUTLOOK'].includes(recordType);
  const key = recordType === 'DAILY_BRIEFING' ? 'business-assistant' : purchaseRecord ? 'purchase-check' : agentForType[type];
  const agent = key ? findFuelNerveAgent(key) : undefined;
  return agent ? { key: agent.agentKey, name: agent.name, responsibility: agent.purpose } : null;
}
export function presentNotificationSettings(settings: (NotificationSettingFields & { id?: string; updatedAt?: Date }) | null) {
  const value = settings ?? defaults;
  return { ...value, varianceThreshold: Number(value.varianceThreshold), stockVarianceTolerance: Number(value.stockVarianceTolerance), providerReady: Boolean(env.WHATSAPP_DELIVERY_ENABLED && env.WHATSAPP_BUSINESS_ACCOUNT_ID && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_APP_SECRET && env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) };
}

export async function getSettings(organizationId: string) {
  return presentNotificationSettings(await prisma.ownerNotificationSettings.findUnique({ where: { organizationId } }));
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
    ...(input.shiftSummaryEnabled !== undefined ? { shiftSummaryEnabled: input.shiftSummaryEnabled } : {}),
    ...(input.receiptSummaryEnabled !== undefined ? { receiptSummaryEnabled: input.receiptSummaryEnabled } : {}),
    ...(input.creditReportHour !== undefined ? { creditReportHour: input.creditReportHour } : {}),
    ...(input.customerReminderScheduled !== undefined ? { customerReminderScheduled: input.customerReminderScheduled } : {}),
    ...(input.customerReminderHour !== undefined ? { customerReminderHour: input.customerReminderHour } : {}),
  };
  const settings = await prisma.ownerNotificationSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return presentNotificationSettings(settings);
}

export async function recentDeliveries(organizationId: string, stationIds?: string[]) {
  return prisma.ownerNotificationDelivery.findMany({ where: { organizationId, ...(stationIds ? { stationId: { in: stationIds } } : {}) }, orderBy: { createdAt: 'desc' }, take: 12, select: { id: true, type: true, station: { select: { name: true, code: true } }, destination: true, message: true, status: true, errorMessage: true, suppressionReason: true, sentAt: true, deliveredAt: true, readAt: true, failedAt: true, createdAt: true } });
}

type BaseNotificationPacket = Omit<OwnerNotificationPacket, 'schemaVersion' | 'responsibleAgent'>;
type AlertInput = { organizationId: string; stationId?: string; type: OwnerNotificationType; dedupeKey: string; title?: (packet: OwnerNotificationPacket) => string; message: (packet: OwnerNotificationPacket) => string; packet: BaseNotificationPacket; severity?: 'INFORMATION' | 'ATTENTION' | 'URGENT'; evidenceSourceType?: string; evidenceSourceId?: string; snapshot?: string; version?: string; stillRelevant?: () => Promise<boolean> };

function alertPresentation(input: AlertInput, packet: OwnerNotificationPacket) {
  const byType = {
    DENSITY_MISSING: ['Morning density is due', '/inventory'], LOW_STOCK: ['Fuel stock needs attention', '/inventory'],
    SHIFT_CLOSED_SUMMARY: ['Shift closed and reconciled', '/reconciliation'],
    PURCHASE_RECEIPT_SUMMARY: ['Stock delivery recorded', '/purchases'],
    SHIFT_VARIANCE: ['Shift variance needs review', '/reconciliation'], SHIFT_OPEN: ['A shift is still open', '/operations'],
    APPROVAL_REQUIRED: ['An owner decision is waiting', '/inventory'],
    MARKET_PRICE_OUTLOOK: ['Plan ahead of a possible price rise', '/inventory'],
    DAILY_SUMMARY: ['Your daily owner briefing', '/reports'], OVERDUE_CUSTOMER: ['Customer balances need follow-up', '/customers'],
    CREDIT_SALE: ['A new customer credit supply was recorded', '/customers'],
    CATALOG_CHANGE: ['A manager added a purchase record', '/purchases'],
    SYSTEM_TEST: ['FuelNerve alert test', '/notifications'],
    CUSTOMER_CREDIT_REMINDER: ['Customer payment reminder', '/customers'],
  } as const;
  const [title, path] = byType[input.type];
  const agent = packet.responsibleAgent;
  return { title: input.title?.(packet) ?? (agent ? agent.name + ': ' + title : title), path: packet.evidence[0]?.path ?? path, severity: input.severity ?? (input.type === 'DAILY_SUMMARY' || input.type === 'SYSTEM_TEST' ? 'INFORMATION' : 'ATTENTION') };
}

const whatsappPreview = new AsyncLocalStorage<boolean>();
export function prepareNotificationPreviews<T>(run: () => Promise<T>) {
  return whatsappPreview.run(true, run);
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
  const categoryEnabled = featureEnabled(settings, input.type);
  const intelligenceActive = hasActiveIntelligence(organization);
  const whatsappAllowed = Boolean(organization && allowsOwnerWhatsApp(input.type, input.packet.recordType, intelligenceActive));
  if (!categoryEnabled && !whatsappAllowed) return { status: 'SKIPPED', reason: 'disabled_by_owner' };
  if (input.stillRelevant && !(await input.stillRelevant())) return { status: 'SKIPPED', reason: 'facts_changed' };
  const packet = ownerNotificationPacketSchema.parse({ schemaVersion: 1, ...input.packet, responsibleAgent: intelligenceActive ? responsibleAgent(input.type, input.packet.recordType) : null });
  const message = input.message(packet);
  if (categoryEnabled) {
    const presentation = alertPresentation(input, packet);
    const alertMessage = message.replace(/\n*[^\n]*https?:\/\/\S+/g, '').trim();
    const primaryEvidence = packet.evidence[0]!;
    const alert = await prisma.ownerAlert.upsert({ where: { dedupeKey: input.dedupeKey }, create: { organizationId: input.organizationId, stationId: input.stationId ?? null, type: input.type, dedupeKey: input.dedupeKey, title: presentation.title, message: alertMessage, severity: presentation.severity, evidenceLabel: primaryEvidence.label, evidencePath: presentation.path, evidenceSourceType: input.evidenceSourceType ?? null, evidenceSourceId: input.evidenceSourceId ?? null, packet: packet as unknown as Prisma.InputJsonValue }, update: {} });
    if (input.type !== 'SYSTEM_TEST' && !whatsappPreview.getStore()) await deliverPush(alert);
  }
  if (!whatsappAllowed) {
    return { status: 'SKIPPED', reason: 'whatsapp_category_not_in_plan' };
  }
  if (input.stillRelevant && !(await input.stillRelevant())) return { status: 'SKIPPED', reason: 'facts_changed' };
  const delivery = await queueOwnerWhatsApp({
    organizationId: input.organizationId, ...(input.stationId ? { stationId: input.stationId } : {}), type: input.type,
    eventKey: input.dedupeKey, destination: settings.whatsappNumber, optedIn: settings.whatsappOptedIn, categoryEnabled: categoryEnabled
      && (input.type !== 'SHIFT_CLOSED_SUMMARY' || settings.shiftSummaryEnabled)
      && (input.type !== 'PURCHASE_RECEIPT_SUMMARY' || settings.receiptSummaryEnabled),
    recordType: packet.recordType, message, guard: { status: packet.status,
      ...(input.evidenceSourceId ? { sourceId: input.evidenceSourceId } : {}),
      ...(packet.quantity ? { quantity: packet.quantity.value } : {}),
      ...(input.snapshot ? { snapshot: input.snapshot } : {}),
      ...(input.version ? { version: input.version } : {}),
    },
  });
  return delivery.status === 'SUPPRESSED'
    ? { status: 'SKIPPED', reason: delivery.suppressionReason ?? 'suppressed' }
    : { status: 'QUEUED', id: delivery.id };
}

export async function notifyCatalogRecordCreated(input: {
  organizationId: string;
  stationId?: string;
  actorName: string;
  recordType: 'SUPPLIER' | 'PRODUCT';
  recordId: string;
  recordName: string;
  code: string;
}) {
  const label = input.recordType === 'SUPPLIER' ? 'supplier' : 'product';
  const path = input.recordType === 'SUPPLIER' ? '/purchases' : '/products';
  return sendOwnerNotification({
    organizationId: input.organizationId,
    ...(input.stationId ? { stationId: input.stationId } : {}),
    type: 'CATALOG_CHANGE',
    dedupeKey: `catalog-change:${input.recordType.toLowerCase()}:${input.recordId}`,
    severity: 'INFORMATION',
    title: () => `New ${label} added`,
    packet: {
      subjectName: input.recordName,
      recordType: `NEW_${input.recordType}`,
      product: input.recordType === 'PRODUCT' ? { name: input.recordName, code: input.code } : null,
      eventDate: new Date().toISOString(), dueDate: null, amount: null, quantity: null,
      status: 'CREATED', daysOverdueOrWaiting: null,
      station: { id: input.stationId ?? null, name: input.stationId ? 'Selected fuel station' : 'All fuel stations' },
      evidence: [{ label: `Review ${label}`, path, recordType: input.recordType, recordId: input.recordId }],
      availableActions: ['ACKNOWLEDGE', 'VIEW_RECORD'],
    },
    message: () => `FuelNerve purchase update\n\n${input.actorName} added a new ${label}: ${input.recordName} (${input.code}).\n\nReview it in FuelNerve: ${env.APP_URL}${path}`,
  });
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

export async function notifyCreditSale(input: {
  saleId: string;
  organizationId: string;
  stationId: string;
  stationName: string;
  customerId: string;
  customerName: string;
  productName: string;
  productCode: string;
  quantity: number;
  unit: string;
  amount: number;
  dueDate: Date;
  occurredAt: Date;
}) {
  return sendOwnerNotification({
    organizationId: input.organizationId,
    stationId: input.stationId,
    type: 'CREDIT_SALE',
    dedupeKey: `credit-sale:${input.saleId}`,
    severity: 'ATTENTION',
    title: () => `Credit Agent: ${input.customerName} received fuel on credit`,
    packet: {
      subjectName: input.customerName,
      recordType: 'CUSTOMER_CREDIT_SALE',
      product: { name: input.productName, code: input.productCode },
      eventDate: input.occurredAt.toISOString(),
      dueDate: input.dueDate.toISOString(),
      amount: { value: input.amount, currency: 'INR' },
      quantity: { value: input.quantity, unit: input.unit },
      status: 'OUTSTANDING',
      daysOverdueOrWaiting: null,
      station: { id: input.stationId, name: input.stationName },
      evidence: [{ label: `Open ${input.customerName} ledger`, path: '/customers', recordType: 'CUSTOMER_LEDGER', recordId: input.customerId }],
      availableActions: ['ACKNOWLEDGE', 'REMIND_LATER', 'VIEW_RECORD', 'GIVE_DETAILS'],
    },
    message: () => `FuelNerve Credit Agent\n\n${input.customerName} received ${input.quantity.toLocaleString('en-IN')} ${input.unit.toLowerCase()} of ${input.productCode} on credit at ${input.stationName}. Amount: ${money(input.amount)}. Due: ${input.dueDate.toLocaleDateString('en-IN')}.\n\nReview the customer ledger: ${env.APP_URL}/customers`,
    evidenceSourceType: 'SALE',
    evidenceSourceId: input.saleId,
  });
}

export async function notifyCreditAllocation(input: {
  allocationId: string;
  organizationId: string;
  stationId: string;
  stationName: string;
  customerId: string;
  customerName: string;
  shiftNumber: number;
  amount: number;
  dueDate: Date;
  occurredAt: Date;
}) {
  return sendOwnerNotification({
    organizationId: input.organizationId,
    stationId: input.stationId,
    type: 'CREDIT_SALE',
    dedupeKey: `credit-allocation:${input.allocationId}`,
    severity: 'ATTENTION',
    title: () => `Credit Agent: ${input.customerName} credit supply recorded`,
    packet: {
      subjectName: input.customerName,
      recordType: 'CUSTOMER_CREDIT_SALE',
      product: null,
      eventDate: input.occurredAt.toISOString(),
      dueDate: input.dueDate.toISOString(),
      amount: { value: input.amount, currency: 'INR' },
      quantity: null,
      status: 'OUTSTANDING',
      daysOverdueOrWaiting: null,
      station: { id: input.stationId, name: input.stationName },
      evidence: [{ label: `Open ${input.customerName} ledger`, path: '/customers', recordType: 'CUSTOMER_LEDGER', recordId: input.customerId }],
      availableActions: ['ACKNOWLEDGE', 'REMIND_LATER', 'VIEW_RECORD', 'GIVE_DETAILS'],
    },
    message: () => `FuelNerve Credit Agent\n\nA credit supply of ${money(input.amount)} was assigned to ${input.customerName} from Shift #${input.shiftNumber} at ${input.stationName}. Due: ${input.dueDate.toLocaleDateString('en-IN')}.\n\nReview the customer ledger: ${env.APP_URL}/customers`,
    evidenceSourceType: 'SHIFT_CREDIT_ALLOCATION',
    evidenceSourceId: input.allocationId,
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
  if (!env.WHATSAPP_TEMPLATE_NAME) throw new AppError(503, 'WHATSAPP_NOT_CONFIGURED', 'The WhatsApp test template is unavailable.');
  const now = new Date();
  return sendOwnerNotification({ organizationId, type: 'SYSTEM_TEST', dedupeKey: `test:${organizationId}:${Math.floor(now.getTime() / 60_000)}`, packet: { subjectName: 'Owner notification test', recordType: 'SYSTEM_TEST', product: null, eventDate: now.toISOString(), dueDate: null, amount: null, quantity: null, status: 'TEST', daysOverdueOrWaiting: null, station: { id: null, name: 'All fuel stations' }, evidence: [{ label: 'Open notification settings', path: '/notifications', recordType: 'NOTIFICATION_SETTINGS', recordId: null }], availableActions: ['ACKNOWLEDGE', 'VIEW_RECORD'] }, message: () => `FuelNerve test message\n\nWhatsApp alerts are connected for ${indiaDate()}. You will receive only the alerts you enable in FuelNerve.\n\nOpen FuelNerve: ${env.APP_URL}` });
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


export async function runScheduledNotifications(now = new Date()) {
  const { hour } = indiaParts(now);
  const date = indiaDate(now);
  const organizations = await prisma.organization.findMany({ select: { id: true, intelligenceEnabledAt: true, intelligenceExpiresAt: true, notificationSettings: { select: { dailySummaryHour: true, creditReportHour: true } } } });
  const results: DeliveryResult[] = [];
  for (const organization of organizations) {
    if (hour === 9) results.push(await notifyMissingDensity(organization.id, date, now));
    if (hour === 23) results.push(await notifyUnclosedShifts(organization.id, date));
    if (hasActiveIntelligence(organization, now)) {
      if (hour === (organization.notificationSettings?.creditReportHour ?? defaults.creditReportHour)) {
        results.push(await notifyOverdueCustomers(organization.id, date, now));
      }
    } else if (hour === (organization.notificationSettings?.dailySummaryHour ?? defaults.dailySummaryHour)) {
      results.push(await notifyDailySummary(organization.id, date, now));
    }
  }
  return { date, checkedOrganizations: organizations.length, queued: results.filter(result => result.status === 'QUEUED').length, failed: results.filter(result => result.status === 'FAILED').length, skipped: results.filter(result => result.status === 'SKIPPED').length };
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

async function notifyDailySummary(organizationId: string, date: string, now: Date) {
  const facts = await readDailyOperatingFacts({ organizationId }, date, now);
  const collected = facts.collections.actual?.toNumber() ?? null;
  const title = 'Daily operating summary';
  return sendOwnerNotification({
    organizationId, type: 'DAILY_SUMMARY', dedupeKey: `daily-summary:${organizationId}:${date}`, title: () => title,
    packet: {
      subjectName: title, recordType: 'CORE_DAILY_SUMMARY', product: null, eventDate: now.toISOString(), dueDate: null,
      amount: collected !== null ? { value: collected, currency: 'INR' } : null, quantity: null, status: facts.completeness, daysOverdueOrWaiting: null,
      station: { id: null, name: 'All fuel stations' },
      evidence: [{ label: 'Open daily reports', path: '/reports', recordType: 'REPORT', recordId: date }],
      availableActions: ['VIEW_RECORD'],
    },
    message: () => coreDailyMessage(facts, date, env.APP_URL),
  });
}

async function notifyOverdueCustomers(organizationId: string, date: string, now: Date) {
  const readReport = async (asOf: Date) => {
    const { facts, snapshot } = await creditDeliverySnapshot(organizationId, asOf);
    const customers = facts
      .sort((a, b) => b.overdueAmount - a.overdueAmount || b.outstanding - a.outstanding || a.customerId.localeCompare(b.customerId));
    if (!customers.length) return null;
    const total = customers.reduce((sum, customer) => sum.plus(customer.outstanding), new Prisma.Decimal(0));
    const overdue = customers.reduce((sum, customer) => sum.plus(customer.overdueAmount), new Prisma.Decimal(0));
    const lines = customers.slice(0, 5).map(customer => {
      const due = customer.oldestDaysOverdue !== null ? `${formatMoney(customer.overdueAmount)} overdue · oldest ${customer.oldestDaysOverdue} days`
        : customer.completeness === 'INCOMPLETE' ? 'Due date needs review' : 'None overdue';
      return `${customer.customerName.slice(0, 60)}: ${formatMoney(customer.outstanding)} outstanding · ${due}`;
    });
    return { customers, total, snapshot, message: [
      'FuelNerve Credit Agent · Customer dues',
      `${formatMoney(total)} outstanding · ${formatMoney(overdue)} overdue`,
      ...lines, ...(customers.length > lines.length ? [`+${customers.length - lines.length} more in FuelNerve`] : []),
      `Review ledgers: ${env.APP_URL}/customers`,
    ].join('\n') };
  };
  const report = await readReport(now);
  if (!report) return { status: 'SKIPPED' as const, reason: 'no_outstanding_customers' };
  const { customers, total, message } = report;
  return sendOwnerNotification({
    organizationId, type: 'OVERDUE_CUSTOMER', dedupeKey: `overdue-customers:${organizationId}:${date}`, snapshot: report.snapshot,
    stillRelevant: async () => (await readReport(new Date()))?.message === message,
    packet: {
      subjectName: `${customers.length} customer account${customers.length === 1 ? '' : 's'}`,
      recordType: 'CUSTOMER_RECEIVABLE', product: null, eventDate: now.toISOString(), dueDate: null,
      amount: { value: total.toNumber(), currency: 'INR' }, quantity: null, status: 'OUTSTANDING',
      daysOverdueOrWaiting: customers.length === 1 ? customers[0]!.oldestDaysOverdue : null,
      station: { id: null, name: 'All fuel stations' },
      evidence: [{ label: 'Open customer ledgers', path: '/customers', recordType: 'CUSTOMER_LEDGER', recordId: customers.length === 1 ? customers[0]!.customerId : null }],
      availableActions: ['ACKNOWLEDGE', 'VIEW_RECORD'],
    },
    message: () => message,
  });
}
