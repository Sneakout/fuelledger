import { NotificationDeliveryStatus, OwnerNotificationType, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

const pageSize = 20;
const cursorInput = z.string().cuid().optional();
const dateInput = z.iso.date().optional();
const searchInput = z.string().trim().max(100).optional();
export const ownerDirectoryInput = z.object({
  search: searchInput,
  cursor: cursorInput,
  ownerId: z.string().cuid().optional(),
});
export const deliveryInboxInput = z.object({
  view: z.enum(['attention', 'history']).default('history'),
  cursor: cursorInput,
  ownerId: z.string().cuid().optional(),
  search: searchInput,
  from: dateInput,
  to: dateInput,
  category: z.enum(OwnerNotificationType).optional(),
  status: z.enum(NotificationDeliveryStatus).optional(),
}).refine(input => !input.from || !input.to || input.from <= input.to, 'The end date must be on or after the start date.');

const indiaMidnight = (date: string) => new Date(`${date}T00:00:00+05:30`);
const dayMs = 86_400_000;

export async function adminWhatsAppOwners(input: z.infer<typeof ownerDirectoryInput>) {
  const ownerMatch = { role: 'OWNER' as const, email: { not: 'owner@fuelledger.local' } };
  const search: Prisma.OrganizationWhereInput = input.search ? {
    OR: [
      { name: { contains: input.search, mode: 'insensitive' } },
      { users: { some: { AND: [ownerMatch, { OR: [
        { name: { contains: input.search, mode: 'insensitive' } },
        { email: { contains: input.search, mode: 'insensitive' } },
      ] }] } } },
    ],
  } : {};
  const rows = await prisma.organization.findMany({
    where: input.ownerId ? { id: input.ownerId } : { users: { some: ownerMatch }, ...search },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: pageSize + 1,
    select: {
      id: true, name: true,
      users: { where: { role: 'OWNER' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1, select: { name: true, email: true } },
      notificationSettings: { select: { whatsappNumber: true, whatsappOptedIn: true } },
      notificationDeliveries: {
        where: { customerId: null, status: { in: ['DELIVERED', 'READ'] } },
        orderBy: { deliveredAt: { sort: 'desc', nulls: 'last' } }, take: 1,
        select: { deliveredAt: true, readAt: true },
      },
      _count: { select: { notificationDeliveries: { where: { status: 'FAILED' } } } },
    },
  });
  const page = rows.slice(0, pageSize);
  return {
    owners: page.map(row => ({
      id: row.id, name: row.name, owner: row.users[0] ?? null,
      notificationSettings: row.notificationSettings ?? { whatsappNumber: null, whatsappOptedIn: false },
      lastDeliveredAt: row.notificationDeliveries[0]?.deliveredAt ?? row.notificationDeliveries[0]?.readAt ?? null,
      failedCount: row._count.notificationDeliveries,
    })),
    nextCursor: rows.length > pageSize ? page.at(-1)!.id : null,
  };
}

export async function adminWhatsAppInbox(input: z.infer<typeof deliveryInboxInput>, now = new Date()) {
  const where: Prisma.OwnerNotificationDeliveryWhereInput = {
    ...(input.ownerId ? { organizationId: input.ownerId } : {}),
    ...(input.search ? { organization: { OR: [
      { name: { contains: input.search, mode: 'insensitive' } },
      { users: { some: { role: 'OWNER', OR: [
        { name: { contains: input.search, mode: 'insensitive' } },
        { email: { contains: input.search, mode: 'insensitive' } },
      ] } } },
    ] } } : {}),
    ...(input.category ? { type: input.category } : {}),
    ...(input.status ? { status: input.status } : {}),
    createdAt: {
      ...(input.from ? { gte: indiaMidnight(input.from) } : {}),
      ...(input.to ? { lt: new Date(indiaMidnight(input.to).getTime() + dayMs) } : {}),
    },
  };
  if (input.view === 'attention') {
    where.OR = [
      { status: 'FAILED' },
      { status: 'PENDING', createdAt: { gt: new Date(now.getTime() - dayMs) }, OR: [
        { rolloutHold: { notIn: ['preview_only'] } },
        { errorMessage: { not: null } },
        { previewHash: { not: null }, OR: [
          { approvedPreviewHash: null },
          { NOT: { approvedPreviewHash: { equals: prisma.ownerNotificationDelivery.fields.previewHash } } },
        ] },
      ] },
    ];
  }
  const rows = await prisma.ownerNotificationDelivery.findMany({
    where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: pageSize + 1,
    select: {
      id: true, organizationId: true, organization: { select: { name: true } },
      type: true, status: true, createdAt: true, rolloutHold: true, errorMessage: true, suppressionReason: true,
      previewHash: true, approvedPreviewHash: true,
    },
  });
  const page = rows.slice(0, pageSize);
  return {
    messages: page.map(({ previewHash, approvedPreviewHash, ...row }) => ({
      ...row, needsApproval: Boolean(previewHash && previewHash !== approvedPreviewHash),
    })),
    nextCursor: rows.length > pageSize ? page.at(-1)!.id : null,
  };
}
