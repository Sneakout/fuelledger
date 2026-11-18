import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type OwnerNotificationDelivery, type OwnerNotificationType } from '@prisma/client';
import { allowsOwnerWhatsApp, hasActiveIntelligence } from '@fuelledger/shared';
import { env, whatsappConfigured } from '../../config/env.js';
import { indiaDate } from '../../lib/india-time.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { readDailyOperatingFacts, readReceiptMessageFacts, readShiftMessageFacts, readTankAlertFacts, readCustomerCreditFacts } from './message-facts.js';
import { coreDailyMessage, receiptMessage, shiftMessage, stockLevel, stockAlertMessage, isRecentReceipt } from './agent-messages.js';
import { readCustomerReminder, recentCustomerReminder } from './customer-reminder-facts.js';
import { checkLiveRollout, messageFingerprint, readRollout, rolloutHold } from './whatsapp-rollout.js';
import { buildWhatsAppTemplate, operationalBodies, buildWelcomeMessage, welcomeTemplate } from './whatsapp-template.js';

const templates: Partial<Record<OwnerNotificationType, string>> = {
  OWNER_WELCOME: welcomeTemplate.name,
  LOW_STOCK: 'fuelnerve_stock_level_v1',
  SHIFT_CLOSED_SUMMARY: 'fuelnerve_shift_closed_v1',
  PURCHASE_RECEIPT_SUMMARY: 'fuelnerve_purchase_receipt_v1',
  OVERDUE_CUSTOMER: 'fuelnerve_owner_credit_v1',
  CUSTOMER_CREDIT_REMINDER: 'fuelnerve_customer_payment_reminder_v1',
  DAILY_SUMMARY: 'fuelnerve_daily_operations_v1',
};
const operationalLanguage = 'en';
const maxAttempts = 4;
const leaseMs = 120_000;
const normalize = (number: string | null | undefined) => (number ?? '').replace(/^\+/, '');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Guard = { sourceId?: string; quantity?: number; status: string; snapshot?: string; version?: string; actorId?: string; scheduledHour?: number; welcome?: { ownerName: string; stationName: string } };

export async function creditDeliverySnapshot(organizationId: string, asOf: Date) {
  const facts = (await readCustomerCreditFacts({ organizationId }, asOf)).filter(row => row.outstanding > 0);
  const snapshot = digest(facts.map(row => [row.customerId, row.customerName, row.outstanding, row.overdueAmount, row.oldestDaysOverdue, row.completeness]));
  return { facts, snapshot };
}

export async function queueOwnerWhatsApp(input: {
  organizationId: string; stationId?: string; customerId?: string; type: OwnerNotificationType; eventKey: string;
  destination?: string | null; optedIn: boolean; categoryEnabled?: boolean; recordType: string; message: string; guard: Guard;
}, db: Prisma.TransactionClient = prisma) {
  const destination = normalize(input.destination);
  const dedupeKey = `wa:${digest([input.organizationId, input.stationId ?? null, input.type, input.eventKey, destination])}`;
  const suppressionReason = input.categoryEnabled === false ? 'category_disabled'
    : !input.optedIn ? 'owner_not_opted_in' : !/^\d{8,15}$/.test(destination) ? 'recipient_missing_or_invalid' : null;
  // Legacy delivery rows used the source event key directly.
  const legacy = await db.ownerNotificationDelivery.findFirst({ where: { dedupeKey: input.eventKey, organizationId: input.organizationId } });
  if (legacy) return legacy;
  await db.ownerNotificationDelivery.createMany({
    skipDuplicates: true,
    data: {
      organizationId: input.organizationId, stationId: input.stationId ?? null, customerId: input.customerId ?? null, type: input.type,
      eventKey: input.eventKey, dedupeKey, destination, message: input.message, recordType: input.recordType,
      guard: input.guard as Prisma.InputJsonValue, status: suppressionReason ? 'SUPPRESSED' : 'PENDING', suppressionReason,
    },
  });
  return db.ownerNotificationDelivery.findUniqueOrThrow({ where: { dedupeKey } });
}

async function relevance(job: OwnerNotificationDelivery, now: Date) {
  const guard = job.guard as Guard | null;
  if (!guard) return false;
  if (job.type === 'SYSTEM_TEST') return true;
  if (!job.stationId && ['DAILY_SUMMARY', 'OVERDUE_CUSTOMER'].includes(job.type) && indiaDate(job.createdAt) !== indiaDate(now)) return false;
  if (job.type === 'OVERDUE_CUSTOMER') {
    return Boolean(guard.snapshot && (await creditDeliverySnapshot(job.organizationId, now)).snapshot === guard.snapshot);
  }
  if (job.type === 'DAILY_SUMMARY') return true;
  if (!job.stationId || !guard.sourceId) return false;
  const scope = { organizationId: job.organizationId, stationId: job.stationId };
  const queuedBody = job.message.split('\n\nReview: ')[0];
  if (job.type === 'SHIFT_CLOSED_SUMMARY') {
    const facts = await readShiftMessageFacts(scope, guard.sourceId, now);
    return Boolean(facts && facts.collections?.reconciliationId === guard.version
      && [shiftMessage(facts), shiftMessage(facts, true)].includes(queuedBody ?? ''));
  }
  return false;
}

const graph = () => `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`;
const auth = () => ({ Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` });

async function approval(name: string, expectedBody: string) {
  const url = new URL(`${graph()}/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`);
  url.search = new URLSearchParams({ name, fields: 'name,language,category,status,components' }).toString();
  const response = await fetch(url, { headers: auth(), signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error('Template approval could not be verified.');
  const result = await response.json() as { data?: Array<{ name: string; language: string; category: string; status: string; components?: Array<{ type: string; text?: string; buttons?: Array<{ type: string; text: string; url?: string }> }> }> };
  const matching = result.data?.filter(row => row.name === name && row.language === operationalLanguage && row.category === 'UTILITY') ?? [];
  const approved = matching.find(row => row.status === 'APPROVED');
  if (approved) {
    const components = approved.components ?? [];
    const actual = components[0]?.text?.replace(/\s+/g, ' ').trim();
    const bodyMatches = components[0]?.type === 'BODY' && actual === expectedBody.replace(/\s+/g, ' ').trim();
    if (name === welcomeTemplate.name) {
      const buttons = components[1]?.buttons;
      const button = buttons?.[0];
      return bodyMatches && components.length === 2 && components[1]?.type === 'BUTTONS' && buttons?.length === 1
        && button?.type === welcomeTemplate.button.type && button.text === welcomeTemplate.button.text && button.url === welcomeTemplate.button.url
        ? 'approved' : 'changed';
    }
    return bodyMatches && components.length === 1 ? 'approved' : 'changed';
  }
  if (matching.some(row => ['PENDING', 'IN_APPEAL', 'PAUSED'].includes(row.status))) return 'waiting';
  return 'unavailable';
}

export async function drainWhatsAppQueue(now = new Date(), options: { previewOnly?: boolean; organizationId?: string; deliveryId?: string } = {}) {
  const totals = { accepted: 0, retried: 0, failed: 0, suppressed: 0, recovered: 0, deferred: 0 };
  const scope = { ...(options.organizationId ? { organizationId: options.organizationId } : {}), ...(options.deliveryId ? { id: options.deliveryId } : {}) };
  const expired = { ...scope, status: 'PROCESSING' as const, leaseUntil: { lte: now } };
  totals.failed += (await prisma.ownerNotificationDelivery.updateMany({
    where: { ...expired, dispatchStartedAt: { not: null } },
    data: { status: 'FAILED', failureKind: 'UNCERTAIN', failedAt: now, leaseUntil: null, errorMessage: 'The sender stopped after dispatch began. Await a verified Meta update.' },
  })).count;
  totals.recovered = (await prisma.ownerNotificationDelivery.updateMany({
    where: { ...expired, dispatchStartedAt: null },
    data: { status: 'PENDING', leaseUntil: null, callbackKey: null },
  })).count;
  const jobs = await prisma.ownerNotificationDelivery.findMany({
    where: { ...scope, status: 'PENDING', availableAt: { lte: now } }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }], take: 5,
  });
  for (const job of jobs) {
    const callbackKey = randomUUID();
    const claimed = await prisma.ownerNotificationDelivery.updateMany({
      where: { id: job.id, status: 'PENDING', availableAt: { lte: now } },
      data: { status: 'PROCESSING', callbackKey, leaseUntil: new Date(Date.now() + leaseMs) },
    });
    if (!claimed.count) continue;
    const owned = { id: job.id, callbackKey, status: 'PROCESSING' as const };
    const write = (data: Prisma.OwnerNotificationDeliveryUpdateManyMutationInput) =>
      prisma.ownerNotificationDelivery.updateMany({ where: owned, data: { ...data, leaseUntil: null } });
    const suppress = async (reason: string) => { totals.suppressed += (await write({ status: 'SUPPRESSED', suppressionReason: reason, rolloutHold: null })).count; };
    const defer = async (errorMessage: string) => {
      totals.deferred += (await write({
        status: 'PENDING', callbackKey: null, availableAt: new Date(Date.now() + 15 * 60_000), errorMessage, rolloutHold: null,
      })).count;
    };
    const attempt = job.attempts + 1;
    const fail = async (kind: string, errorMessage: string) => {
      totals.failed += (await write({ status: 'FAILED', failureKind: kind, errorMessage, failedAt: new Date(), attempts: attempt })).count;
    };
    const retry = async (errorMessage: string, kind: string) => {
      if (attempt >= maxAttempts) return fail(kind, errorMessage);
      totals.retried += (await write({ status: 'PENDING', dispatchStartedAt: null, callbackKey: null, attempts: attempt,
        availableAt: new Date(Date.now() + 60_000 * 2 ** (attempt - 1)), failureKind: kind, errorMessage })).count;
    };
    let started = false;
    try {
      const test = job.type === 'SYSTEM_TEST';
      if (Date.now() - job.createdAt.getTime() >= 24 * 60 * 60_000) { await suppress('message_expired'); continue; }
      const template = test ? env.WHATSAPP_TEMPLATE_NAME : templates[job.type];
      if (!template) { await suppress('template_missing'); continue; }
      const welcome = job.type === 'OWNER_WELCOME' ? (job.guard as Guard | null)?.welcome : undefined;
      if (job.type === 'OWNER_WELCOME' && !welcome) { await suppress('source_changed'); continue; }
      const staticBody = welcome ? welcomeTemplate.body : operationalBodies[template];
      const policy = await readRollout();
      const policyHold = rolloutHold(policy, job.organizationId, job.type)
        ?? (options.previewOnly ? 'preview_only' : !env.WHATSAPP_DELIVERY_ENABLED ? 'deployment_delivery_disabled' : null);
      const hasApprovedPreview = Boolean(job.previewHash && job.approvedPreviewHash === job.previewHash);
      const ready = (test ? whatsappConfigured : Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_API_VERSION))
        && Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID && env.WHATSAPP_APP_SECRET && env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
      const review = !policyHold && hasApprovedPreview && ready && !test && staticBody
        ? await approval(template, staticBody) : null;
      const customerReminder = job.type === 'CUSTOMER_CREDIT_REMINDER';
      let message = job.message;
      if (!customerReminder) {
        const [settings, organization, station] = await Promise.all([
          prisma.ownerNotificationSettings.findUnique({ where: { organizationId: job.organizationId } }),
          prisma.organization.findUnique({ where: { id: job.organizationId } }),
          job.stationId ? prisma.station.findFirst({ where: { id: job.stationId, organizationId: job.organizationId, active: true }, select: { id: true } }) : null,
        ]);
        const fresh = new Date();
        if (!organization || (job.stationId && !station) || !allowsOwnerWhatsApp(job.type, job.recordType ?? '', hasActiveIntelligence(organization, fresh))) {
          await suppress('plan_or_station_ineligible'); continue;
        }
        if (!settings?.whatsappOptedIn) { await suppress('owner_not_opted_in'); continue; }
        if (normalize(settings.whatsappNumber) !== job.destination) { await suppress('recipient_changed'); continue; }
        if ((job.type === 'LOW_STOCK' && !settings.lowStockEnabled) || (job.type === 'OVERDUE_CUSTOMER' && !settings.overdueCustomerEnabled)
          || (job.type === 'DAILY_SUMMARY' && !settings.dailySummaryEnabled)
          || (job.type === 'SHIFT_CLOSED_SUMMARY' && !settings.shiftSummaryEnabled)
          || (job.type === 'PURCHASE_RECEIPT_SUMMARY' && !settings.receiptSummaryEnabled)) { await suppress('category_disabled'); continue; }
        if (job.type === 'LOW_STOCK') {
          const guard = job.guard as Guard | null;
          const facts = job.stationId && guard?.sourceId
            ? await readTankAlertFacts({ organizationId: job.organizationId, stationId: job.stationId }, guard.sourceId, fresh) : null;
          if (!facts || facts.completeness !== 'COMPLETE'
            || stockLevel(facts.bookStock.toNumber(), facts.tank.workingCapacity.toNumber(), settings.lowStockPercent) !== guard?.status) {
            await suppress('source_changed'); continue;
          }
          message = stockAlertMessage(facts, settings.lowStockPercent, env.APP_URL);
        } else if (job.type === 'PURCHASE_RECEIPT_SUMMARY') {
          const guard = job.guard as Guard | null;
          const facts = job.stationId && guard?.sourceId
            ? await readReceiptMessageFacts({ organizationId: job.organizationId, stationId: job.stationId }, guard.sourceId, fresh) : null;
          const currentMessage = facts && isRecentReceipt(facts.receivedAt, fresh) ? receiptMessage(facts, env.APP_URL) : null;
          if (!currentMessage) { await suppress('source_changed'); continue; }
          message = currentMessage;
        } else if (!welcome) {
          if (!(await relevance(job, fresh))) { await suppress('source_changed'); continue; }
          if (job.type === 'DAILY_SUMMARY') {
            const date = indiaDate(job.createdAt);
            const facts = await readDailyOperatingFacts({ organizationId: job.organizationId, ...(job.stationId ? { stationId: job.stationId } : {}) }, date, fresh);
            message = coreDailyMessage(facts, date, env.APP_URL);
          }
        }
      }
      const body = message.replace(/\s+/g, ' ').trim();
      if (body.length > 900 && (!test || env.WHATSAPP_TEMPLATE_STYLE === 'ALERT_BODY')) { await suppress('message_too_long'); continue; }
      const customizedWelcome = welcome && buildWelcomeMessage(welcome.ownerName, welcome.stationName);
      const payloadTemplate = customizedWelcome?.template ?? buildWhatsAppTemplate(template, test ? env.WHATSAPP_TEMPLATE_LANGUAGE : operationalLanguage,
        test ? env.WHATSAPP_TEMPLATE_STYLE : 'ALERT_BODY', body);
      const previewBody = customizedWelcome ? `${customizedWelcome.body}\n\nButton: ${welcomeTemplate.button.text} · ${welcomeTemplate.button.url}` : staticBody ? staticBody.replace('{{1}}', () => body) : test && env.WHATSAPP_TEMPLATE_STYLE === 'NO_PARAMETERS' ? '' : body;
      const previewHash = messageFingerprint(job.destination, env.WHATSAPP_PHONE_NUMBER_ID, { payloadTemplate, staticBody, ...(welcome ? { button: welcomeTemplate.button } : {}) });
      const hold = async (reason: string) => {
        totals.deferred += (await write({ status: 'PENDING', callbackKey: null, rolloutHold: reason,
          previewBody, previewTemplate: template, previewHash, previewAt: new Date(),
          availableAt: new Date(Date.now() + 15 * 60_000) })).count;
      };
      const blocked = policyHold ?? (job.approvedPreviewHash === previewHash ? null : 'preview_approval_required');
      if (blocked) { await hold(blocked); continue; }
      if (!ready) { await defer('WhatsApp sending or delivery status verification is unavailable.'); continue; }
      if (!test) {
        if (!staticBody) { await suppress('template_body_missing'); continue; }
        if (review === 'changed') { await suppress('provider_template_changed'); continue; }
        if (!review || review === 'waiting') { await defer('Waiting for WhatsApp template approval or reactivation.'); continue; }
        if (review === 'unavailable') { await suppress('template_not_approved'); continue; }
      }
      let finalHold: string | null = null;
      const markStarted = async (db: Prisma.TransactionClient) => {
        const rollout = await checkLiveRollout(db, job.organizationId, job.type);
        finalHold = rollout.reason;
        if (finalHold) return false;
        return (await db.ownerNotificationDelivery.updateMany({
          where: { ...owned, leaseUntil: { gt: new Date() }, approvedPreviewHash: previewHash },
          data: { dispatchStartedAt: new Date(), attempts: attempt, message, rolloutHold: null, rolloutStage: rollout.stage },
        })).count === 1;
      };
      if (customerReminder && job.customerId && job.stationId) {
        const scope = { organizationId: job.organizationId, stationId: job.stationId, customerId: job.customerId };
        const guard = job.guard as Guard | null;
        const checked = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM customers WHERE id = ${scope.customerId} AND organization_id = ${scope.organizationId} FOR UPDATE`;
          const fresh = new Date();
          const result = await readCustomerReminder(scope, fresh, tx);
          if (!result.draft) return { reason: result.reason };
          if (guard?.status === 'SCHEDULED') {
            if (result.scheduledHour === null || result.scheduledHour !== guard.scheduledHour) return { reason: 'scheduled_policy_changed' };
          } else if (guard?.status !== 'OWNER_REVIEWED' || !guard.actorId || !await tx.user.findFirst({
            where: { id: guard.actorId, organizationId: job.organizationId, active: true, loginEnabled: true, role: 'OWNER' }, select: { id: true },
          })) return { reason: 'owner_approval_unavailable' };
          if (guard.snapshot !== result.draft.snapshot || job.destination !== result.draft.destination || job.message !== result.draft.message) {
            return { reason: 'customer_balance_or_recipient_changed' };
          }
          if (await tx.ownerNotificationDelivery.findFirst({ where: recentCustomerReminder(scope, fresh, job.id), select: { id: true } })) {
            return { reason: 'recent_customer_reminder' };
          }
          return { started: await markStarted(tx) };
        });
        if (checked.reason) { await suppress(checked.reason); continue; }
        started = checked.started === true;
      } else if (customerReminder) {
        await suppress('customer_or_station_unavailable'); continue;
      } else {
        started = await prisma.$transaction(markStarted);
      }
      if (finalHold) { await hold(finalHold); continue; }
      if (!started) continue;
      const response = await fetch(`${graph()}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ messaging_product: 'whatsapp', to: job.destination, type: 'template',
          biz_opaque_callback_data: callbackKey, template: payloadTemplate }),
      });
      const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { code?: number } } | null;
      const id = payload?.messages?.[0]?.id;
      if (response.ok && id) {
        totals.accepted += (await write({ status: 'ACCEPTED', providerMessageId: id, sentAt: new Date(), errorMessage: null, failureKind: null })).count;
      } else if (!response.ok && payload?.error && (response.status === 429 || [130429, 131056].includes(payload.error.code ?? 0)) && response.status < 500) {
        await retry('Meta explicitly rate-limited the request.', 'RATE_LIMIT');
      } else if (response.status >= 400 && response.status < 500 && payload?.error) {
        await fail('REJECTED', `Meta rejected the request (HTTP ${response.status}, code ${payload.error.code ?? 'unknown'}).`);
      } else {
        await fail('UNCERTAIN', 'Meta acceptance could not be confirmed. Await a verified Meta update.');
      }
    } catch {
      if (started) await fail('UNCERTAIN', 'The connection failed after dispatch began. Await a verified Meta update.');
      else await retry('Delivery checks could not finish before dispatch.', 'PREFLIGHT');
    }
  }
  return totals;
}

export async function retryWhatsAppDelivery(organizationId: string, id: string, userId: string) {
  const result = await prisma.ownerNotificationDelivery.updateMany({
    where: { id, organizationId, eventKey: { not: null }, status: 'FAILED', failureKind: { in: ['REJECTED', 'RATE_LIMIT', 'PREFLIGHT'] },
      providerMessageId: null, retriedAt: null, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) } },
    data: { status: 'PENDING', availableAt: new Date(), attempts: 0, callbackKey: null, dispatchStartedAt: null,
      retriedAt: new Date(), retriedById: userId, failedAt: null, failureKind: null, errorMessage: null },
  });
  if (!result.count) throw new AppError(409, 'DELIVERY_NOT_RETRYABLE', 'This message cannot be safely retried. Check its delivery history.');
}

export async function adminWhatsAppDeliveries(organizationId: string, limit = 30, messageId?: string) {
  const select = {
    id: true, type: true, status: true, createdAt: true, attempts: true, failureKind: true, errorMessage: true, suppressionReason: true, retriedAt: true, eventKey: true, providerMessageId: true,
    rolloutHold: true, previewBody: true, previewTemplate: true, previewHash: true, previewAt: true, approvedPreviewHash: true,
    destination: true, recordType: true, guard: true, stationId: true,
  } satisfies Prisma.OwnerNotificationDeliverySelect;
  const [recent, selected] = await Promise.all([
    prisma.ownerNotificationDelivery.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, select }),
    messageId ? prisma.ownerNotificationDelivery.findFirst({ where: { id: messageId, organizationId }, select }) : null,
  ]);
  const entries = selected ? [selected, ...recent.filter(row => row.id !== selected.id)] : recent;
  return entries.map(({ providerMessageId, eventKey, destination, guard, ...entry }) => ({
    ...entry, recipientEnding: destination.slice(-4),
    sourceId: (guard as Guard | null)?.sourceId ?? null,
    canRetry: Boolean(eventKey && !providerMessageId && !entry.retriedAt && entry.status === 'FAILED'
      && ['REJECTED', 'RATE_LIMIT', 'PREFLIGHT'].includes(entry.failureKind ?? '') && Date.now() - entry.createdAt.getTime() < 86_400_000),
  }));
}
