import type { CustomerInput, CustomerReceiptInput, VehicleInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { collectionAccount, postJournal } from '../accounting/service.js';

const customerInclude = { vehicles: { orderBy: { number: 'asc' as const } }, ledger: { orderBy: { occurredAt: 'desc' as const }, include: { station: { select: { name: true, code: true } }, sale: { include: { product: { select: { name: true, code: true, category: true } } } }, receipt: { select: { paymentMethod: true, referenceNo: true } } } } } as const;

function financials(customer: { creditLimit: Prisma.Decimal; ledger: Array<{ amount: Prisma.Decimal; dueDate: Date | null; occurredAt: Date }> }) {
  const outstanding = customer.ledger.reduce((sum, entry) => sum + Number(entry.amount), 0);
  const debits = customer.ledger.filter(entry => Number(entry.amount) > 0).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).map(entry => ({ ...entry, remaining: Number(entry.amount) }));
  let credits = Math.abs(customer.ledger.filter(entry => Number(entry.amount) < 0).reduce((sum, entry) => sum + Number(entry.amount), 0));
  for (const debit of debits) { const applied = Math.min(debit.remaining, credits); debit.remaining -= applied; credits -= applied; }
  const ageing = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
  const today = new Date();
  for (const debit of debits) { if (!debit.remaining) continue; const due = debit.dueDate ?? debit.occurredAt; const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000); if (days <= 0) ageing.current += debit.remaining; else if (days <= 30) ageing.days1to30 += debit.remaining; else if (days <= 60) ageing.days31to60 += debit.remaining; else if (days <= 90) ageing.days61to90 += debit.remaining; else ageing.days90plus += debit.remaining; }
  return { outstanding, availableCredit: Math.max(0, Number(customer.creditLimit) - Math.max(0, outstanding)), ageing };
}

export async function bootstrap(organizationId: string,stationIds?:string[]) {
  const [customers, stations] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: {...customerInclude,ledger:{...customerInclude.ledger,...(stationIds?{where:{stationId:{in:stationIds}}}:{})}} }),
    prisma.station.findMany({ where: { organizationId, active: true,...(stationIds?{id:{in:stationIds}}:{}) }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
  ]);
  return { customers: customers.map(customer => ({ ...customer, ...financials(customer) })), stations };
}

export async function createCustomer(organizationId: string, input: CustomerInput) {
  try { return await prisma.customer.create({ data: { organizationId, ...input, email: input.email || null, phone: input.phone || null, taxId: input.taxId || null, billingAddress: input.billingAddress || null }, include: customerInclude }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'CUSTOMER_CODE_EXISTS', 'That customer code is already in use.'); throw error; }
}

export async function updateCustomer(organizationId: string, id: string, input: CustomerInput) {
  const existing = await prisma.customer.findFirst({ where: { id, organizationId } }); if (!existing) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer account not found.');
  return prisma.customer.update({ where: { id }, data: { ...input, email: input.email || null, phone: input.phone || null, taxId: input.taxId || null, billingAddress: input.billingAddress || null }, include: customerInclude });
}

export async function addVehicle(organizationId: string, customerId: string, input: VehicleInput) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId, active: true } }); if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Choose an active customer account.');
  try { return await prisma.vehicle.create({ data: { customerId, number: input.number, label: input.label || null, active: input.active } }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'VEHICLE_EXISTS', 'That vehicle already belongs to this account.'); throw error; }
}

export async function receivePayment(organizationId: string, customerId: string, createdById: string, input: CustomerReceiptInput) {
  const [customer, station] = await Promise.all([prisma.customer.findFirst({ where: { id: customerId, organizationId, active: true } }), prisma.station.findFirst({ where: { id: input.stationId, organizationId, active: true } })]);
  if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Choose an active customer account.'); if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'Choose an active fuel station.');
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  return prisma.$transaction(async tx => { const receipt = await tx.customerReceipt.create({ data: { organizationId, stationId: input.stationId, customerId, amount: input.amount, paymentMethod: input.paymentMethod, referenceNo: input.referenceNo || null, notes: input.notes || null, receivedAt, createdById } }); await tx.customerLedgerEntry.create({ data: { organizationId, stationId: input.stationId, customerId, type: 'RECEIPT', amount: new Prisma.Decimal(input.amount).neg(), receiptId: receipt.id, description: `Receipt via ${input.paymentMethod}`, occurredAt: receivedAt, createdById } }); await postJournal(tx,{organizationId,stationId:input.stationId,createdById,journalDate:receivedAt,reference:`CR-${receipt.id.slice(-8)}`,description:`Receipt from ${customer.name}`,sourceType:'CUSTOMER_RECEIPT',sourceId:receipt.id,lines:[{account:collectionAccount(input.paymentMethod),debit:input.amount},{account:'1100',credit:input.amount}]}); return receipt; });
}
