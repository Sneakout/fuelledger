import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PurchaseInvoiceUpdateInput } from '@fuelledger/shared';
const db = vi.hoisted(() => ({ purchaseInvoice: { findFirst: vi.fn() }, $transaction: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../src/modules/accounting/service.js', () => ({ postJournal: vi.fn(), collectionAccount: () => '1000' }));
import { updateInvoice } from '../src/modules/purchases/service.js';
const d = (n: number) => new Prisma.Decimal(n);
const input = { version: 0, invoiceNumber: 'I1', invoiceDate: '2026-01-02T00:00:00.000Z', dueDate: '2026-01-05T00:00:00.000Z', correctionReason: 'Correct invoice date', refreshPrices: false, markPaid: false } as PurchaseInvoiceUpdateInput;
let tx: any;
beforeEach(() => {
  vi.clearAllMocks();
  db.purchaseInvoice.findFirst.mockResolvedValue({ id: 'i', stationId: 's', invoiceNumber: 'I1', invoiceDate: new Date('2026-01-01'), supplier: { name: 'Supplier', paymentTerms: 3 }, status: 'PAID', subtotal: d(100), taxAmount: d(0), totalAmount: d(100), notes: null, payments: [{ id: 'p', amount: d(100), origin: 'RECORDED_PAYMENT' }], lines: [{ id: 'l', quantity: d(1), unitCost: d(100), taxRate: d(0), description: 'Oil', product: null }], receipt: { id: 'r', receivedAt: new Date('2026-01-03'), lines: [] } });
  tx = { purchaseInvoice: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn(), findUniqueOrThrow: vi.fn() }, purchaseInvoiceCorrection: { create: vi.fn() }, journal: { updateMany: vi.fn() }, purchaseReceipt: { update: vi.fn() }, inventoryLedger: { updateMany: vi.fn() }, supplierPayment: { update: vi.fn(), create: vi.fn() } };
  db.$transaction.mockImplementation(async fn => fn(tx));
});
describe('safe invoice correction', () => {
  it('blocks a reduction below payments without changing money', async () => {
    const invoice = await db.purchaseInvoice.findFirst();
    invoice.lines[0].unitCost = d(50);
    invoice.receipt = null;
    await expect(updateInvoice('o', 'u', 'i', { ...input, refreshPrices: true })).rejects.toMatchObject({ code: 'INVOICE_TOTAL_BELOW_PAYMENTS' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('leaves an increased invoice partly paid, preserving the payment', async () => {
    const invoice = await db.purchaseInvoice.findFirst();
    invoice.lines[0].unitCost = d(200);
    invoice.receipt = null;
    tx.purchaseInvoiceLine = { update: vi.fn() };
    tx.journal.findFirst = vi.fn().mockResolvedValue(null);
    await updateInvoice('o', 'u', 'i', { ...input, refreshPrices: true });
    expect(tx.purchaseInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PART_PAID', totalAmount: d(200) }) }));
    expect(tx.supplierPayment.update).not.toHaveBeenCalled();
    expect(tx.supplierPayment.create).not.toHaveBeenCalled();
  });
  it('preserves real payments and receipt date while auditing date changes', async () => {
    await updateInvoice('o', 'u', 'i', input);
    expect(tx.supplierPayment.update).not.toHaveBeenCalled();
    expect(tx.supplierPayment.create).not.toHaveBeenCalled();
    expect(tx.purchaseReceipt.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { referenceNo: 'I1' } });
    expect(tx.inventoryLedger.updateMany).not.toHaveBeenCalled();
    expect(tx.purchaseInvoiceCorrection.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ correctedById: 'u', reason: input.correctionReason, beforeLines: expect.objectContaining({ invoiceDate: '2026-01-01T00:00:00.000Z' }), afterLines: expect.objectContaining({ invoiceDate: input.invoiceDate }) }) }));
  });
  it('rejects a stale editor before any correction is written', async () => {
    tx.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateInvoice('o', 'u', 'i', input)).rejects.toMatchObject({ code: 'INVOICE_CHANGED' });
    expect(tx.purchaseInvoiceCorrection.create).not.toHaveBeenCalled();
    expect(tx.purchaseReceipt.update).not.toHaveBeenCalled();
  });
  it('changes receipt and movement dates only on explicit request', async () => {
    await updateInvoice('o', 'u', 'i', { ...input, receivedAt: input.invoiceDate });
    expect(tx.inventoryLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { occurredAt: new Date(input.invoiceDate) } }));
  });
});
