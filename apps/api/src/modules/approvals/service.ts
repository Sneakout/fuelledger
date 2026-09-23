import { Prisma, type ApprovalStatus } from '@prisma/client';
import { calculateLandedPurchasePrices, type InventoryAdjustmentInput, type PurchaseInvoiceInput } from '@fuelledger/shared';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { bookStockAt } from '../../lib/stock.js';
import { notifyApprovalRequired, notifyProductPriceApprovalRequired } from '../notifications/service.js';

const present = (row: any) => ({
  id: row.id,
  actionType: row.actionType,
  status: row.status,
  reason: row.reason,
  payload: row.payload,
  evidence: row.evidence,
  requestedAt: row.requestedAt,
  requestedBy: row.requestedBy,
  station: row.station,
  decidedAt: row.decidedAt,
  decidedBy: row.decidedBy,
  decisionNote: row.decisionNote,
  execution: row.executionId ? { type: row.executionType, id: row.executionId, executedAt: row.executedAt } : null,
  version: row.version,
});

const include = { requestedBy: { select: { id: true, name: true, role: true } }, decidedBy: { select: { id: true, name: true, role: true } }, station: { select: { id: true, name: true, code: true } } } as const;

export async function list(organizationId: string, permittedStationIds?: string[], status?: ApprovalStatus) {
  const rows = await prisma.approvalRequest.findMany({ where: { organizationId, ...(status ? { status } : {}), ...(permittedStationIds ? { stationId: { in: permittedStationIds } } : {}) }, include, orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }], take: 100 });
  return rows.map(present);
}

export async function requestInventoryAdjustment(organizationId: string, userId: string, requestKey: string, input: InventoryAdjustmentInput) {
  const previous = await prisma.approvalRequest.findUnique({ where: { organizationId_requestKey: { organizationId, requestKey } }, include });
  if (previous) return present(previous);
  const [station, product, tank, bookStock] = await Promise.all([
    prisma.station.findFirst({ where: { id: input.stationId, organizationId, active: true }, select: { id: true, name: true } }),
    prisma.product.findFirst({ where: { id: input.productId, organizationId, active: true, inventoryTracked: true }, select: { id: true, name: true, code: true, unit: true } }),
    input.tankId ? prisma.tank.findFirst({ where: { id: input.tankId, configuration: { stationId: input.stationId, station: { organizationId } } }, select: { id: true, code: true, productId: true } }) : Promise.resolve(null),
    bookStockAt(prisma, { organizationId, stationId: input.stationId, productId: input.productId, ...(input.tankId ? { tankId: input.tankId } : {}) }, new Date()),
  ]);
  if (!station || !product) throw new AppError(404, 'APPROVAL_TARGET_NOT_FOUND', 'The selected fuel station or product is no longer available.');
  if (input.tankId && (!tank || tank.productId !== product.id)) throw new AppError(400, 'TANK_MAPPING_INVALID', 'The selected tank does not hold this product.');
  const evidence = { product: { id: product.id, name: product.name, code: product.code, unit: product.unit }, tank: tank ? { id: tank.id, code: tank.code } : null, bookStockBefore: Number(bookStock), proposedBookStock: Number(bookStock) + input.quantityDelta, checkedAt: new Date().toISOString(), evidencePath: '/inventory' };
  try {
    const row = await prisma.approvalRequest.create({ data: { organizationId, stationId: input.stationId, actionType: 'INVENTORY_ADJUSTMENT', requestKey, requestedById: userId, reason: input.notes, payload: input as unknown as Prisma.InputJsonValue, evidence }, include });
    await notifyApprovalRequired({ id: row.id, organizationId, stationId: row.stationId, stationName: row.station.name, productCode: product.code, tankCode: tank?.code ?? null, quantityDelta: input.quantityDelta, requesterName: row.requestedBy.name, requestedAt: row.requestedAt }).catch(() => undefined);
    return present(row);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return present(await prisma.approvalRequest.findUniqueOrThrow({ where: { organizationId_requestKey: { organizationId, requestKey } }, include }));
  }
}

export async function requestProductPriceChangeFromInvoice(
  organizationId: string,
  userId: string,
  invoice: { id: string; invoiceNumber: string; invoiceDate: Date; stationId: string },
  input: PurchaseInvoiceInput,
) {
  if (input.invoiceTotal === undefined || !(input.invoiceTotal > 0)) return [];
  const linkedLines = input.lines.filter(line => line.productId && line.quantity > 0 && line.unitCost >= 0);
  if (linkedLines.length === 0) return [];
  const [products, station, requester] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: linkedLines.map(line => line.productId!) }, organizationId, active: true }, select: { id: true, name: true, code: true, unit: true, purchasePrice: true, sellingPrice: true } }),
    prisma.station.findFirst({ where: { id: invoice.stationId, organizationId, active: true }, select: { id: true, name: true, code: true } }),
    prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, name: true, role: true } }),
  ]);
  if (!station || !requester) return [];
  const landedPrices = calculateLandedPurchasePrices({
    invoiceTotal: input.invoiceTotal,
    ...(input.purchasePriceExcludedAmount !== undefined ? { excludedAmount: input.purchasePriceExcludedAmount } : {}),
    lines: linkedLines.map(line => {
      const product = products.find(candidate => candidate.id === line.productId);
      return {
        key: line.productId!,
        quantity: line.quantity,
        ...(line.sourceUnit ? { sourceUnit: line.sourceUnit } : {}),
        productUnit: product?.unit ?? "",
        baseAmount: line.quantity * line.unitCost,
        taxRate: line.taxRate,
      };
    }),
  });
  if (!landedPrices) return [];
  const approvals = [];
  for (const landed of landedPrices) {
    const product = products.find(candidate => candidate.id === landed.key);
    if (!product) continue;
    const quantity = landed.normalizedQuantity;
    const landedLineAmount = landed.taxInclusiveAmount;
    const proposedPurchasePrice = roundPrice(landed.unitPrice);
    const currentPurchasePrice = Number(product.purchasePrice);
    const currentSellingPrice = Number(product.sellingPrice);
    if (Math.abs(proposedPurchasePrice - currentPurchasePrice) < 0.01) continue;
    const proposedSellingPrice = roundPrice(Math.max(0, currentSellingPrice + proposedPurchasePrice - currentPurchasePrice));
    const payload = {
      stationId: station.id,
      productId: product.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      proposedPurchasePrice,
      suggestedSellingPrice: proposedSellingPrice,
      purchaseEffectiveFrom: invoice.invoiceDate.toISOString(),
    };
    const evidence = {
      product: { id: product.id, name: product.name, code: product.code, unit: product.unit },
      invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, totalAmount: landedLineAmount, quantity, sourceUnit: product.unit },
      currentPurchasePrice,
      proposedPurchasePrice,
      currentSellingPrice,
      suggestedSellingPrice: proposedSellingPrice,
      purchaseEffectiveFrom: invoice.invoiceDate.toISOString(),
      checkedAt: new Date().toISOString(),
      evidencePath: `/purchases?invoiceId=${encodeURIComponent(invoice.id)}`,
    };
    const requestKey = `invoice-price:${invoice.id}:${product.id}`;
    const previous = await prisma.approvalRequest.findUnique({ where: { organizationId_requestKey: { organizationId, requestKey } }, include });
    if (previous) { approvals.push(present(previous)); continue; }
    try {
      const row = await prisma.approvalRequest.create({
        data: { organizationId, stationId: station.id, actionType: 'PRODUCT_PRICE_CHANGE', requestKey, requestedById: userId, reason: `${product.code} purchase price changed on invoice ${invoice.invoiceNumber}. Confirm the new selling price and its effective date.`, payload, evidence },
        include,
      });
      await notifyProductPriceApprovalRequired({
        id: row.id, organizationId, stationId: station.id, stationName: station.name,
        productName: product.name, productCode: product.code,
        previousPurchasePrice: currentPurchasePrice, proposedPurchasePrice,
        proposedSellingPrice, invoiceNumber: invoice.invoiceNumber,
        requesterName: requester.name, requestedAt: row.requestedAt,
      }).catch(() => undefined);
      approvals.push(present(row));
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      approvals.push(present(await prisma.approvalRequest.findUniqueOrThrow({ where: { organizationId_requestKey: { organizationId, requestKey } }, include })));
    }
  }
  return approvals;
}

function roundPrice(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

type ApprovalDecisionInput = {
  decision: 'APPROVE' | 'REJECT';
  note: string;
  version: number;
  sellingPrice?: number | undefined;
  sellingPriceEffectiveFrom?: string | undefined;
};
type PriceChangePayload = { stationId: string; productId: string; invoiceId: string; invoiceNumber: string; proposedPurchasePrice: number; suggestedSellingPrice: number; purchaseEffectiveFrom: string };
type PriceChangeEvidence = { currentPurchasePrice: number; proposedPurchasePrice: number; currentSellingPrice: number; suggestedSellingPrice: number };

export async function decide(organizationId: string, ownerId: string, id: string, input: ApprovalDecisionInput, permittedStationIds?: string[]) {
  try {
    return await prisma.$transaction(async tx => {
    const row = await tx.approvalRequest.findFirst({ where: { id, organizationId, ...(permittedStationIds ? { stationId: { in: permittedStationIds } } : {}) }, include });
    if (!row) throw new AppError(404, 'APPROVAL_NOT_FOUND', 'This approval request is no longer available.');
    if (row.status !== 'PENDING' || row.version !== input.version) throw new AppError(409, 'APPROVAL_ALREADY_DECIDED', 'This request has already been reviewed. Refresh approvals to see its current status.');
    const now = new Date();
    if (input.decision === 'REJECT') {
      const changed = await tx.approvalRequest.updateMany({ where: { id, status: 'PENDING', version: input.version }, data: { status: 'REJECTED', decidedById: ownerId, decidedAt: now, decisionNote: input.note, version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError(409, 'APPROVAL_ALREADY_DECIDED', 'This request has already been reviewed.');
    } else if (row.actionType === 'PRODUCT_PRICE_CHANGE') {
      const payload = row.payload as unknown as PriceChangePayload;
      const evidence = row.evidence as unknown as PriceChangeEvidence;
      const sellingPrice = input.sellingPrice;
      const purchaseEffectiveFrom = new Date(payload.purchaseEffectiveFrom);
      const sellingEffectiveFrom = input.sellingPriceEffectiveFrom ? new Date(input.sellingPriceEffectiveFrom) : null;
      if (!(sellingPrice && Number.isFinite(sellingPrice)) || !sellingEffectiveFrom || Number.isNaN(sellingEffectiveFrom.getTime()) || Number.isNaN(purchaseEffectiveFrom.getTime()))
        throw new AppError(400, 'PRICE_CONFIRMATION_REQUIRED', 'Confirm the new selling price and its effective date before approving.');
      if (sellingEffectiveFrom < purchaseEffectiveFrom)
        throw new AppError(400, 'SELLING_PRICE_DATE_INVALID', 'The selling price cannot take effect before the purchase price from this invoice.');
      if (Math.abs(sellingPrice - evidence.currentSellingPrice) < 0.01)
        throw new AppError(400, 'SELLING_PRICE_MUST_CHANGE', 'The selling price must be reviewed and changed with the purchase price.');
      if (sellingPrice < payload.proposedPurchasePrice)
        throw new AppError(400, 'SELLING_PRICE_BELOW_PURCHASE', 'The selling price cannot be below the confirmed purchase price.');
      const product = await tx.product.findFirst({ where: { id: payload.productId, organizationId, active: true }, select: { id: true, purchasePrice: true, sellingPrice: true } });
      if (!product) throw new AppError(404, 'PRICE_PRODUCT_NOT_FOUND', 'This product is no longer available. No prices were changed.');
      if (Math.abs(Number(product.purchasePrice) - evidence.currentPurchasePrice) >= 0.01 || Math.abs(Number(product.sellingPrice) - evidence.currentSellingPrice) >= 0.01)
        throw new AppError(409, 'APPROVAL_EVIDENCE_CHANGED', 'Product prices changed after this request was created. Review a fresh price request before approving.');
      const latestSellingPrice = await tx.productSellingPrice.findFirst({ where: { productId: product.id, effectiveFrom: { lte: now } }, select: { effectiveFrom: true }, orderBy: { effectiveFrom: 'desc' } });
      await tx.productPurchasePrice.upsert({
        where: { productId_effectiveFrom: { productId: product.id, effectiveFrom: purchaseEffectiveFrom } },
        update: { price: new Prisma.Decimal(payload.proposedPurchasePrice) },
        create: { productId: product.id, effectiveFrom: purchaseEffectiveFrom, price: new Prisma.Decimal(payload.proposedPurchasePrice) },
      });
      // Keep the supplier invoice date in the audit trail, but make an owner-approved
      // historical invoice rate active from the moment it is approved. Otherwise a
      // later seed/manual history row can continue to win and the UI says "updated"
      // while still showing the old purchase price.
      const purchaseActivationFrom = purchaseEffectiveFrom <= now ? now : purchaseEffectiveFrom;
      if (purchaseActivationFrom.getTime() !== purchaseEffectiveFrom.getTime()) {
        await tx.productPurchasePrice.upsert({
          where: { productId_effectiveFrom: { productId: product.id, effectiveFrom: purchaseActivationFrom } },
          update: { price: new Prisma.Decimal(payload.proposedPurchasePrice) },
          create: { productId: product.id, effectiveFrom: purchaseActivationFrom, price: new Prisma.Decimal(payload.proposedPurchasePrice) },
        });
      }
      await tx.productSellingPrice.upsert({
        where: { productId_effectiveFrom: { productId: product.id, effectiveFrom: sellingEffectiveFrom } },
        update: { price: new Prisma.Decimal(sellingPrice) },
        create: { productId: product.id, effectiveFrom: sellingEffectiveFrom, price: new Prisma.Decimal(sellingPrice) },
      });
      await tx.product.update({
        where: { id: product.id },
        data: {
          ...(purchaseEffectiveFrom <= now ? { purchasePrice: new Prisma.Decimal(payload.proposedPurchasePrice) } : {}),
          ...(sellingEffectiveFrom <= now && (!latestSellingPrice || latestSellingPrice.effectiveFrom <= sellingEffectiveFrom) ? { sellingPrice: new Prisma.Decimal(sellingPrice) } : {}),
        },
      });
      const changed = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING', version: input.version },
        data: { status: 'APPROVED', decidedById: ownerId, decidedAt: now, decisionNote: input.note || null, executedAt: now, executionType: 'PRODUCT_PRICE_CHANGE', executionId: product.id, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new AppError(409, 'APPROVAL_ALREADY_DECIDED', 'This request has already been reviewed.');
    } else {
      const payload = row.payload as unknown as InventoryAdjustmentInput;
      const evidence = row.evidence as unknown as { bookStockBefore: number };
      const currentBookStock = Number(await bookStockAt(tx, { organizationId, stationId: payload.stationId, productId: payload.productId, ...(payload.tankId ? { tankId: payload.tankId } : {}) }, now));
      if (Math.abs(currentBookStock - evidence.bookStockBefore) > 0.001)
        throw new AppError(409, 'APPROVAL_EVIDENCE_CHANGED', 'Inventory changed after this request was created. Review a fresh adjustment before approving.');
      const changed = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING', version: input.version },
        data: {
          status: 'APPROVED',
          decidedById: ownerId,
          decidedAt: now,
          decisionNote: input.note || null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new AppError(409, 'APPROVAL_ALREADY_DECIDED', 'This request has already been reviewed.');
    }
    await tx.ownerAlert.updateMany({
      where: { organizationId, evidenceSourceType: 'APPROVAL_REQUEST', evidenceSourceId: id, resolvedAt: null },
      data: { resolvedAt: now },
    });
    return present(await tx.approvalRequest.findUniqueOrThrow({ where: { id }, include }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError(409, 'APPROVAL_ALREADY_DECIDED', 'This request was reviewed at the same time by another owner. Refresh approvals to see the final decision.');
    throw error;
  }
}
