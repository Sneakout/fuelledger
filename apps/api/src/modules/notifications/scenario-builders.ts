import { ownerNotificationPacketSchema, type OwnerNotificationPacket } from '@fuelledger/shared';

export type NotificationFacts = Omit<OwnerNotificationPacket, 'schemaVersion' | 'responsibleAgent'>;
export type DeterministicScenario = Readonly<{ title: string; sentence: string; facts: NotificationFacts }>;
type Station = OwnerNotificationPacket['station'];
type Product = NonNullable<OwnerNotificationPacket['product']>;
type Evidence = OwnerNotificationPacket['evidence'];

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const moneyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

function date(value: Date) { return dateFormatter.format(value); }
function money(value: number) { return moneyFormatter.format(value); }
function quantity(value: number, unit: string) { return `${numberFormatter.format(value)} ${unit}`; }
function daysBetween(earlier: Date, later: Date) { return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 86_400_000)); }
function plural(value: number, singular: string, pluralForm = singular + 's') { return `${value} ${value === 1 ? singular : pluralForm}`; }
function readActions(evidence: Evidence, remind = false) {
  return ["ACKNOWLEDGE", ...(remind ? ["REMIND_LATER"] : []), "VIEW_RECORD", "GIVE_DETAILS", ...(evidence.length > 1 ? ["COMPARE_RECORDS"] : [])] as NotificationFacts['availableActions'];
}

function verified(title: string, sentence: string, facts: NotificationFacts): DeterministicScenario {
  const result = ownerNotificationPacketSchema.parse({ schemaVersion: 1, ...facts, responsibleAgent: null });
  const { schemaVersion: _schemaVersion, responsibleAgent: _responsibleAgent, ...validatedFacts } = result;
  return Object.freeze({ title, sentence, facts: validatedFacts });
}

type Common = { station: Station; evidence: Evidence; now?: Date };

export function buildShiftScenario(input: Common & {
  shiftId: string; shiftNumber: number; eventAt: Date; state: 'OPEN' | 'AWAITING_RECONCILIATION' | 'COLLECTION_VARIANCE';
  collectionVariance?: number; relatedCount?: number;
}) {
  const now = input.now ?? new Date();
  const waiting = daysBetween(input.eventAt, now);
  const name = `Shift ${input.shiftNumber}`;
  const base = input.state === 'OPEN'
    ? `${name} at ${input.station.name} opened on ${date(input.eventAt)} and is still open.`
    : input.state === 'AWAITING_RECONCILIATION'
      ? `${name} at ${input.station.name} closed on ${date(input.eventAt)} and is still waiting for reconciliation.`
      : `${name} at ${input.station.name} has a verified collection difference of ${money(Math.abs(input.collectionVariance ?? 0))}.`;
  const related = (input.relatedCount ?? 1) > 1 ? ` ${plural((input.relatedCount ?? 1) - 1, 'other shift')} also needs review.` : '';
  return verified(input.state === 'COLLECTION_VARIANCE' ? `${name} has a collection difference` : `${name} needs review`, base + related, {
    subjectName: name, recordType: input.state === 'OPEN' ? 'SHIFT' : 'SHIFT_RECONCILIATION', product: null,
    eventDate: input.eventAt.toISOString(), dueDate: null,
    amount: input.state === 'COLLECTION_VARIANCE' ? { value: Math.abs(input.collectionVariance ?? 0), currency: 'INR' } : null,
    quantity: null, status: input.state, daysOverdueOrWaiting: waiting, station: input.station, evidence: input.evidence,
    availableActions: readActions(input.evidence, true),
  });
}

export function buildStockScenario(input: Common & {
  tankId: string; tankCode: string; product: Product; measuredAt: Date; availableQuantity: number;
  state: 'EMPTY' | 'LOW_STOCK' | 'STOCK_VARIANCE'; physicalQuantity?: number; bookQuantity?: number;
  projectedRunoutAt?: Date | null; verifiedProjectionBasis?: string | null;
}) {
  const subject = `${input.product.code} tank ${input.tankCode}`;
  const projection = input.projectedRunoutAt
    ? ` FuelNerve projects the recorded stock will run out by ${date(input.projectedRunoutAt)}${input.verifiedProjectionBasis ? `, based on ${input.verifiedProjectionBasis}` : ''}.`
    : '';
  const sentence = input.state === 'EMPTY'
    ? `${subject} at ${input.station.name} had no available recorded stock at ${date(input.measuredAt)}.`
    : input.state === 'LOW_STOCK'
      ? `${subject} at ${input.station.name} had ${quantity(input.availableQuantity, 'L')} available on ${date(input.measuredAt)} and is below its configured stock limit.${projection}`
      : `${subject} at ${input.station.name} shows ${quantity(input.physicalQuantity ?? 0, 'L')} physically and ${quantity(input.bookQuantity ?? 0, 'L')} in the stock ledger.`;
  return verified(input.state === 'EMPTY' ? `${subject} is empty` : `${subject} needs review`, sentence, {
    subjectName: subject, recordType: 'TANK_STOCK_POSITION', product: input.product, eventDate: input.measuredAt.toISOString(), dueDate: input.projectedRunoutAt?.toISOString() ?? null,
    amount: null, quantity: { value: input.availableQuantity, unit: 'L' }, status: input.state, daysOverdueOrWaiting: null,
    station: input.station, evidence: input.evidence, availableActions: readActions(input.evidence),
  });
}

export function buildCustomerScenario(input: Common & {
  customerId: string; customerName: string; suppliedAt: Date; dueAt: Date; outstandingAmount: number;
  product?: Product | null; suppliedQuantity?: number | null;
}) {
  const now = input.now ?? new Date();
  const supplied = input.product && input.suppliedQuantity != null ? ` took ${quantity(input.suppliedQuantity, 'L')} of ${input.product.code}` : ' received fuel on credit';
  const timing = input.dueAt.getTime() < now.getTime() ? `was due on ${date(input.dueAt)} and is still unpaid` : `is due on ${date(input.dueAt)}`;
  return verified(`${input.customerName} has a payment due`, `${input.customerName}${supplied} on ${date(input.suppliedAt)}. ${money(input.outstandingAmount)} ${timing}.`, {
    subjectName: input.customerName, recordType: 'CUSTOMER_RECEIVABLE', product: input.product ?? null,
    eventDate: input.suppliedAt.toISOString(), dueDate: input.dueAt.toISOString(), amount: { value: input.outstandingAmount, currency: 'INR' },
    quantity: input.suppliedQuantity != null ? { value: input.suppliedQuantity, unit: 'L' } : null,
    status: input.dueAt.getTime() < now.getTime() ? 'OVERDUE' : 'PAYMENT_DUE', daysOverdueOrWaiting: daysBetween(input.dueAt, now),
    station: input.station, evidence: input.evidence, availableActions: readActions(input.evidence, true),
  });
}

export function buildSupplierScenario(input: Common & {
  supplierId: string; supplierName: string; receivedAt: Date; dueAt: Date; outstandingAmount: number;
  product?: Product | null; receivedQuantity?: number | null; invoiceNumber?: string | null;
}) {
  const now = input.now ?? new Date();
  const load = input.product && input.receivedQuantity != null ? `${quantity(input.receivedQuantity, 'L')} ${input.product.code} load` : 'fuel load';
  const invoice = input.invoiceNumber ? ` on invoice ${input.invoiceNumber}` : '';
  const timing = input.dueAt.getTime() < now.getTime() ? `was due on ${date(input.dueAt)} and remains unpaid` : `is due on ${date(input.dueAt)}`;
  return verified(`${input.supplierName} payment needs review`, `${input.supplierName}'s ${load} was unloaded at ${input.station.name} on ${date(input.receivedAt)}${invoice}. ${money(input.outstandingAmount)} ${timing}.`, {
    subjectName: input.supplierName, recordType: 'SUPPLIER_PAYABLE', product: input.product ?? null,
    eventDate: input.receivedAt.toISOString(), dueDate: input.dueAt.toISOString(), amount: { value: input.outstandingAmount, currency: 'INR' },
    quantity: input.receivedQuantity != null ? { value: input.receivedQuantity, unit: 'L' } : null,
    status: input.dueAt.getTime() < now.getTime() ? 'OVERDUE' : 'PAYMENT_DUE', daysOverdueOrWaiting: daysBetween(input.dueAt, now),
    station: input.station, evidence: input.evidence, availableActions: readActions(input.evidence, true),
  });
}

export function buildPurchaseScenario(input: Common & {
  supplierName: string; invoiceNumber: string; invoiceDate: Date; amount: number; product?: Product | null;
  purchasedQuantity?: number | null; finding: 'DUPLICATE_INVOICE' | 'RATE_CHANGED' | 'QUANTITY_MISMATCH' | 'RECEIPT_UNMATCHED'; verifiedDetail: string;
}) {
  const label = input.finding === 'DUPLICATE_INVOICE' ? 'may be duplicated' : input.finding === 'RATE_CHANGED' ? 'has a rate change' : input.finding === 'QUANTITY_MISMATCH' ? 'has a quantity difference' : 'has no matched receipt';
  return verified(`Invoice ${input.invoiceNumber} ${label}`, `${input.supplierName} invoice ${input.invoiceNumber}, dated ${date(input.invoiceDate)}, is for ${money(input.amount)}. ${input.verifiedDetail}`, {
    subjectName: `Invoice ${input.invoiceNumber}`, recordType: 'PURCHASE_INVOICE', product: input.product ?? null,
    eventDate: input.invoiceDate.toISOString(), dueDate: null, amount: { value: input.amount, currency: 'INR' },
    quantity: input.purchasedQuantity != null ? { value: input.purchasedQuantity, unit: 'L' } : null, status: input.finding,
    daysOverdueOrWaiting: null, station: input.station, evidence: input.evidence,
    availableActions: readActions(input.evidence),
  });
}

export function buildProfitScenario(input: Common & {
  periodLabel: string; calculatedAt: Date; netResult: number; verifiedChange?: number | null; verifiedContributor?: string | null;
}) {
  const change = input.verifiedChange == null ? '' : ` This is ${money(Math.abs(input.verifiedChange))} ${input.verifiedChange >= 0 ? 'higher' : 'lower'} than the comparison period.`;
  const contributor = input.verifiedContributor ? ` ${input.verifiedContributor}` : '';
  return verified(`Profit for ${input.periodLabel}`, `FuelNerve's posted journals show a net result of ${money(input.netResult)} for ${input.periodLabel}.${change}${contributor}`.trim(), {
    subjectName: `Profit for ${input.periodLabel}`, recordType: 'PROFIT_SUMMARY', product: null, eventDate: input.calculatedAt.toISOString(), dueDate: null,
    amount: { value: input.netResult, currency: 'INR' }, quantity: null, status: 'CALCULATED_FROM_POSTED_JOURNALS', daysOverdueOrWaiting: null,
    station: input.station, evidence: input.evidence, availableActions: readActions(input.evidence),
  });
}

export function buildMissingRecordScenario(input: Common & {
  subjectName: string; recordType: string; expectedAt: Date; product?: Product | null; missingDescription: string;
}) {
  const now = input.now ?? new Date();
  return verified(`${input.subjectName} is missing`, `${input.missingDescription} for ${input.subjectName} at ${input.station.name} has not been recorded. It was expected on ${date(input.expectedAt)}.`, {
    subjectName: input.subjectName, recordType: input.recordType, product: input.product ?? null, eventDate: input.expectedAt.toISOString(), dueDate: null,
    amount: null, quantity: null, status: 'RECORD_MISSING', daysOverdueOrWaiting: daysBetween(input.expectedAt, now), station: input.station,
    evidence: input.evidence, availableActions: readActions(input.evidence, true),
  });
}

export function buildApprovalScenario(input: Common & {
  approvalId: string; requesterName: string; requestedAt: Date; subjectName: string; product?: Product | null;
  quantityDelta?: number | null; exactAction: string; recordType?: 'INVENTORY_ADJUSTMENT_REQUEST' | 'PRODUCT_PRICE_CHANGE_REQUEST';
}) {
  const qty = input.quantityDelta == null ? '' : ` for a ${input.quantityDelta >= 0 ? '+' : ''}${quantity(input.quantityDelta, 'L')}`;
  return verified(`${input.requesterName} is waiting for your decision`, `${input.requesterName} requested ${input.exactAction}${qty} at ${input.station.name} on ${date(input.requestedAt)}. Nothing changes unless you approve this exact request.`, {
    subjectName: input.subjectName, recordType: input.recordType ?? 'INVENTORY_ADJUSTMENT_REQUEST', product: input.product ?? null,
    eventDate: input.requestedAt.toISOString(), dueDate: null, amount: null,
    quantity: input.quantityDelta != null ? { value: input.quantityDelta, unit: 'L' } : null, status: 'PENDING_OWNER_APPROVAL',
    daysOverdueOrWaiting: daysBetween(input.requestedAt, input.now ?? new Date()), station: input.station, evidence: input.evidence,
    availableActions: ['VIEW_RECORD', 'GIVE_DETAILS', 'APPROVE'],
  });
}

export function buildSecurityScenario(input: Common & {
  subjectName: string; eventAt: Date; event: 'NEW_SIGN_IN' | 'ACCESS_DENIED' | 'ACCESS_CHANGED' | 'SESSION_REVOKED'; verifiedDetail: string;
}) {
  return verified(`Security notice: ${input.subjectName}`, `${input.subjectName} was recorded on ${date(input.eventAt)}. ${input.verifiedDetail}`, {
    subjectName: input.subjectName, recordType: 'SECURITY_EVENT', product: null, eventDate: input.eventAt.toISOString(), dueDate: null,
    amount: null, quantity: null, status: input.event, daysOverdueOrWaiting: null, station: input.station, evidence: input.evidence,
    availableActions: readActions(input.evidence),
  });
}
