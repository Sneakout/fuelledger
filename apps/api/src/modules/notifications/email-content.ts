import { type OwnerEmailDelivery } from '@prisma/client';
import { env } from '../../config/env.js';
import { indiaDate } from '../../lib/india-time.js';
import { prisma } from '../../lib/prisma.js';
import { readShiftMessageFacts } from './message-facts.js';
import { shiftMessage } from './agent-messages.js';
import { creditDeliverySnapshot } from './delivery-queue.js';
import { renderOwnerEmail, type ShiftEmailDetails } from './email-template.js';

/** The same scoped record enrichment powers Growth Desk preview and actual mail.
 * Never fetch shift personnel for a different email category. */
export async function prepareOwnerEmail(job: OwnerEmailDelivery, ownerName: string, stationName: string, now = new Date()) {
  const guard = job.guard as { sourceId?: string; version?: string; snapshot?: string; date?: string };
  let shift: ShiftEmailDetails | undefined;
  if (job.type === 'SHIFT_CLOSED_SUMMARY' && job.stationId && guard.sourceId) {
    const facts = await readShiftMessageFacts({ organizationId: job.organizationId, stationId: job.stationId }, guard.sourceId, now);
    if (!facts || facts.completeness !== 'COMPLETE' || !facts.closedAt || !facts.collections || facts.collections.reconciliationId !== guard.version || ![shiftMessage(facts), shiftMessage(facts, true)].includes(job.message.split('\n\nReview: ')[0] ?? '')) return null;
    const previous = await prisma.ownerEmailDelivery.findFirst({ where: {
      organizationId: job.organizationId, stationId: job.stationId, ownerId: job.ownerId, destination: job.destination, type: 'SHIFT_CLOSED_SUMMARY', status: 'ACCEPTED',
      eventKey: { startsWith: `shift-summary:${facts.shiftId}:`, not: job.eventKey }, createdAt: { lt: job.createdAt },
    }, orderBy: { acceptedAt: 'desc' }, select: { message: true } });
    shift = {
      number: facts.shiftNumber, openedAt: facts.openedAt, openingRecordedAt: facts.openingRecordedAt, closedAt: facts.closedAt, recordedAt: facts.closingRecordedAt, managerName: facts.managerName,
      staff: facts.assignedStaff,
      channels: facts.collections.channels.map(channel => ({ method: channel.paymentMethod,
        expected: channel.expectedAmount.toString(), adjustment: channel.adjustmentAmount.toString(), actual: channel.actualAmount.toString(), difference: channel.varianceAmount.toString() })),
      difference: facts.collections.difference.toString(),
      correction: /\bcorrection\b/i.test(job.message.split('\n')[0] ?? ''), previousMessage: previous?.message,
    };
  }
  if (job.type === 'OVERDUE_CUSTOMER') {
    const credit = await creditDeliverySnapshot(job.organizationId, now);
    if (!credit.facts.some(customer => customer.outstanding > 0) || !guard.snapshot || credit.snapshot !== guard.snapshot) return null;
  }
  return renderOwnerEmail({ type: job.type, message: job.message, ownerName, stationName,
    appUrl: env.APP_URL, sourceId: guard.sourceId, date: guard.date ?? indiaDate(job.createdAt), delayed: job.type === 'DAILY_SUMMARY' && (guard.date ?? indiaDate(job.createdAt)) < indiaDate(now), ...(shift ? { shift } : {}) });
}
