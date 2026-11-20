import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const configuration = vi.hoisted(() => ({ EMAIL_DELIVERY_ENABLED: true, EMAIL_ROLLOUT_ORGANIZATION_IDS: '', SMTP2GO_API_KEY: 'isolated-test-only-key', EMAIL_FROM: 'hello@mindvector.tech', APP_URL: 'https://fuel.mindvector.tech' }));
vi.mock('../src/config/env.js', () => ({ env: configuration, apnsConfigured: false }));
vi.mock('../src/lib/prisma.js', async () => { const { PrismaClient } = await import('@prisma/client'); return { prisma: new PrismaClient({ datasourceUrl: process.env.EMAIL_AUTOMATION_TEST_DATABASE_URL ?? 'postgresql://unused' }) }; });
import { prisma } from '../src/lib/prisma.js';
import { enqueueReview } from '../src/modules/nerve/review-events.js';
import { prepareAgentEmails, scheduleOwnerEmails } from '../src/modules/notifications/email-scheduler.js';
import { drainEmailQueue, queueEmailWelcome } from '../src/modules/notifications/email-queue.js';
import { indiaParts } from '../src/lib/india-time.js';
const suite = process.env.EMAIL_AUTOMATION_TEST_DATABASE_URL ? describe : describe.skip;
suite('owner email automation on isolated PostgreSQL', () => {
 afterAll(async () => { vi.unstubAllGlobals(); await prisma.$disconnect(); });
 it('applies the additive migration without changing existing WhatsApp progress', async () => {
  // The runner requires an isolated localhost schema. Exercise the actual migration SQL.
  await prisma.$executeRawUnsafe('DROP INDEX "nerve_review_email_idx"');
  await prisma.$executeRawUnsafe('ALTER TABLE "nerve_review_jobs" DROP COLUMN "emailHandledAt", DROP COLUMN "emailNextAt"');
  const id = randomUUID(); const prior = new Date('2026-11-19T01:00:00Z');
  await prisma.$executeRaw`INSERT INTO "nerve_review_jobs" (id,"eventKey","organizationId","stationId","agentKey","eventType","resourceId","occurredAt","notificationHandledAt") VALUES (${id}, ${id}, 'migration-fixture', 'migration-station', 'inventory-watch', 'DAILY_REVIEW', 'tank', ${prior}, ${prior})`;
  const [before] = await prisma.$queryRaw<Array<{ notificationHandledAt: Date }>>`SELECT \"notificationHandledAt\" FROM \"nerve_review_jobs\" WHERE id = ${id}`;
  const sql = await readFile(new URL('../../../prisma/migrations/20261120190000_email_agent_dispatch/migration.sql', import.meta.url), 'utf8');
  for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
  const row = await prisma.nerveReviewJob.findUniqueOrThrow({ where: { id } });
  expect(row.notificationHandledAt).toEqual(before!.notificationHandledAt); expect(row.emailHandledAt).toBeInstanceOf(Date); expect(row.emailNextAt).toBeInstanceOf(Date);
 });

 it('isolates organizations and channels, deduplicates parallel ticks, and suppresses paid or opted-out stale messages', async () => {
  const now = new Date();
  const org = await prisma.organization.create({ data: { name: 'Email fixture', subscriptionActivatedAt: new Date(now.getTime() - 60_000), intelligenceEnabledAt: new Date(now.getTime() - 60_000) } });
  const other = await prisma.organization.create({ data: { name: 'Other organization', subscriptionActivatedAt: new Date(now.getTime() - 60_000), intelligenceEnabledAt: new Date(now.getTime() - 60_000) } });
  configuration.EMAIL_ROLLOUT_ORGANIZATION_IDS = org.id;
  const station = await prisma.station.create({ data: { organizationId: org.id, name: 'Email fixture station', code: 'TEST', addressLine1: 'Fixture', city: 'Test', state: 'Test', postalCode: '000000' } });
  const scope = { organizationId: org.id, stationId: station.id };
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: 'Fixture owner', email: `${org.id}@example.com`, passwordHash: 'test-only', role: 'OWNER', ownerEmailPreference: { create: { organizationId: org.id, enabled: true } } } });
  await prisma.ownerNotificationSettings.create({ data: { organizationId: org.id, dailySummaryHour: indiaParts(now).hour } });
  const product = await prisma.product.create({ data: { organizationId: org.id, name: 'HSD', code: 'HSD', category: 'FUEL', unit: 'LITRE', tankLinked: true } });
  const config = await prisma.stationConfiguration.create({ data: { stationId: station.id, version: 1 } });
  const tank = await prisma.tank.create({ data: { configurationId: config.id, productId: product.id, code: 'T1', nominalCapacity: 5000, workingCapacity: 5000, openingStock: 500, tankType: 'UNDERGROUND', dipMethod: 'MANUAL' } });
  const otherStation = await prisma.station.create({ data: { organizationId: other.id, name: 'Other station', code: 'TEST', addressLine1: 'Fixture', city: 'Test', state: 'Test', postalCode: '000000' } });
  await enqueueReview(prisma, { ...scope, type: 'DAILY_REVIEW', resourceId: tank.id, occurredAt: new Date() });
  await enqueueReview(prisma, { organizationId: other.id, stationId: otherStation.id, type: 'DAILY_REVIEW', resourceId: 'other', occurredAt: new Date() });
  await Promise.all([prepareAgentEmails(), prepareAgentEmails()]);
  expect(await prisma.ownerEmailDelivery.count({ where: { organizationId: org.id, type: 'LOW_STOCK' } })).toBe(1);
  const handled = await prisma.nerveReviewJob.findMany({ where: { ...scope, agentKey: 'inventory-watch' } });
  expect(handled[0]?.emailHandledAt).toBeInstanceOf(Date); expect(handled[0]?.notificationHandledAt).toBeNull();
  expect((await prisma.nerveReviewJob.findFirstOrThrow({ where: { organizationId: other.id } })).emailHandledAt).toBeNull();
  expect(await prisma.ownerNotificationDelivery.count({ where: { organizationId: org.id } })).toBe(0);
  expect(await prisma.ownerAlert.count({ where: { organizationId: org.id } })).toBe(0);
  const sender = vi.fn(async () => Response.json({ data: { succeeded: 1, failed: 0, email_id: randomUUID() } })); vi.stubGlobal('fetch', sender);
  await Promise.all([drainEmailQueue(), drainEmailQueue()]); expect(sender).toHaveBeenCalledTimes(1);
  const low = await prisma.ownerEmailDelivery.findFirstOrThrow({ where: { ...scope, type: 'LOW_STOCK' } }); expect(low.status).toBe('ACCEPTED'); expect(low.message).toContain('500 L book stock');

  const supplier = await prisma.supplier.create({ data: { organizationId: org.id, name: 'Fixture supplier', code: 'SUP' } });
  const invoice = await prisma.purchaseInvoice.create({ data: { ...scope, supplierId: supplier.id, invoiceNumber: 'INV-1', invoiceDate: now, dueDate: new Date(now.getTime() + 7 * 86_400_000), subtotal: 180000, totalAmount: 180000, createdById: owner.id,
   lines: { create: { productId: product.id, description: 'HSD', quantity: 3000, unitCost: 60, lineTotal: 180000 } } } });
  const receipt = await prisma.purchaseReceipt.create({ data: { ...scope, supplierName: supplier.name, invoiceId: invoice.id, createdById: owner.id, lines: { create: { productId: product.id, tankId: tank.id, quantity: 2000, unitCost: 60 } } } });
  await enqueueReview(prisma, { ...scope, type: 'RECEIPT_RECORDED', resourceId: receipt.id, occurredAt: receipt.receivedAt });
  await prepareAgentEmails();
  const queued = await prisma.ownerEmailDelivery.findFirstOrThrow({ where: { ...scope, type: 'PURCHASE_RECEIPT_SUMMARY' } });
  expect(queued.message).toContain('Partial receipt: HSD: 2,000 L received of 3,000 L invoiced'); expect(queued.message).toContain('Outstanding: ₹1,80,000.00');
  await prisma.supplierPayment.create({ data: { ...scope, supplierId: supplier.id, invoiceId: invoice.id, amount: 180000, paymentMethod: 'UPI', createdById: owner.id } });
  await drainEmailQueue(); expect(sender).toHaveBeenCalledTimes(1);
  expect((await prisma.ownerEmailDelivery.findUniqueOrThrow({ where: { id: queued.id } })).suppressionReason).toBe('source_changed');

  await Promise.all([scheduleOwnerEmails(now), scheduleOwnerEmails(now)]);
  expect(await prisma.ownerEmailDelivery.count({ where: { organizationId: org.id, type: 'DAILY_SUMMARY' } })).toBe(1);
  await prisma.ownerEmailPreference.update({ where: { ownerId: owner.id }, data: { enabled: false } });
  await drainEmailQueue(); expect(sender).toHaveBeenCalledTimes(1);
  expect((await prisma.ownerEmailDelivery.findFirstOrThrow({ where: { organizationId: org.id, type: 'DAILY_SUMMARY' } })).suppressionReason).toBe('email_or_category_disabled');

  // Same welcome identity survives worker retries and a parallel administrator request.
  await prisma.ownerEmailPreference.update({ where: { ownerId: owner.id }, data: { enabled: true } });
  await Promise.all([queueEmailWelcome(org.id), queueEmailWelcome(org.id)]);
  expect(await prisma.ownerEmailDelivery.count({ where: { organizationId: org.id, type: 'OWNER_WELCOME' } })).toBe(1);
  await Promise.all([drainEmailQueue(), drainEmailQueue()]); expect(sender).toHaveBeenCalledTimes(2);
  expect(await prisma.ownerEmailDelivery.count({ where: { organizationId: other.id } })).toBe(0);
 });
});
