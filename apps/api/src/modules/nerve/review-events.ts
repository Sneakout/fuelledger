import type { Prisma } from '@prisma/client';
import { hasActiveIntelligence } from '@fuelledger/shared';

const specialists = ['reconciliation-review', 'inventory-watch', 'credit-watch', 'purchase-check', 'profit-insight'] as const;
export const reviewAgents = [...specialists, 'business-assistant'] as const;
const routing = {
  SHIFT_CLOSED: ['reconciliation-review', 'inventory-watch', 'profit-insight'],
  SHIFT_RECONCILED: ['reconciliation-review', 'credit-watch', 'profit-insight'],
  RECEIPT_RECORDED: ['purchase-check', 'inventory-watch'],
  SALE_RECORDED: ['inventory-watch', 'credit-watch', 'profit-insight'],
  STOCK_ADJUSTED: ['inventory-watch', 'profit-insight'],
  CUSTOMER_PAYMENT: ['credit-watch'],
  INVOICE_CHANGED: ['purchase-check', 'inventory-watch', 'profit-insight'],
  SUPPLIER_PAYMENT: ['purchase-check'],
  DAILY_REVIEW: reviewAgents,
} as const satisfies Record<string, readonly typeof reviewAgents[number][]>;

type ReviewEvent = {
  type: keyof typeof routing;
  organizationId: string;
  stationId: string;
  resourceId: string;
  occurredAt: Date;
  version?: number;
};

export function reviewJobs(event: ReviewEvent): Prisma.NerveReviewJobCreateManyInput[] {
  return routing[event.type].map(agentKey => ({
    organizationId: event.organizationId,
    stationId: event.stationId,
    eventType: event.type,
    eventKey: `${event.type}:${event.resourceId}:${event.version ?? 0}`,
    resourceId: event.resourceId,
    occurredAt: event.occurredAt,
    agentKey,
  }));
}

export async function enqueueReview(tx: Pick<Prisma.TransactionClient, 'nerveReviewJob' | 'organization'>, event: ReviewEvent) {
  const plan = await tx.organization.findUnique({
    where: { id: event.organizationId },
    select: { intelligenceEnabledAt: true, intelligenceExpiresAt: true },
  });
  if (hasActiveIntelligence(plan)) await tx.nerveReviewJob.createMany({ data: reviewJobs(event), skipDuplicates: true });
}
