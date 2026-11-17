import { createHash } from 'node:crypto';
import { Prisma, type OwnerNotificationType, type WhatsAppRollout } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export const stages = ['SHADOW', 'INTERNAL', 'PILOT', 'EXPANDED'] as const;
export const categories = ['LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY',
  'OVERDUE_CUSTOMER', 'DAILY_SUMMARY', 'CUSTOMER_CREDIT_REMINDER', 'SYSTEM_TEST'] as const;
const key = 'global';
const auditDetails = (value: unknown) => value as Prisma.InputJsonValue;
export const rolloutInput = z.object({
  stage: z.enum(stages), paused: z.boolean(), organizationIds: z.array(z.string().cuid()).max(250),
  enabledCategories: z.array(z.enum(categories)), version: z.number().int().nonnegative(),
}).superRefine((value, context) => {
  if (value.stage === 'INTERNAL' && new Set(value.organizationIds).size !== 1
    || value.stage === 'PILOT' && (value.organizationIds.length < 1 || value.organizationIds.length > 5)
    || value.stage === 'EXPANDED' && !value.organizationIds.length) {
    context.addIssue({ code: 'custom', path: ['organizationIds'], message: 'Choose one internal account, up to five pilot accounts, or at least one enrolled account for expanded delivery.' });
  }
  if (value.enabledCategories.includes('CUSTOMER_CREDIT_REMINDER') && !['PILOT', 'EXPANDED'].includes(value.stage)) {
    context.addIssue({ code: 'custom', path: ['enabledCategories'], message: 'Customer reminders can only be enabled during a pilot or expanded delivery.' });
  }
});

export const readRollout = () => prisma.whatsAppRollout.findUniqueOrThrow({ where: { id: key } });

export function rolloutHold(policy: WhatsAppRollout | null, organizationId: string, type: string) {
  if (!policy || policy.stage === 'SHADOW') return 'shadow_mode';
  if (policy.paused) return 'delivery_paused';
  if (!policy.organizationIds.includes(organizationId)) return 'account_not_enrolled';
  if (!policy.enabledCategories.includes(type)) return 'category_paused';
  if (type === 'CUSTOMER_CREDIT_REMINDER' && policy.stage === 'INTERNAL') return 'customer_reminders_paused';
  return null;
}

export function messageFingerprint(destination: string, sender: string | undefined, template: unknown) {
  return createHash('sha256').update(JSON.stringify([destination, sender, template])).digest('hex');
}

export async function checkLiveRollout(tx: Prisma.TransactionClient, organizationId: string, type: string) {
  // The administrative write locks this same row. Once a pause commits no new dispatch can be claimed.
  await tx.$queryRaw`SELECT id FROM whatsapp_rollout WHERE id = ${key} FOR SHARE`;
  const policy = await tx.whatsAppRollout.findUnique({ where: { id: key } });
  return { stage: policy?.stage ?? null, reason: rolloutHold(policy, organizationId, type) };
}

export async function updateRollout(input: z.infer<typeof rolloutInput>, actorId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM whatsapp_rollout WHERE id = ${key} FOR UPDATE`;
    const before = await tx.whatsAppRollout.findUniqueOrThrow({ where: { id: key } });
    if (before.version !== input.version) throw new AppError(409, 'ROLLOUT_CHANGED', 'Delivery settings changed. Refresh and try again.');
    const organizationIds = [...new Set(input.organizationIds)];
    const enabledCategories = [...new Set(input.enabledCategories)];
    if (!input.paused && input.stage !== 'SHADOW') {
      const enrolled = await tx.ownerNotificationSettings.count({ where: { organizationId: { in: organizationIds },
        whatsappOptedIn: true, whatsappNumber: { not: null } } });
      if (enrolled !== organizationIds.length) throw new AppError(409, 'ROLLOUT_OPT_IN_REQUIRED', 'Each enrolled organization needs an opted-in owner WhatsApp number.');
      const verified = (stage: string) => tx.ownerNotificationDelivery.findFirst({
        where: { rolloutStage: stage, status: { in: ['DELIVERED', 'READ'] }, type: { in: ['LOW_STOCK', 'SHIFT_CLOSED_SUMMARY', 'PURCHASE_RECEIPT_SUMMARY', 'OVERDUE_CUSTOMER', 'DAILY_SUMMARY'] } },
        select: { id: true },
      });
      if (input.stage === 'PILOT' && !await verified('INTERNAL')) {
        throw new AppError(409, 'INTERNAL_DELIVERY_UNVERIFIED', 'Confirm a real owner message delivered during the internal stage before opening the pilot.');
      }
      if ((input.stage === 'EXPANDED' || enabledCategories.includes('CUSTOMER_CREDIT_REMINDER')) && !await verified('PILOT')) {
        throw new AppError(409, 'PILOT_DELIVERY_UNVERIFIED', 'Confirm owner messages delivered during the pilot before expanding or enabling customer reminders.');
      }
    }
    const after = await tx.whatsAppRollout.update({ where: { id: key },
      data: { stage: input.stage, paused: input.paused, organizationIds, enabledCategories, version: { increment: 1 } } });
    await tx.whatsAppRolloutAudit.create({ data: { actorId, action: 'SET_ROLLOUT', details: auditDetails({ before, after }) } });
    if (!after.paused && after.stage !== 'SHADOW') {
      await tx.ownerNotificationDelivery.updateMany({
        where: { status: 'PENDING', organizationId: { in: organizationIds },
          type: { in: enabledCategories as OwnerNotificationType[] }, approvedPreviewHash: { not: null },
          rolloutHold: { in: ['shadow_mode', 'delivery_paused', 'account_not_enrolled', 'category_paused', 'preview_only'] } },
        data: { availableAt: new Date() },
      });
    }
    return after;
  });
}

export async function pauseRollout(actorId: string) {
  return prisma.$transaction(async tx => {
    const after = await tx.whatsAppRollout.update({ where: { id: key }, data: { paused: true, version: { increment: 1 } } });
    await tx.whatsAppRolloutAudit.create({ data: { actorId, action: 'PAUSE_ALL', details: auditDetails({ version: after.version }) } });
    return after;
  });
}

export async function approveRolloutPreview(organizationId: string, id: string, hash: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const updated = await tx.ownerNotificationDelivery.updateMany({
      where: { id, organizationId, previewHash: hash, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 86_400_000) } },
      data: { approvedPreviewHash: hash, availableAt: new Date() },
    });
    if (!updated.count) throw new AppError(409, 'PREVIEW_CHANGED', 'This preview changed or expired. Refresh before approving it.');
    await tx.whatsAppRolloutAudit.create({ data: { actorId, action: 'APPROVE_MESSAGE', details: { id, organizationId, hash } } });
  });
}
