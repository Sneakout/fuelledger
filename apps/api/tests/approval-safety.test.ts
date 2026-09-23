import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';

const tx = {
  approvalRequest: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  product: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  station: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  productPurchasePrice: { findFirst: vi.fn(), upsert: vi.fn() },
  productSellingPrice: { findFirst: vi.fn(), upsert: vi.fn() },
  ownerAlert: { updateMany: vi.fn() },
};

const transaction = vi.fn(async (work: (client: typeof tx) => unknown) => work(tx));
const bookStockAt = vi.fn();

vi.mock('../src/lib/prisma.js', () => ({ prisma: { ...tx, $transaction: transaction } }));
vi.mock('../src/lib/stock.js', () => ({ bookStockAt }));
const notifyProductPriceApprovalRequired = vi.fn();
vi.mock('../src/modules/notifications/service.js', () => ({ notifyApprovalRequired: vi.fn(), notifyProductPriceApprovalRequired }));

describe('approval safety boundary', async () => {
  const { decide, requestProductPriceChangeFromInvoice } = await import('../src/modules/approvals/service.js');

  beforeEach(() => {
    vi.clearAllMocks();
    const base = {
      id: 'approval-1',
      organizationId: 'org-1',
      stationId: 'station-1',
      actionType: 'INVENTORY_ADJUSTMENT',
      status: 'PENDING',
      reason: 'Check the physical reading',
      payload: { stationId: 'station-1', productId: 'product-1', quantityDelta: -20, notes: 'Verified request' },
      evidence: { bookStockBefore: 100 },
      requestedAt: new Date('2026-09-10T08:00:00.000Z'),
      requestedBy: { id: 'manager-1', name: 'Manager', role: 'MANAGER' },
      station: { id: 'station-1', name: 'Station C', code: 'C' },
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      executionId: null,
      executionType: null,
      executedAt: null,
      version: 1,
    };
    tx.approvalRequest.findFirst.mockResolvedValue(base);
    tx.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.approvalRequest.findUniqueOrThrow.mockResolvedValue({
      ...base,
      status: 'APPROVED',
      decidedAt: new Date('2026-09-10T09:00:00.000Z'),
      decidedBy: { id: 'owner-1', name: 'Owner', role: 'OWNER' },
      version: 2,
    });
    tx.ownerAlert.updateMany.mockResolvedValue({ count: 1 });
    tx.productPurchasePrice.findFirst.mockResolvedValue(null);
    tx.productSellingPrice.findFirst.mockResolvedValue(null);
    tx.productPurchasePrice.upsert.mockResolvedValue({});
    tx.productSellingPrice.upsert.mockResolvedValue({});
    tx.product.update.mockResolvedValue({});
    notifyProductPriceApprovalRequired.mockResolvedValue(undefined);
    bookStockAt.mockResolvedValue(100);
  });

  it('records the exact approval without executing the inventory change', async () => {
    const result = await decide('org-1', 'owner-1', 'approval-1', { decision: 'APPROVE', note: '', version: 1 }, ['station-1']);

    expect(tx.approvalRequest.updateMany).toHaveBeenCalledOnce();
    const update = tx.approvalRequest.updateMany.mock.calls[0]![0];
    expect(update.where).toMatchObject({ id: 'approval-1', status: 'PENDING', version: 1 });
    expect(update.data).toMatchObject({ status: 'APPROVED', decidedById: 'owner-1' });
    expect(update.data).not.toHaveProperty('executedAt');
    expect(update.data).not.toHaveProperty('executionType');
    expect(update.data).not.toHaveProperty('executionId');
    expect(result.execution).toBeNull();
  });

  it('rejects approval when the displayed stock evidence has changed', async () => {
    bookStockAt.mockResolvedValue(99);

    await expect(decide('org-1', 'owner-1', 'approval-1', { decision: 'APPROVE', note: '', version: 1 }, ['station-1']))
      .rejects.toMatchObject<AppError>({ status: 409, code: 'APPROVAL_EVIDENCE_CHANGED' });
    expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
  });

  it('writes purchase and owner-confirmed selling price histories together', async () => {
    const purchaseEffectiveFrom = '2026-09-13T00:00:00.000Z';
    tx.approvalRequest.findFirst.mockResolvedValue({
      id: 'approval-price', organizationId: 'org-1', stationId: 'station-1', actionType: 'PRODUCT_PRICE_CHANGE', status: 'PENDING',
      reason: 'HSD purchase price changed.',
      payload: { stationId: 'station-1', productId: 'product-1', invoiceId: 'invoice-1', invoiceNumber: 'INV-1', proposedPurchasePrice: 82.5, suggestedSellingPrice: 98.5, purchaseEffectiveFrom },
      evidence: { currentPurchasePrice: 80, proposedPurchasePrice: 82.5, currentSellingPrice: 96, suggestedSellingPrice: 98.5 },
      requestedAt: new Date(), requestedBy: { id: 'manager-1', name: 'Manager', role: 'MANAGER' }, station: { id: 'station-1', name: 'Station C', code: 'C' },
      decidedAt: null, decidedBy: null, decisionNote: null, executionId: null, executionType: null, executedAt: null, version: 1,
    });
    tx.product.findFirst.mockResolvedValue({ id: 'product-1', purchasePrice: 80, sellingPrice: 96 });

    await decide('org-1', 'owner-1', 'approval-price', {
      decision: 'APPROVE', note: 'Confirmed', version: 1, sellingPrice: 99, sellingPriceEffectiveFrom: '2026-09-13T00:00:00.000Z',
    }, ['station-1']);

    expect(tx.productPurchasePrice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_effectiveFrom: { productId: 'product-1', effectiveFrom: new Date(purchaseEffectiveFrom) } },
    }));
    expect(tx.productPurchasePrice.upsert).toHaveBeenCalledTimes(2);
    expect(tx.productPurchasePrice.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      create: expect.objectContaining({ price: expect.anything() }),
    }));
    expect(tx.productSellingPrice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_effectiveFrom: { productId: 'product-1', effectiveFrom: new Date('2026-09-13T00:00:00.000Z') } },
    }));
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-1' }, data: { purchasePrice: expect.anything(), sellingPrice: expect.anything() },
    }));
    expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ executionType: 'PRODUCT_PRICE_CHANGE', executionId: 'product-1' }),
    }));
  });

  it('rejects a stale price request without writing either price', async () => {
    tx.approvalRequest.findFirst.mockResolvedValue({
      id: 'approval-price', organizationId: 'org-1', stationId: 'station-1', actionType: 'PRODUCT_PRICE_CHANGE', status: 'PENDING', reason: 'Price changed',
      payload: { productId: 'product-1', proposedPurchasePrice: 82.5, purchaseEffectiveFrom: '2026-09-13T00:00:00.000Z' },
      evidence: { currentPurchasePrice: 80, currentSellingPrice: 96 }, requestedAt: new Date(), requestedBy: { id: 'manager-1', name: 'Manager', role: 'MANAGER' },
      station: { id: 'station-1', name: 'Station C', code: 'C' }, decidedAt: null, decidedBy: null, decisionNote: null, executionId: null, executionType: null, executedAt: null, version: 1,
    });
    tx.product.findFirst.mockResolvedValue({ id: 'product-1', purchasePrice: 81, sellingPrice: 96 });

    await expect(decide('org-1', 'owner-1', 'approval-price', {
      decision: 'APPROVE', note: '', version: 1, sellingPrice: 99, sellingPriceEffectiveFrom: '2026-09-13T00:00:00.000Z',
    }, ['station-1'])).rejects.toMatchObject<AppError>({ status: 409, code: 'APPROVAL_EVIDENCE_CHANGED' });
    expect(tx.productPurchasePrice.upsert).not.toHaveBeenCalled();
    expect(tx.productSellingPrice.upsert).not.toHaveBeenCalled();
  });

  it('creates independent MS and HSD price decisions from one invoice', async () => {
    tx.product.findMany.mockResolvedValue([
      { id: 'hsd', name: 'High Speed Diesel', code: 'HSD', unit: 'LITRE', purchasePrice: 80, sellingPrice: 96 },
      { id: 'ms', name: 'Motor Spirit', code: 'MS', unit: 'LITRE', purchasePrice: 78, sellingPrice: 94 },
    ]);
    tx.station.findFirst.mockResolvedValue({ id: 'station-1', name: 'Saleema Petroleum', code: 'SALEEMA' });
    tx.user.findFirst.mockResolvedValue({ id: 'manager-1', name: 'Manager', role: 'MANAGER' });
    tx.approvalRequest.findUnique.mockResolvedValue(null);
    tx.approvalRequest.create.mockImplementation(async ({ data }: any) => ({
      ...data, id: `approval-${data.payload.productId}`, status: 'PENDING', requestedAt: new Date(),
      requestedBy: { id: 'manager-1', name: 'Manager', role: 'MANAGER' }, station: { id: 'station-1', name: 'Saleema Petroleum', code: 'SALEEMA' },
      decidedAt: null, decidedBy: null, decisionNote: null, executionId: null, executionType: null, executedAt: null, version: 1,
    }));

    const approvals = await requestProductPriceChangeFromInvoice('org-1', 'manager-1', {
      id: 'invoice-1', invoiceNumber: 'IOCL-1', invoiceDate: new Date('2026-09-13T00:00:00.000Z'), stationId: 'station-1',
    }, {
      stationId: 'station-1', supplierId: 'supplier-1', invoiceNumber: 'IOCL-1', invoiceDate: '2026-09-13T00:00:00.000Z', dueDate: '2026-09-13T00:00:00.000Z',
      invoiceTotal: 1_707_304.764, taxAmount: 155_209.524, receiveNow: false, paidNow: false,
      lines: [
        { productId: 'hsd', description: 'HSD-BSVI', quantity: 12, sourceUnit: 'KL', unitCost: 79_341.27, taxRate: 0 },
        { productId: 'ms', description: 'MS-BSVI', quantity: 8, sourceUnit: 'KL', unitCost: 75_000, taxRate: 0 },
      ],
    });

    expect(approvals).toHaveLength(2);
    expect(tx.approvalRequest.create).toHaveBeenCalledTimes(2);
    const created = tx.approvalRequest.create.mock.calls.map(call => call[0].data);
    expect(created.find(row => row.payload.productId === 'hsd')?.payload.proposedPurchasePrice).toBe(87.28);
    expect(created.find(row => row.payload.productId === 'ms')?.payload.proposedPurchasePrice).toBe(82.5);
    expect(notifyProductPriceApprovalRequired).toHaveBeenCalledTimes(2);
  });
});
