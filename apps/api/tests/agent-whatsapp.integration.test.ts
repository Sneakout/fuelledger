import { afterAll, describe, expect, it, vi } from 'vitest';
import { indiaParts } from '../src/lib/india-time.js';
import { approveCustomerReminder, previewCustomerReminder, saveReminderProfile, scheduleCustomerReminders } from '../src/modules/notifications/customer-reminders.js';
import { createHmac, randomUUID } from 'node:crypto';

vi.mock('../src/lib/prisma.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasourceUrl: process.env.AGENT_MESSAGE_TEST_DATABASE_URL ?? 'postgresql://unused' }) };
});
vi.mock('../src/config/env.js', () => ({
  env: { APP_URL: 'https://example.test', WHATSAPP_API_VERSION: 'v1.0', WHATSAPP_PHONE_NUMBER_ID: 'test-phone', WHATSAPP_ACCESS_TOKEN: 'test-token', WHATSAPP_BUSINESS_ACCOUNT_ID: 'test-waba', WHATSAPP_APP_SECRET: 'test-secret', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token', WHATSAPP_DELIVERY_ENABLED: true, WHATSAPP_TEMPLATE_NAME: 'test_template', WHATSAPP_TEMPLATE_LANGUAGE: 'en', WHATSAPP_TEMPLATE_STYLE: 'ALERT_BODY' },
  whatsappConfigured: true,
  apnsConfigured: false,
}));

import { prisma } from '../src/lib/prisma.js';
import { enqueueReview } from '../src/modules/nerve/review-events.js';
import { drainAgentMessages } from '../src/modules/notifications/agent-dispatch.js';
import { customerReminderDraft } from '../src/modules/notifications/agent-messages.js';
import { readCustomerCreditFacts } from '../src/modules/notifications/message-facts.js';

import { drainWhatsAppQueue, queueOwnerWhatsApp, retryWhatsAppDelivery } from '../src/modules/notifications/delivery-queue.js';
import { operationalBodies, welcomeTemplate } from '../src/modules/notifications/whatsapp-template.js';
import { approveRolloutPreview, pauseRollout, readRollout, updateRollout } from '../src/modules/notifications/whatsapp-rollout.js';
import { processWhatsAppWebhook, verifyWebhookSignature } from '../src/modules/notifications/whatsapp-webhook.js';

import { sendWelcomeTest, updateSettings } from '../src/modules/notifications/service.js';

const ownerCategories = ['LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY', 'DAILY_SUMMARY', 'OVERDUE_CUSTOMER', 'SYSTEM_TEST'];
const providerTemplate = (name: string, status = 'APPROVED') => ({
  name, status, language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: operationalBodies[name] }],
});
async function deliverWithReviewedFixtures() {
  await drainWhatsAppQueue();
  const newPreviews = await prisma.ownerNotificationDelivery.findMany({
    where: { status: 'PENDING', rolloutHold: 'preview_approval_required', previewHash: { not: null } },
  });
  for (const row of newPreviews) {
    if (row.previewHash === row.approvedPreviewHash) continue;
    await prisma.ownerNotificationDelivery.updateMany({ where: { id: row.id, previewHash: row.previewHash, status: 'PENDING' },
      data: { approvedPreviewHash: row.previewHash, availableAt: new Date() } });
  }
  if (newPreviews.length) await drainWhatsAppQueue();
}

const suite = process.env.AGENT_MESSAGE_TEST_DATABASE_URL ? describe : describe.skip;
suite('WhatsApp coordination on isolated PostgreSQL', () => {
  afterAll(async () => { vi.unstubAllGlobals(); await prisma.$disconnect(); });

  it('queues one welcome after opt-in and sends an identical approved welcome test', async () => {
    const org = await prisma.organization.create({ data: { name: 'Welcome fixture' } });
    const owner = await prisma.user.create({ data: {
      organizationId: org.id, name: 'Nanda Owner', email: `${org.id}@example.test`, passwordHash: 'test', role: 'OWNER',
    } });
    const station = await prisma.station.create({ data: {
      organizationId: org.id, name: 'Fixture Petrol Pump', code: 'TEST',
      addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000',
    } });
    const input = {
      whatsappNumber: '919000000007', whatsappOptedIn: false, densityMissingEnabled: false, lowStockEnabled: false,
      shiftVarianceEnabled: false, unclosedShiftEnabled: false, dailySummaryEnabled: false, overdueCustomerEnabled: false,
      lowStockPercent: 20, varianceThreshold: 100, stockVarianceTolerance: 50, dailySummaryHour: 20,
    };
    const jobs = () => prisma.ownerNotificationDelivery.findMany({ where: { organizationId: org.id, type: 'OWNER_WELCOME' } });
    await updateSettings(org.id, input, owner.name);
    expect(await jobs()).toHaveLength(0);
    const optedIn = { ...input, whatsappOptedIn: true };
    await updateSettings(org.id, optedIn, owner.name);
    await updateSettings(org.id, optedIn, owner.name);
    expect(await jobs()).toHaveLength(1);
    const test = await sendWelcomeTest(org.id);
    expect(test.status).toBe('QUEUED');

    const send = vi.fn(async (_payload: unknown) => Response.json({ messages: [{ id: randomUUID() }] }));
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith('/message_templates')) {
        return Response.json({ data: [{
          name: welcomeTemplate.name, status: 'APPROVED', language: 'en', category: 'UTILITY',
          components: [{ type: 'BODY', text: welcomeTemplate.body }, { type: 'BUTTONS', buttons: [welcomeTemplate.button] }],
        }] });
      }
      return send(JSON.parse(String(init?.body)));
    });
    await prisma.whatsAppRollout.update({ where: { id: 'global' }, data: {
      stage: 'INTERNAL', paused: true, organizationIds: [org.id], enabledCategories: ['OWNER_WELCOME'],
    } });
    try {
      await drainWhatsAppQueue(new Date(), { previewOnly: true });
      expect(send).not.toHaveBeenCalled();
      const previews = await jobs();
      expect(previews).toHaveLength(2);
      for (const job of previews) {
        expect(job.previewBody).toContain('*Welcome to FuelNerve, Nanda!*');
        expect(job.previewBody).toContain('Fixture Petrol Pump');
        expect(job.previewBody).toContain('Open FuelNerve · https://fuel.mindvector.tech/');
        await approveRolloutPreview(org.id, job.id, job.previewHash!, owner.id);
      }
      await prisma.whatsAppRollout.update({ where: { id: 'global' }, data: { paused: false } });
      await drainWhatsAppQueue();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        to: input.whatsappNumber, template: { name: welcomeTemplate.name, components: [{ type: 'body', parameters: [
          { type: 'text', text: 'Nanda' }, { type: 'text', text: station.name },
        ] }] },
      });
      expect((await jobs()).every(job => job.status === 'ACCEPTED')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      await pauseRollout(owner.id);
    }
  });

  it('sends each verified message once, resolves low stock after a receipt and withdraws a paid reminder', async () => {
    let templateStatus = 'PENDING';
    const fetchStub = vi.fn(async () => Response.json({ messages: [{ id: randomUUID() }] }));
    vi.stubGlobal('fetch', (url: string | URL) => {
      const name = new URL(url).searchParams.get('name');
      return name
        ? Promise.resolve(Response.json({ data: [providerTemplate(name, templateStatus)] }))
        : fetchStub();
    });
    const org = await prisma.organization.create({ data: { name: 'WhatsApp test', intelligenceEnabledAt: new Date() } });
    const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Fixture station', code: 'TEST', addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const scope = { organizationId: org.id, stationId: station.id };
    const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Owner', email: `${org.id}@example.test`, passwordHash: 'test', role: 'OWNER' } });
    await prisma.ownerNotificationSettings.create({ data: { organizationId: org.id, whatsappNumber: '919000000000', whatsappOptedIn: true } });
    await prisma.whatsAppRollout.update({ where: { id: 'global' }, data: { paused: false, stage: 'INTERNAL',
      organizationIds: [org.id], enabledCategories: ownerCategories } });
    const fuel = await prisma.product.create({ data: { organizationId: org.id, name: 'Diesel', code: 'HSD', category: 'FUEL', unit: 'LITRE', tankLinked: true } });
    const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
    const tank = await prisma.tank.create({ data: { configurationId: config.id, productId: fuel.id, code: 'T1', nominalCapacity: 5000, workingCapacity: 5000, openingStock: 1200, tankType: 'UNDERGROUND', dipMethod: 'MANUAL' } });
    const stockReview = (resourceId: string) => enqueueReview(prisma, { ...scope, type: 'DAILY_REVIEW', resourceId, occurredAt: new Date() });
    const adjust = (quantityDelta: number) => prisma.inventoryLedger.create({
      data: { ...scope, productId: fuel.id, tankId: tank.id, type: 'ADJUSTMENT', quantityDelta },
    });
    await stockReview('healthy');
    await drainAgentMessages();
    expect(await prisma.ownerNotificationDelivery.count({ where: { ...scope, type: 'LOW_STOCK' } })).toBe(0);
    await adjust(-700);
    await stockReview('low');
    await Promise.all([drainAgentMessages(), drainAgentMessages()]);
    await stockReview('still-low');
    await drainAgentMessages();
    await Promise.all([deliverWithReviewedFixtures(), deliverWithReviewedFixtures()]);
    const pending = await prisma.ownerNotificationDelivery.findFirstOrThrow({ where: { ...scope, type: 'LOW_STOCK' } });
    expect(pending).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(pending.errorMessage).toContain('template approval');
    expect(fetchStub).not.toHaveBeenCalled();
    templateStatus = 'APPROVED';
    await adjust(-50);
    await prisma.ownerNotificationDelivery.update({ where: { id: pending.id }, data: { availableAt: new Date(0) } });
    await Promise.all([deliverWithReviewedFixtures(), deliverWithReviewedFixtures()]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect((await prisma.ownerNotificationDelivery.findUniqueOrThrow({ where: { id: pending.id } })).message).toContain('450 L book stock');
    const supplier = await prisma.supplier.create({ data: { organizationId: org.id, name: 'Fixture supplier', code: 'SUP' } });
    const invoice = await prisma.purchaseInvoice.create({ data: { ...scope, supplierId: supplier.id, invoiceNumber: 'INV-1', invoiceDate: new Date('2026-11-01'), dueDate: new Date('2026-12-01'), subtotal: 180000, totalAmount: 180000, createdById: owner.id, lines: { create: { productId: fuel.id, description: 'Diesel', quantity: 3000, unitCost: 60, lineTotal: 180000 } } } });
    const receipt = await prisma.purchaseReceipt.create({ data: { ...scope, supplierName: supplier.name, invoiceId: invoice.id, createdById: owner.id } });
    const line = await prisma.receiptLine.create({ data: { receiptId: receipt.id, productId: fuel.id, tankId: tank.id, quantity: 2000, unitCost: 90 } });
    await prisma.inventoryLedger.create({ data: { ...scope, productId: fuel.id, tankId: tank.id, receiptLineId: line.id, type: 'RECEIPT', quantityDelta: 2000 } });
    await enqueueReview(prisma, { ...scope, type: 'RECEIPT_RECORDED', resourceId: receipt.id, occurredAt: receipt.receivedAt });
    await drainAgentMessages();
    const queuedReceipt = await prisma.ownerNotificationDelivery.findFirstOrThrow({ where: { ...scope, type: 'PURCHASE_RECEIPT_SUMMARY' } });
    expect(queuedReceipt.message).toContain('Outstanding: ₹1,80,000.00 · Due: 2026-12-01');
    await prisma.supplierPayment.create({ data: { ...scope, supplierId: supplier.id, invoiceId: invoice.id, amount: 180000, paymentMethod: 'UPI', createdById: owner.id } });
    await Promise.all([deliverWithReviewedFixtures(), deliverWithReviewedFixtures()]);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    const delivered = await prisma.ownerNotificationDelivery.findUniqueOrThrow({ where: { id: queuedReceipt.id } });
    expect(delivered.message).toContain('HSD: 2,000 L → Tank T1');
    expect(delivered.message).toContain('INV-1');
    expect(delivered.message).toContain('Partial receipt: HSD: 2,000 L received of 3,000 L invoiced');
    expect(delivered.message).toContain('Payment status: Paid in full');
    expect(delivered.message).not.toContain('Outstanding:');

    const backdated = await prisma.purchaseReceipt.create({ data: { ...scope, supplierName: supplier.name,
      createdById: owner.id, receivedAt: new Date(Date.now() - 3 * 86_400_000),
      lines: { create: { productId: fuel.id, tankId: tank.id, quantity: 100, unitCost: 60 } },
    } });
    await enqueueReview(prisma, { ...scope, type: 'RECEIPT_RECORDED', resourceId: backdated.id, occurredAt: backdated.receivedAt });
    await drainAgentMessages();
    await deliverWithReviewedFixtures();
    expect(await prisma.ownerNotificationDelivery.count({ where: { ...scope, type: 'PURCHASE_RECEIPT_SUMMARY' } })).toBe(1);
    expect(await prisma.ownerAlert.count({ where: { ...scope, type: 'LOW_STOCK', resolvedAt: { not: null } } })).toBe(1);

    const shift = await prisma.shift.create({ data: {
      stationId: station.id, configurationId: config.id, managerId: owner.id, shiftNumber: 1, openingCash: 0, closingCash: 100,
      closedAt: new Date(), status: 'LOCKED', tankReadings: { create: { tankId: tank.id, openingDip: 2500, closingDip: 2499 } },
      reconciliation: { create: { reconciledById: owner.id, collections: { create: { paymentMethod: 'CASH', expectedAmount: 105, actualAmount: 100, varianceAmount: -5 } } } },
    } });
    await enqueueReview(prisma, { ...scope, type: 'SHIFT_RECONCILED', resourceId: shift.id, occurredAt: new Date() });
    await drainAgentMessages();
    await drainAgentMessages();
    await Promise.all([deliverWithReviewedFixtures(), deliverWithReviewedFixtures()]);
    expect(fetchStub).toHaveBeenCalledTimes(3);
    const summary = await prisma.ownerNotificationDelivery.findFirstOrThrow({ where: { ...scope, type: 'SHIFT_CLOSED_SUMMARY' } });
    expect(summary.message).toContain('Shortage: ₹5.00');
    expect(summary.message).toContain('2,499 L measured · 2,450 L book');

    const customer = await prisma.customer.create({ data: { organizationId: org.id, name: 'Fleet customer', code: 'CUS', type: 'CREDIT' } });
    const yesterday = new Date(Date.now() - 86_400_000);
    await prisma.customerLedgerEntry.create({ data: { ...scope, customerId: customer.id, amount: 50, type: 'SALE', description: 'Credit supply', occurredAt: yesterday, dueDate: yesterday, createdById: owner.id } });
    const draft = async () => customerReminderDraft((await readCustomerCreditFacts(scope, new Date(), customer.id))[0]!, station.name);
    expect(await draft()).toMatchObject({ overdueAmount: 50, status: 'DRAFT' });
    await prisma.customerLedgerEntry.create({ data: { ...scope, customerId: customer.id, amount: -50, type: 'RECEIPT', description: 'Paid', createdById: owner.id } });
    expect(await draft()).toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(3);

    const queue = (eventKey: string) => queueOwnerWhatsApp({ ...scope, eventKey, type: 'SYSTEM_TEST',
      recordType: 'SYSTEM_TEST', message: 'Test', guard: { status: 'TEST' }, optedIn: true, destination: '+919000000000' });
    const [job, duplicate] = await Promise.all([queue('timeout'), queue('timeout')]);
    expect(job.id).toBe(duplicate.id);
    fetchStub.mockRejectedValueOnce(new Error('Network timeout'));
    await Promise.all([deliverWithReviewedFixtures(), deliverWithReviewedFixtures()]);
    const getJob = (id: string) => prisma.ownerNotificationDelivery.findUniqueOrThrow({ where: { id } });
    const uncertain = await getJob(job.id);
    expect(uncertain).toMatchObject({ status: 'FAILED', failureKind: 'UNCERTAIN', attempts: 1 });
    await expect(retryWhatsAppDelivery(org.id, job.id, owner.id)).rejects.toThrow('cannot be safely retried');
    const lateMessageId = randomUUID();
    const webhook = (status: 'delivered' | 'read', waba = 'test-waba') => ({
      object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'test-phone' }, statuses: [{ id: lateMessageId, status, biz_opaque_callback_data: uncertain.callbackKey! }],
      } }] }],
    });
    const update = (status: 'delivered' | 'read', waba = 'test-waba') => processWhatsAppWebhook(webhook(status, waba));
    const raw = Buffer.from(JSON.stringify(webhook('read')));
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(raw).digest('hex')}`;
    expect(verifyWebhookSignature(raw, signature, 'test-secret')).toBe(true);
    expect(verifyWebhookSignature(Buffer.concat([raw, Buffer.from(' ')]), signature, 'test-secret')).toBe(false);
    expect(await update('read', 'wrong-waba')).toEqual({ processed: 0 });
    expect(await update('read')).toEqual({ processed: 1 });
    expect(await update('read')).toEqual({ processed: 0 });
    expect(await update('delivered')).toEqual({ processed: 0 });
    expect(await getJob(job.id)).toMatchObject({ status: 'READ', providerMessageId: lateMessageId });

    const beforeDispatch = await queue('restart-before');
    const afterDispatch = await queue('restart-after');
    await prisma.ownerNotificationDelivery.updateMany({ where: { id: { in: [beforeDispatch.id, afterDispatch.id] } },
      data: { status: 'PROCESSING', leaseUntil: yesterday } });
    await prisma.ownerNotificationDelivery.update({ where: { id: afterDispatch.id }, data: { dispatchStartedAt: yesterday } });
    await deliverWithReviewedFixtures();
    expect(await getJob(beforeDispatch.id)).toMatchObject({ status: 'ACCEPTED' });
    expect(await getJob(afterDispatch.id)).toMatchObject({ status: 'FAILED', failureKind: 'UNCERTAIN' });
    expect(fetchStub).toHaveBeenCalledTimes(5);

    const rejected = await queue('rate-limit');
    fetchStub.mockResolvedValueOnce(Response.json({ error: { code: 130429 } }, { status: 429 }));
    await deliverWithReviewedFixtures();
    expect(await getJob(rejected.id)).toMatchObject({ status: 'PENDING', failureKind: 'RATE_LIMIT', attempts: 1 });
    await deliverWithReviewedFixtures();
    expect(fetchStub).toHaveBeenCalledTimes(6);
    await prisma.ownerNotificationDelivery.update({ where: { id: rejected.id }, data: { availableAt: yesterday } });
    await prisma.ownerNotificationSettings.update({ where: { organizationId: org.id }, data: { whatsappOptedIn: false } });
    await deliverWithReviewedFixtures();
    expect(await getJob(rejected.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'owner_not_opted_in' });
    expect(fetchStub).toHaveBeenCalledTimes(6);

    await prisma.ownerNotificationSettings.update({ where: { organizationId: org.id }, data: { whatsappOptedIn: true } });
    const adminRetry = await queue('administrator-retry');
    fetchStub.mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 401 }));
    await deliverWithReviewedFixtures();
    expect(await getJob(adminRetry.id)).toMatchObject({ status: 'FAILED', failureKind: 'REJECTED' });
    const retries = await Promise.allSettled([
      retryWhatsAppDelivery(org.id, adminRetry.id, owner.id),
      retryWhatsAppDelivery(org.id, adminRetry.id, owner.id),
    ]);
    expect(retries.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await deliverWithReviewedFixtures();
    expect(await getJob(adminRetry.id)).toMatchObject({ status: 'ACCEPTED', retriedById: owner.id });
    expect(fetchStub).toHaveBeenCalledTimes(8);

    for (const [key, plan] of [
      ['expiry', { intelligenceEnabledAt: yesterday, intelligenceExpiresAt: yesterday }],
      ['downgrade', { intelligenceEnabledAt: null, intelligenceExpiresAt: null }],
    ] as const) {
      const queued = await queueOwnerWhatsApp({ ...scope, type: 'SHIFT_CLOSED_SUMMARY', eventKey: key,
        recordType: 'SHIFT', message: 'Pending shift summary', guard: { sourceId: shift.id, status: 'COMPLETE' }, optedIn: true, destination: '+919000000000' });
      await prisma.organization.update({ where: { id: org.id }, data: plan });
      await deliverWithReviewedFixtures();
      expect(await getJob(queued.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'plan_or_station_ineligible' });
    }
    const core = await queueOwnerWhatsApp({ ...scope, type: 'DAILY_SUMMARY', eventKey: 'core-summary',
      recordType: 'CORE_DAILY_SUMMARY', message: 'Daily summary', guard: { status: 'COMPLETE' }, optedIn: true, destination: '+919000000000' });
    await deliverWithReviewedFixtures();
    expect(await getJob(core.id)).toMatchObject({ status: 'ACCEPTED', message: expect.stringContaining('₹100.00') });
    expect(fetchStub).toHaveBeenCalledTimes(9);
    const outside = await prisma.organization.create({ data: { name: 'Unrelated tenant', intelligenceEnabledAt: yesterday } });
    await prisma.ownerNotificationSettings.create({ data: { organizationId: outside.id, whatsappNumber: '919000000004', whatsappOptedIn: true } });
    const wrongStation = await queueOwnerWhatsApp({ organizationId: outside.id, stationId: station.id, type: 'SHIFT_CLOSED_SUMMARY',
      eventKey: 'foreign-station', recordType: 'SHIFT_CLOSURE', message: 'Fixture foreign station', guard: { sourceId: shift.id, status: 'RECONCILED' },
      optedIn: true, destination: '+919000000004' });
    await deliverWithReviewedFixtures();
    expect(await getJob(wrongStation.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'plan_or_station_ineligible' });
    expect(fetchStub).toHaveBeenCalledTimes(9);
  }, 30_000);

  it('rechecks customer consent, payment, disputes, schedule and cooldown at dispatch', async () => {
    const sent = vi.fn(async () => Response.json({ messages: [{ id: randomUUID() }] }));
    vi.stubGlobal('fetch', (url: string | URL) => {
      const name = new URL(url).searchParams.get('name');
      return name ? Promise.resolve(Response.json({ data: [providerTemplate(name)] })) : sent();
    });
    const organization = await prisma.organization.create({ data: { name: 'Customer reminders', intelligenceEnabledAt: new Date() } });
    const organizationId = organization.id;
    await prisma.whatsAppRollout.update({ where: { id: 'global' }, data: { stage: 'PILOT', paused: false,
      organizationIds: [organizationId], enabledCategories: ['CUSTOMER_CREDIT_REMINDER'] } });
    const station = (code: string) => prisma.station.create({ data: { organizationId, name: `Fixture ${code}`, code,
      addressLine1: 'Test', city: 'Test', state: 'Test', postalCode: '000000' } });
    const [main, alternate] = await Promise.all([station('MAIN'), station('ALT')]);
    const owner = await prisma.user.create({ data: { organizationId, name: 'Owner', email: `${organizationId}@example.test`, passwordHash: 'test', role: 'OWNER' } });
    const customer = await prisma.customer.create({ data: { organizationId, name: 'Fixture fleet', code: 'FLEET', type: 'FLEET' } });
    const scope = { organizationId, stationId: main.id, customerId: customer.id };
    const past = new Date(Date.now() - 3 * 86_400_000);
    const debit = await prisma.customerLedgerEntry.create({ data: { ...scope, type: 'SALE', amount: 2500, description: 'Credit supply', occurredAt: past, dueDate: past, createdById: owner.id } });
    await expect(previewCustomerReminder(scope)).rejects.toThrow('consent');
    const consent = { destination: '919000000001', consentSource: 'Signed fixture consent', recordConsent: true, revokeConsent: false, paused: false };
    await saveReminderProfile(organizationId, customer.id, owner.id, consent);
    await expect(previewCustomerReminder({ ...scope, stationId: alternate.id })).rejects.toThrow('no verified overdue balance');
    await expect(previewCustomerReminder({ ...scope, organizationId: randomUUID() })).rejects.toThrow('unavailable');
    const draft = await previewCustomerReminder(scope);
    expect(draft).toMatchObject({ overdueAmount: 2500 });
    const approved = await Promise.all([
      approveCustomerReminder(scope, owner.id, draft.snapshot),
      approveCustomerReminder(scope, owner.id, draft.snapshot),
    ]);
    expect(approved[0]!.id).toBe(approved[1]!.id);

    await prisma.customerLedgerEntry.create({ data: { ...scope, stationId: alternate.id, type: 'RECEIPT', amount: -500,
      description: 'Payment at another station', createdById: owner.id } });
    await deliverWithReviewedFixtures();
    const readJob = (id: string) => prisma.ownerNotificationDelivery.findUniqueOrThrow({ where: { id } });
    expect(await readJob(approved[0]!.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'customer_balance_or_recipient_changed' });
    await expect(approveCustomerReminder(scope, owner.id, draft.snapshot)).rejects.toThrow('changed');
    expect(sent).not.toHaveBeenCalled();

    await prisma.customerLedgerEntry.update({ where: { id: debit.id }, data: { disputedAt: past } });
    await expect(previewCustomerReminder(scope)).rejects.toThrow('disputed');
    await prisma.customerLedgerEntry.update({ where: { id: debit.id }, data: { disputedAt: null } });
    const corrected = await previewCustomerReminder(scope);
    expect(corrected.overdueAmount).toBe(2000);
    const paused = await approveCustomerReminder(scope, owner.id, corrected.snapshot);
    await saveReminderProfile(organizationId, customer.id, owner.id, { ...consent, recordConsent: false, paused: true });
    await deliverWithReviewedFixtures();
    expect(await readJob(paused.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'customer_paused' });

    const hour = indiaParts(new Date()).hour;
    expect(await scheduleCustomerReminders(hour, new Date())).toBe(0);
    await saveReminderProfile(organizationId, customer.id, owner.id, { ...consent, destination: '919000000002', recordConsent: false });
    await expect(previewCustomerReminder(scope)).rejects.toThrow('consent');
    await saveReminderProfile(organizationId, customer.id, owner.id, { ...consent, destination: '919000000002' });
    await prisma.ownerNotificationSettings.create({ data: { organizationId, customerReminderScheduled: true, customerReminderHour: hour } });
    expect(await scheduleCustomerReminders(hour, new Date())).toBe(1);
    await prisma.ownerNotificationSettings.update({ where: { organizationId }, data: { customerReminderScheduled: false } });
    await deliverWithReviewedFixtures();
    expect(await prisma.ownerNotificationDelivery.count({ where: { organizationId, customerId: customer.id, suppressionReason: 'scheduled_policy_changed' } })).toBe(1);

    const finalDraft = await previewCustomerReminder(scope);
    const delivery = await approveCustomerReminder(scope, owner.id, finalDraft.snapshot);
    await Promise.all([deliverWithReviewedFixtures(), deliverWithReviewedFixtures()]);
    expect(await readJob(delivery.id)).toMatchObject({ status: 'ACCEPTED', attempts: 1 });
    expect(sent).toHaveBeenCalledTimes(1);
    await expect(previewCustomerReminder(scope)).rejects.toThrow('recent reminder');

    const paidCustomer = await prisma.customer.create({ data: { organizationId, name: 'Paid customer', code: 'PAID', type: 'CREDIT' } });
    const paidScope = { ...scope, customerId: paidCustomer.id };
    await saveReminderProfile(organizationId, paidCustomer.id, owner.id, { ...consent, destination: '919000000003' });
    await prisma.customerLedgerEntry.createMany({ data: [
      { ...paidScope, type: 'SALE', amount: 100, description: 'Older purchase', occurredAt: past, dueDate: past, createdById: owner.id },
      { ...paidScope, type: 'SALE', amount: 250, description: 'Later purchase', occurredAt: past, dueDate: new Date(past.getTime() + 86_400_000), createdById: owner.id },
    ] });
    const beforePayment = await previewCustomerReminder(paidScope);
    expect(beforePayment.overdueAmount).toBe(350);
    const pending = await approveCustomerReminder(paidScope, owner.id, beforePayment.snapshot);
    await prisma.customerLedgerEntry.create({ data: { ...paidScope, type: 'RECEIPT', amount: -350, description: 'Paid in full', createdById: owner.id } });
    await deliverWithReviewedFixtures();
    expect(await readJob(pending.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'no_verified_overdue_balance' });
    expect(sent).toHaveBeenCalledTimes(1);

    // Leave the fixture safe to rerun in the same isolated database.
    await prisma.ownerNotificationSettings.update({ where: { organizationId }, data: { customerReminderScheduled: false } });
  }, 30_000);

  it('previews in shadow, sends the exact approved owner message, and pauses before dispatch', async () => {
    const organization = await prisma.organization.create({ data: { name: 'Controlled rollout fixture' } });
    const organizationId = organization.id;
    const actor = await prisma.user.create({ data: { organizationId, name: 'Fixture Owner', email: `${organizationId}@example.test`, passwordHash: 'test', role: 'OWNER' } });
    await prisma.ownerNotificationSettings.create({ data: { organizationId, whatsappNumber: '919000000005', whatsappOptedIn: true } });
    await prisma.whatsAppRollout.update({ where: { id: 'global' }, data: {
      stage: 'SHADOW', paused: true, organizationIds: [], enabledCategories: [],
    } });
    const payloads = vi.fn();
    const providerId = randomUUID();
    let changeTemplate = false;
    let pauseDuringProviderCheck = false;
    const meta = vi.fn(async (url: string | URL, request?: RequestInit) => {
      const name = new URL(url).searchParams.get('name');
      if (name) {
        if (pauseDuringProviderCheck) await pauseRollout(actor.id);
        const template = providerTemplate(name);
        if (changeTemplate) template.components[0]!.text = 'Changed template text. {{1}}';
        return Response.json({ data: [template] });
      }
      payloads(JSON.parse(String(request?.body)));
      return Response.json({ messages: [{ id: providerId }] });
    });
    vi.stubGlobal('fetch', meta);

    const queue = (eventKey: string) => queueOwnerWhatsApp({
      organizationId, eventKey, type: 'DAILY_SUMMARY', recordType: 'CORE_DAILY_SUMMARY',
      message: 'Fixture', guard: { status: 'COMPLETE' }, destination: '919000000005', optedIn: true,
    });
    const load = (id: string) => prisma.ownerNotificationDelivery.findUniqueOrThrow({ where: { id } });
    const switchTo = async (stage: 'INTERNAL' | 'PILOT' | 'EXPANDED', includeCustomer = false) => updateRollout({
      stage, paused: false, version: (await readRollout()).version, organizationIds: [organizationId],
      enabledCategories: includeCustomer ? ['DAILY_SUMMARY', 'CUSTOMER_CREDIT_REMINDER'] : ['DAILY_SUMMARY'],
    }, actor.id);
    const job = await queue('first');
    await drainWhatsAppQueue();
    const preview = await load(job.id);
    expect(preview).toMatchObject({ status: 'PENDING', rolloutHold: 'shadow_mode', attempts: 0, previewTemplate: 'fuelnerve_daily_operations_v1' });
    expect(preview.previewBody).toContain('No sales recorded for this date');
    expect(meta).not.toHaveBeenCalled();
    await expect(switchTo('PILOT')).rejects.toMatchObject({ code: 'INTERNAL_DELIVERY_UNVERIFIED' });
    await expect(approveRolloutPreview(organizationId, job.id, 'wrong-hash', actor.id)).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    await approveRolloutPreview(organizationId, job.id, preview.previewHash!, actor.id);
    await switchTo('INTERNAL');
    await drainWhatsAppQueue();
    expect(payloads).toHaveBeenCalledOnce();
    const sent = payloads.mock.calls[0]![0];
    expect(sent.to).toBe('919000000005');
    expect(operationalBodies[sent.template.name]!.replace('{{1}}', () => sent.template.components[0].parameters[0].text)).toBe(preview.previewBody);
    expect(await load(job.id)).toMatchObject({ status: 'ACCEPTED', rolloutStage: 'INTERNAL' });
    await expect(switchTo('PILOT')).rejects.toMatchObject({ code: 'INTERNAL_DELIVERY_UNVERIFIED' });

    await processWhatsAppWebhook({
      object: 'whatsapp_business_account', entry: [{ id: 'test-waba', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'test-phone' }, statuses: [{ id: providerId, status: 'delivered' }],
      } }] }],
    });
    expect(await load(job.id)).toMatchObject({ status: 'DELIVERED' });
    await expect(switchTo('PILOT', true)).rejects.toMatchObject({ code: 'PILOT_DELIVERY_UNVERIFIED' });
    await switchTo('PILOT');

    const next = await queue('next');
    await drainWhatsAppQueue();
    const nextPreview = await load(next.id);
    await approveRolloutPreview(organizationId, next.id, nextPreview.previewHash!, actor.id);
    pauseDuringProviderCheck = true;
    await drainWhatsAppQueue();
    expect(await load(next.id)).toMatchObject({ status: 'PENDING', rolloutHold: 'delivery_paused', attempts: 0, approvedPreviewHash: nextPreview.previewHash });
    expect(payloads).toHaveBeenCalledOnce();
    expect((await readRollout()).paused).toBe(true);
    expect(await prisma.whatsAppRolloutAudit.count({ where: { actorId: actor.id, action: 'PAUSE_ALL' } })).toBe(1);

    await switchTo('PILOT');
    pauseDuringProviderCheck = false;
    changeTemplate = true;
    await approveRolloutPreview(organizationId, next.id, nextPreview.previewHash!, actor.id);
    await drainWhatsAppQueue();
    expect(await load(next.id)).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'provider_template_changed' });
    expect(payloads).toHaveBeenCalledOnce();
  }, 30_000);

});
