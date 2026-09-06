import { safeTransaction } from '../../lib/safe-save.js';
import type { ExpenseCategoryInput, ExpenseInput, PurchaseInvoiceInput, PurchaseInvoiceUpdateInput, SupplierInput, SupplierPaymentInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { defaultExpenseCategories } from '../../lib/default-expense-categories.js';
import { effectivePriceAt } from '../../lib/effective-price.js';
import { assertStockAvailable, bookStockAt } from '../../lib/stock.js';
import { affectsClosedShift, shiftAtInstant } from '../../lib/shift-interval.js';
import { collectionAccount, postJournal } from '../accounting/service.js';

const invoiceInclude = {
  supplier: {
    select: { id: true, name: true, code: true, paymentTerms: true },
  },
  station: { select: { id: true, name: true, code: true } },
  lines: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          code: true,
          unit: true,
          tankLinked: true,
          category: true,
          hsnCode: true,
          purchasePrice: true,
          purchasePriceHistory: {
            orderBy: { effectiveFrom: 'desc' as const },
          },
          taxCategory: { select: { rate: true } },
        },
      },
    },
  },
  payments: { orderBy: { paidAt: 'desc' as const } },
  receipt: { select: { id: true, receivedAt: true, receivedAtReason: true, createdAt: true, createdBy: { select: { name: true } } } },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, size: true },
  },
  createdBy: { select: { name: true } },
  corrections: {
    orderBy: { correctedAt: 'desc' as const },
    select: {
      id: true,
      reason: true,
      beforeLines: true,
      afterLines: true,
      previousTotal: true,
      correctedTotal: true,
      correctedAt: true,
      correctedBy: { select: { name: true } },
    },
  },
} as const;
const expenseInclude = {
  station: { select: { id: true, name: true, code: true } },
  category: true,
  attachments: {
    select: { id: true, fileName: true, mimeType: true, size: true },
  },
  createdBy: { select: { name: true } },
} as const;
const outstanding = (invoice: { totalAmount: Prisma.Decimal; payments: Array<{ amount: Prisma.Decimal }> }) => Number(invoice.totalAmount) - invoice.payments.reduce((sum, row) => sum + Number(row.amount), 0);
const calculatedDueDate = (invoiceDate: string | Date, paymentTerms: number) => {
  const dueDate = new Date(invoiceDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + Math.max(0, Math.trunc(paymentTerms)));
  return dueDate;
};
const receiptTimeToleranceMs = 60 * 1000;
const legacyAuditLagMs = 5 * 60 * 1000;
export function resolveReceiptTiming(requestedAt?: string, reason?: string, now = new Date()) {
  if (!requestedAt) return { receivedAt: now, receivedAtReason: null };
  const receivedAt = new Date(requestedAt);
  if (receivedAt.getTime() > now.getTime() + receiptTimeToleranceMs)
    throw new AppError(400, 'RECEIPT_TIME_FUTURE', 'Stock cannot be received in the future. Check the receipt date and time.');
  const isPast = receivedAt.getTime() < now.getTime() - receiptTimeToleranceMs;
  const receivedAtReason = reason?.trim() || null;
  if (isPast && (!receivedAtReason || receivedAtReason.length < 5))
    throw new AppError(400, 'RECEIPT_TIME_REASON_REQUIRED', 'Explain why an earlier stock receipt time is being entered.');
  return { receivedAt, receivedAtReason };
}

export async function receiptTimingAudit(organizationId: string, stationIds?: string[]) {
  const receipts = await prisma.purchaseReceipt.findMany({
    where: { organizationId, invoiceId: { not: null }, ...(stationIds ? { stationId: { in: stationIds } } : {}) },
    select: {
      id: true, referenceNo: true, receivedAt: true, receivedAtReason: true, createdAt: true,
      supplierName: true, station: { select: { id: true, name: true, code: true } },
      createdBy: { select: { name: true } }, invoice: { select: { invoiceNumber: true, invoiceDate: true } },
    },
    orderBy: { receivedAt: 'desc' },
  });
  const candidates = await Promise.all(receipts.filter(receipt =>
    receipt.invoice && !receipt.receivedAtReason &&
    Math.abs(receipt.receivedAt.getTime() - receipt.invoice.invoiceDate.getTime()) < 1_000 &&
    receipt.createdAt.getTime() - receipt.receivedAt.getTime() > legacyAuditLagMs,
  ).map(async receipt => {
    const suspectedShift = await shiftAtInstant(prisma, organizationId, receipt.station.id, receipt.receivedAt);
    const lines = await prisma.receiptLine.findMany({ where: { receiptId: receipt.id }, select: { tankId: true, productId: true } });
    const affectedTanks = await Promise.all(lines.filter(line => line.tankId).map(async line => ({ tankId: line.tankId!, bookStockAtReceipt: Number(await bookStockAt(prisma, { organizationId, stationId: receipt.station.id, productId: line.productId, tankId: line.tankId! }, receipt.receivedAt)) })));
    return {
    id: receipt.id,
    invoiceNumber: receipt.invoice!.invoiceNumber,
    supplierName: receipt.supplierName,
    station: receipt.station,
    invoiceDate: receipt.invoice!.invoiceDate,
    receivedAt: receipt.receivedAt,
    enteredAt: receipt.createdAt,
    enteredBy: receipt.createdBy.name,
    reason: 'Receipt time matches the invoice date but the receipt was entered later.',
    suspectedShift: suspectedShift ? { id: suspectedShift.id, shiftNumber: suspectedShift.shiftNumber, status: suspectedShift.status } : null,
    affectedTanks,
  };
  }));
  return { generatedAt: new Date(), recordsChanged: false, candidates };
}

export async function receiptTimingRepairPreview(organizationId: string, receiptId: string, receivedAtValue: string, stationIds?: string[]) {
  const receivedAt = new Date(receivedAtValue);
  if (Number.isNaN(receivedAt.getTime())) throw new AppError(400, 'RECEIPT_TIME_INVALID', 'Choose a valid stock receipt time.');
  const receipt = await prisma.purchaseReceipt.findFirst({ where: { id: receiptId, organizationId, ...(stationIds ? { stationId: { in: stationIds } } : {}) }, include: { lines: { select: { id: true, tankId: true, productId: true, quantity: true } }, invoice: { select: { invoiceNumber: true, invoiceDate: true } } } });
  if (!receipt) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'This receipt was not found.');
  const [oldShift, newShift, ledgerCount, journal] = await Promise.all([shiftAtInstant(prisma, organizationId, receipt.stationId, receipt.receivedAt), shiftAtInstant(prisma, organizationId, receipt.stationId, receivedAt), prisma.inventoryLedger.count({ where: { receiptLine: { receiptId } } }), prisma.journal.findFirst({ where: { sourceType: 'PURCHASE_INVOICE', sourceId: receipt.invoiceId ?? '' }, select: { id: true, journalDate: true, reference: true } })]);
  return { recordsChanged: false, receipt: { id: receipt.id, invoiceNumber: receipt.invoice?.invoiceNumber ?? receipt.referenceNo, previousReceivedAt: receipt.receivedAt, proposedReceivedAt: receivedAt, quantities: receipt.lines }, oldShift, newShift, affectsClosedShift: affectsClosedShift(oldShift) || affectsClosedShift(newShift), inventoryLedgerEntries: ledgerCount, journal: journal ? { id: journal.id, journalDate: journal.journalDate, reference: journal.reference, willChange: false } : null, warning: 'Only receipt timing and linked inventory movement timestamps change. Quantities, payments, invoice totals and journals remain unchanged.' };
}

export async function receiptShiftImpact(organizationId: string, stationId: string, receivedAtValue: string, stationIds?: string[]) {
  if (stationIds && !stationIds.includes(stationId)) throw new AppError(403, 'STATION_ACCESS_DENIED', 'You do not have access to this fuel station.');
  const receivedAt = new Date(receivedAtValue);
  if (Number.isNaN(receivedAt.getTime())) throw new AppError(400, 'RECEIPT_TIME_INVALID', 'Choose a valid stock received date and time.');
  const station = await prisma.station.findFirst({ where: { id: stationId, organizationId }, select: { id: true } });
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'Choose an active fuel station.');
  const shift = await shiftAtInstant(prisma, organizationId, stationId, receivedAt);
  return { receivedAt: receivedAt.toISOString(), interval: shift ? 'DURING_SHIFT' as const : 'BETWEEN_SHIFTS' as const, affectsClosedShift: affectsClosedShift(shift), shift: shift ? { id: shift.id, shiftNumber: shift.shiftNumber, status: shift.status, openedAt: shift.openedAt, closedAt: shift.closedAt } : null };
}
export async function bootstrap(organizationId: string, stationIds?: string[]) {
  await prisma.expenseCategory.createMany({ data: defaultExpenseCategories.map(category => ({ organizationId, ...category })), skipDuplicates: true });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [suppliers, invoices, stations, products, categories, expenses] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        organizationId,
        ...(stationIds ? { stationId: { in: stationIds } } : {}),
      },
      take: 100,
      orderBy: { invoiceDate: 'desc' },
      include: invoiceInclude,
    }),
    prisma.station.findMany({
      where: {
        organizationId,
        active: true,
        ...(stationIds ? { id: { in: stationIds } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        configurations: {
          where: { active: true },
          take: 1,
          select: {
            tanks: {
              where: { status: 'ACTIVE' },
              select: { id: true, code: true, productId: true },
            },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { organizationId, active: true, inventoryTracked: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        category: true,
        unit: true,
        hsnCode: true,
        purchasePrice: true,
        purchasePriceHistory: {
          orderBy: { effectiveFrom: 'desc' },
          select: { id: true, price: true, effectiveFrom: true, createdAt: true },
        },
        tankLinked: true,
        taxCategory: { select: { rate: true } },
      },
    }),
    prisma.expenseCategory.findMany({
      where: { organizationId, active: true },
      orderBy: { name: 'asc' },
    }),
    prisma.expense.findMany({
      where: {
        organizationId,
        ...(stationIds ? { stationId: { in: stationIds } } : {}),
      },
      take: 100,
      orderBy: { incurredAt: 'desc' },
      include: expenseInclude,
    }),
  ]);
  const shaped = invoices.map((invoice) => ({
    ...invoice,
    outstanding: outstanding(invoice),
    overdue: invoice.status !== 'PAID' && invoice.status !== 'VOID' && invoice.dueDate < startOfToday,
  }));
  return {
    suppliers,
    invoices: shaped,
    stations,
    products: products.map((product) => ({
      ...product,
      purchasePrice: effectivePriceAt(
        product.purchasePrice,
        product.purchasePriceHistory,
        new Date(),
      ),
    })),
    categories,
    expenses,
    summary: {
      payables: shaped.reduce((sum, x) => sum + x.outstanding, 0),
      overdue: shaped.filter((x) => x.overdue).reduce((sum, x) => sum + x.outstanding, 0),
      expensesThisMonth: expenses
        .filter((x) => {
          const now = new Date();
          return x.incurredAt.getMonth() === now.getMonth() && x.incurredAt.getFullYear() === now.getFullYear();
        })
        .reduce((sum, x) => sum + Number(x.amount), 0),
    },
  };
}
export async function createSupplier(organizationId: string, input: SupplierInput) {
  try {
    return await prisma.supplier.create({
      data: {
        organizationId,
        ...input,
        email: input.email || null,
        phone: input.phone || null,
        taxId: input.taxId || null,
        address: input.address || null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'SUPPLIER_CODE_EXISTS', 'That supplier code is already in use.');
    throw error;
  }
}
export async function updateSupplier(organizationId: string, id: string, input: SupplierInput) {
  const existing = await prisma.supplier.findFirst({ where: { id, organizationId } });
  if (!existing) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');
  try {
    return await prisma.supplier.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        taxId: input.taxId || null,
        address: input.address || null,
        paymentTerms: input.paymentTerms,
        active: input.active,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'SUPPLIER_CODE_EXISTS', 'That supplier code is already in use.');
    throw error;
  }
}
export async function createCategory(organizationId: string, input: ExpenseCategoryInput) {
  try {
    return await prisma.expenseCategory.create({
      data: { organizationId, ...input },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'EXPENSE_CATEGORY_EXISTS', 'That expense category code is already in use.');
    throw error;
  }
}
export async function createInvoice(organizationId: string, userId: string, input: PurchaseInvoiceInput) {
  const receiptTiming = input.receiveNow ? resolveReceiptTiming(input.receivedAt, input.receiptTimingReason) : null;
  const [station, supplier, products] = await Promise.all([
    prisma.station.findFirst({
      where: { id: input.stationId, organizationId, active: true },
    }),
    prisma.supplier.findFirst({
      where: { id: input.supplierId, organizationId, active: true },
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        id: {
          in: input.lines.flatMap((x) => (x.productId ? [x.productId] : [])),
        },
        active: true,
        inventoryTracked: true,
      },
    }),
  ]);
  if (!station) throw new AppError(404, 'STATION_NOT_FOUND', 'Choose an active fuel station.');
  if (!supplier) throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Choose an active supplier.');
  if (input.receiveNow && products.length !== new Set(input.lines.map((x) => x.productId)).size) throw new AppError(400, 'PRODUCT_NOT_INVENTORIED', 'Every received invoice line needs an active inventory product.');
  const subtotal = input.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const total = subtotal + input.taxAmount;
  try {
    return await safeTransaction(prisma, async (tx) => {
      const invoice = await tx.purchaseInvoice.create({
        data: {
          organizationId,
          stationId: station.id,
          supplierId: supplier.id,
          invoiceNumber: input.invoiceNumber,
          invoiceDate: new Date(input.invoiceDate),
          dueDate: calculatedDueDate(input.invoiceDate, supplier.paymentTerms),
          subtotal: new Prisma.Decimal(subtotal),
          taxAmount: new Prisma.Decimal(input.taxAmount),
          totalAmount: new Prisma.Decimal(total),
          notes: input.notes || null,
          createdById: userId,
          lines: {
            create: input.lines.map((line) => ({
              productId: line.productId || null,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              unitCost: new Prisma.Decimal(line.unitCost),
              taxRate: new Prisma.Decimal(line.taxRate),
              lineTotal: new Prisma.Decimal(line.quantity * line.unitCost),
            })),
          },
          ...(input.attachment
            ? {
                attachments: {
                  create: {
                    fileName: input.attachment.fileName,
                    mimeType: input.attachment.mimeType,
                    size: input.attachment.size,
                    content: Buffer.from(input.attachment.contentBase64, 'base64'),
                  },
                },
              }
            : {}),
        },
        include: invoiceInclude,
      });
      if (input.receiveNow) {
        const receipt = await tx.purchaseReceipt.create({
          data: {
            organizationId,
            stationId: station.id,
            supplierId: supplier.id,
            invoiceId: invoice.id,
            supplierName: supplier.name,
            referenceNo: invoice.invoiceNumber,
            receivedAt: receiptTiming!.receivedAt,
            receivedAtReason: receiptTiming!.receivedAtReason,
            notes: 'Received with purchase invoice',
            createdById: userId,
          },
        });
        const affectedShift = await shiftAtInstant(tx, organizationId, station.id, receipt.receivedAt);
        if (receiptTiming!.receivedAtReason)
          await tx.receiptTimingAuditEvent.create({
            data: {
              organizationId,
              stationId: station.id,
              receiptId: receipt.id,
              previousReceivedAt: null,
              receivedAt: receipt.receivedAt,
              reason: receiptTiming!.receivedAtReason,
              affectedShiftId: affectedShift?.id ?? null,
              affectedShiftStatus: affectedShift?.status ?? null,
              affectsClosedShift: affectsClosedShift(affectedShift),
              changedById: userId,
            },
          });
        for (const line of input.lines) {
          const product = products.find((x) => x.id === line.productId)!;
          const tank = line.tankId
            ? await tx.tank.findFirst({
                where: {
                  id: line.tankId,
                  productId: product.id,
                  status: 'ACTIVE',
                  configuration: { stationId: station.id, active: true },
                },
              })
            : null;
          if (line.tankId && !tank) throw new AppError(400, 'TANK_MAPPING_INVALID', 'The selected tank must hold the invoiced product.');
          if (product.tankLinked && !tank) throw new AppError(400, 'TANK_REQUIRED', `${product.name} must be received into a configured tank.`);
          const receiptLine = await tx.receiptLine.create({
            data: {
              receiptId: receipt.id,
              productId: product.id,
              tankId: tank?.id ?? null,
              quantity: line.quantity,
              unitCost: line.unitCost,
            },
          });
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              stationId: station.id,
              productId: product.id,
              tankId: tank?.id ?? null,
              type: 'RECEIPT',
              quantityDelta: line.quantity,
              unitCost: line.unitCost,
              receiptLineId: receiptLine.id,
              occurredAt: receiptTiming!.receivedAt,
              createdById: userId,
            },
          });
        }
      }
      await postJournal(tx, {
        organizationId,
        stationId: station.id,
        createdById: userId,
        journalDate: invoice.invoiceDate,
        reference: `PI-${invoice.invoiceNumber}`,
        description: `Purchase invoice from ${supplier.name}`,
        sourceType: 'PURCHASE_INVOICE',
        sourceId: invoice.id,
        lines: [{ account: input.receiveNow ? '1200' : '1220', debit: subtotal }, ...(input.taxAmount ? [{ account: '1210', debit: input.taxAmount }] : []), { account: '2000', credit: total }],
      });
      if (input.paidNow) {
        const payment = await tx.supplierPayment.create({
          data: {
            organizationId,
            stationId: station.id,
            supplierId: supplier.id,
            invoiceId: invoice.id,
            origin: "ALREADY_PAID_DECLARATION",
            amount: total,
            paymentMethod: input.paymentMethod!,
            referenceNo: input.paymentReferenceNo || null,
            paidAt: invoice.invoiceDate,
            createdById: userId,
          },
        });
        await tx.purchaseInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID' },
        });
        await postJournal(tx, {
          organizationId,
          stationId: station.id,
          createdById: userId,
          journalDate: invoice.invoiceDate,
          reference: `SP-${payment.id.slice(-8)}`,
          description: 'Supplier payment recorded with purchase invoice',
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: payment.id,
          lines: [
            { account: '2000', debit: total },
            { account: collectionAccount(input.paymentMethod!), credit: total },
          ],
        });
      }
      return invoice;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'INVOICE_EXISTS', 'This invoice number already exists for the supplier.');
    throw error;
  }
}
type InvoiceForPricing = {
  lines: Array<{
    id: string;
    productId: string | null;
    description: string;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    product: {
      id: string;
      name: string;
      purchasePrice: Prisma.Decimal;
      purchasePriceHistory: Array<{ price: Prisma.Decimal; effectiveFrom: Date }>;
    } | null;
  }>;
};
const purchasePriceAt = (
  product: NonNullable<InvoiceForPricing['lines'][number]['product']>,
  invoiceDate: Date,
) =>
  product.purchasePriceHistory.find((row) => row.effectiveFrom <= invoiceDate)?.price;
const priceShape = (invoice: InvoiceForPricing, invoiceDate: Date) => {
  const lines = invoice.lines.map((line) => {
    const unitCost = line.product
      ? (purchasePriceAt(line.product, invoiceDate) ?? line.unitCost)
      : line.unitCost;
    const lineTotal = Number(line.quantity) * Number(unitCost);
    const tax = (lineTotal * Number(line.taxRate)) / 100;
    return {
      id: line.id,
      productId: line.productId,
      productName: line.product?.name ?? line.description,
      quantity: Number(line.quantity),
      previousUnitCost: Number(line.unitCost),
      unitCost: Number(unitCost),
      lineTotal,
      tax,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const taxAmount = lines.reduce((sum, line) => sum + line.tax, 0);
  return { lines, subtotal, taxAmount, totalAmount: subtotal + taxAmount };
};
export async function invoicePricePreview(organizationId: string, id: string, stationIds?: string[], requestedInvoiceDate?: string) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: {
      id,
      organizationId,
      ...(stationIds ? { stationId: { in: stationIds } } : {}),
    },
    include: {
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              purchasePrice: true,
              purchasePriceHistory: { orderBy: { effectiveFrom: 'desc' } },
            },
          },
        },
      },
    },
  });
  if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'This purchase invoice was not found.');
  const invoiceDate = requestedInvoiceDate ? new Date(requestedInvoiceDate) : invoice.invoiceDate;
  if (Number.isNaN(invoiceDate.getTime())) throw new AppError(400, 'INVOICE_DATE_INVALID', 'Choose a valid invoice date before checking prices.');
  return priceShape(invoice, invoiceDate);
}
export async function updateInvoice(organizationId: string, userId: string, id: string, input: PurchaseInvoiceUpdateInput, stationIds?: string[]) {
  const correctedReceiptTiming = input.receivedAt ? resolveReceiptTiming(input.receivedAt, input.correctionReason) : null;
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: {
      id,
      organizationId,
      ...(stationIds ? { stationId: { in: stationIds } } : {}),
    },
    include: {
      supplier: { select: { name: true, paymentTerms: true } },
      payments: true,
      receipt: {
        include: {
          lines: { include: { ledgerEntry: true } },
        },
      },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              purchasePrice: true,
              purchasePriceHistory: { orderBy: { effectiveFrom: 'desc' } },
            },
          },
        },
      },
    },
  });
  if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'This purchase invoice was not found.');
  const submittedLines = input.lines;
  if (submittedLines) {
    const savedIds = new Set(invoice.lines.map((line) => line.id));
    const submittedIds = new Set(submittedLines.map((line) => line.id));
    if (
      submittedIds.size !== submittedLines.length ||
      submittedIds.size !== savedIds.size ||
      [...submittedIds].some((lineId) => !savedIds.has(lineId))
    )
      throw new AppError(400, 'INVOICE_LINES_INVALID', 'Correct the quantities of the existing invoice lines only.');
  }
  const correctedQuantities = new Map(
    submittedLines?.map((line) => [line.id, line.quantity]) ?? [],
  );
  const quantityChanged = invoice.lines.some(
    (line) =>
      correctedQuantities.has(line.id) &&
      Number(line.quantity) !== correctedQuantities.get(line.id),
  );
  const shouldRecalculate = input.refreshPrices || quantityChanged;
  const invoiceForPricing = {
    ...invoice,
    lines: invoice.lines.map((line) => ({
      ...line,
      quantity: new Prisma.Decimal(correctedQuantities.get(line.id) ?? line.quantity),
    })),
  };
  const pricing = shouldRecalculate
    ? priceShape(invoiceForPricing, new Date(input.invoiceDate))
    : {
        lines: invoice.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          productName: line.product?.name ?? line.description,
          quantity: Number(line.quantity),
          previousUnitCost: Number(line.unitCost),
          unitCost: Number(line.unitCost),
          lineTotal: Number(line.quantity) * Number(line.unitCost),
          tax: (Number(line.quantity) * Number(line.unitCost) * Number(line.taxRate)) / 100,
        })),
        subtotal: Number(invoice.subtotal),
        taxAmount: Number(invoice.taxAmount),
        totalAmount: Number(invoice.totalAmount),
      };
  const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (shouldRecalculate && pricing.totalAmount <= 0.001) throw new AppError(400, 'INVOICE_TOTAL_INVALID', 'Set a valid purchase price for every product before refreshing this invoice.');
  if (shouldRecalculate && paid > pricing.totalAmount + 0.001) throw new AppError(409, 'INVOICE_TOTAL_BELOW_PAYMENTS', 'This invoice has separate recorded payments. Correct or reverse those payments before reducing the invoice total.');
  if (shouldRecalculate && invoice.receipt) {
    for (const line of invoice.lines) {
      const matches = invoice.receipt.lines.filter((receiptLine) => receiptLine.productId === line.productId);
      if (matches.length !== 1 || !matches[0]!.ledgerEntry)
        throw new AppError(409, 'RECEIPT_LINE_AMBIGUOUS', `The received stock for ${line.description} cannot be matched safely. Please contact support before correcting this line.`);
    }
  }
  const effectivePaid = paid;
  try {
    return await safeTransaction(prisma, async (tx) => {
      const claimed = await tx.purchaseInvoice.updateMany({ where: { id, organizationId, version: input.version }, data: { version: { increment: 1 } } });
      if (claimed.count !== 1) throw new AppError(409, 'INVOICE_CHANGED', 'This invoice changed while you were editing. Reopen it and review the latest values.');
      await tx.purchaseInvoiceCorrection.create({ data: {
        invoiceId: id, reason: input.correctionReason, correctedById: userId,
        previousTotal: invoice.totalAmount, correctedTotal: new Prisma.Decimal(pricing.totalAmount),
        beforeLines: { invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate.toISOString(), receivedAt: invoice.receipt?.receivedAt.toISOString() ?? null, notes: invoice.notes, lines: invoice.lines.map(line => ({id:line.id, quantity:Number(line.quantity), unitCost:Number(line.unitCost)})), payments: invoice.payments.map(p => ({id:p.id, amount:Number(p.amount), origin:p.origin})) },
        afterLines: { invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, receivedAt: input.receivedAt ?? invoice.receipt?.receivedAt.toISOString() ?? null, receivedAtReason: correctedReceiptTiming?.receivedAtReason ?? null, notes: input.notes ?? null, lines: pricing.lines.map(line => ({id:line.id, quantity:line.quantity, unitCost:line.unitCost})) }
      } });
      let status: 'PAID' | 'PART_PAID' | 'OPEN' = pricing.totalAmount - effectivePaid < 0.01 ? 'PAID' : effectivePaid > 0 ? 'PART_PAID' : 'OPEN';
      await tx.purchaseInvoice.update({
        where: { id },
        data: {
          invoiceNumber: input.invoiceNumber,
          invoiceDate: new Date(input.invoiceDate),
          dueDate: calculatedDueDate(input.invoiceDate, invoice.supplier.paymentTerms),
          notes: input.notes || null,
          ...(shouldRecalculate
            ? {
                subtotal: new Prisma.Decimal(pricing.subtotal),
                taxAmount: new Prisma.Decimal(pricing.taxAmount),
                totalAmount: new Prisma.Decimal(pricing.totalAmount),
              }
            : {}),
          status,
        },
      });
      if (shouldRecalculate) {
        for (const line of pricing.lines) {
          await tx.purchaseInvoiceLine.update({
            where: { id: line.id },
            data: {
              unitCost: new Prisma.Decimal(line.unitCost),
              quantity: new Prisma.Decimal(line.quantity),
              lineTotal: new Prisma.Decimal(line.lineTotal),
            },
          });
          if (invoice.receipt && line.productId) {
            const receiptLines = invoice.receipt.lines.filter(
              (receiptLine) => receiptLine.productId === line.productId,
            );
            if (receiptLines.length === 1) {
              const reduction = Number(receiptLines[0]!.quantity) - line.quantity;
              if (reduction > 0) await assertStockAvailable(tx, { organizationId, stationId: invoice.stationId, productId: line.productId, tankId: receiptLines[0]!.tankId }, reduction);
              await tx.receiptLine.update({
                where: { id: receiptLines[0]!.id },
                data: {
                  quantity: new Prisma.Decimal(line.quantity),
                  unitCost: new Prisma.Decimal(line.unitCost),
                },
              });
              await tx.inventoryLedger.updateMany({
                where: { receiptLineId: receiptLines[0]!.id },
                data: {
                  quantityDelta: new Prisma.Decimal(line.quantity),
                  unitCost: new Prisma.Decimal(line.unitCost),
                },
              });
            }
          }
        }
        const journal = await tx.journal.findFirst({
          where: { sourceType: 'PURCHASE_INVOICE', sourceId: id },
          select: { id: true },
        });
        if (journal) {
          await tx.journalLine.deleteMany({ where: { journalId: journal.id } });
          await tx.journal.delete({ where: { id: journal.id } });
        }
        await postJournal(tx, {
          organizationId,
          stationId: invoice.stationId,
          createdById: userId,
          journalDate: new Date(input.invoiceDate),
          reference: `PI-${input.invoiceNumber}`,
          description: `Purchase invoice from ${invoice.supplier.name}`,
          sourceType: 'PURCHASE_INVOICE',
          sourceId: id,
          lines: [
            {
              account: invoice.receipt ? '1200' : '1220',
              debit: pricing.subtotal,
            },
            ...(pricing.taxAmount ? [{ account: '1210', debit: pricing.taxAmount }] : []),
            { account: '2000', credit: pricing.totalAmount },
          ],
        });
      } else {
        await tx.journal.updateMany({
          where: { sourceType: 'PURCHASE_INVOICE', sourceId: id },
          data: {
            journalDate: new Date(input.invoiceDate),
            reference: `PI-${input.invoiceNumber}`,
            description: `Purchase invoice from ${invoice.supplier.name}`,
          },
        });
      }
      if (invoice.receipt) {
        await tx.purchaseReceipt.update({
          where: { id: invoice.receipt.id },
          data: {
            referenceNo: input.invoiceNumber,
            ...(correctedReceiptTiming ? { receivedAt: correctedReceiptTiming.receivedAt, receivedAtReason: correctedReceiptTiming.receivedAtReason } : {}),
          },
        });
        if (correctedReceiptTiming) await tx.inventoryLedger.updateMany({
          where: { receiptLine: { receiptId: invoice.receipt.id } },
          data: { occurredAt: correctedReceiptTiming.receivedAt },
        });
        if (correctedReceiptTiming) {
          const affectedShift = await shiftAtInstant(tx, organizationId, invoice.stationId, correctedReceiptTiming.receivedAt);
          await tx.receiptTimingAuditEvent.create({
            data: {
              organizationId,
              stationId: invoice.stationId,
              receiptId: invoice.receipt.id,
              previousReceivedAt: invoice.receipt.receivedAt,
              receivedAt: correctedReceiptTiming.receivedAt,
              reason: input.correctionReason,
              affectedShiftId: affectedShift?.id ?? null,
              affectedShiftStatus: affectedShift?.status ?? null,
              affectsClosedShift: affectsClosedShift(affectedShift),
              changedById: userId,
            },
          });
        }
      }
      const remaining = pricing.totalAmount - effectivePaid;
      if (input.markPaid && remaining > 0.01) {
        const payment = await tx.supplierPayment.create({
          data: {
            organizationId,
            stationId: invoice.stationId,
            supplierId: invoice.supplierId,
            invoiceId: id,
            amount: new Prisma.Decimal(remaining),
            paymentMethod: input.paymentMethod!,
            referenceNo: input.paymentReferenceNo || null,
            createdById: userId,
          },
        });
        await postJournal(tx, {
          organizationId,
          stationId: invoice.stationId,
          createdById: userId,
          journalDate: payment.paidAt,
          reference: `SP-${payment.id.slice(-8)}`,
          description: 'Supplier payment',
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: payment.id,
          lines: [
            { account: '2000', debit: remaining },
            {
              account: collectionAccount(input.paymentMethod!),
              credit: remaining,
            },
          ],
        });
        status = 'PAID';
        await tx.purchaseInvoice.update({ where: { id }, data: { status } });
      }
      return tx.purchaseInvoice.findUniqueOrThrow({
        where: { id },
        include: invoiceInclude,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new AppError(409, 'INVOICE_CHANGED', 'Another transaction changed this invoice or its stock. Reopen it and review the latest values before saving.');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'INVOICE_EXISTS', 'This invoice number already exists for the supplier.');
    throw error;
  }
}
export async function payInvoice(organizationId: string, userId: string, input: SupplierPaymentInput) {
  return safeTransaction(prisma,
    async (tx) => {
      const invoice = await tx.purchaseInvoice.findFirst({
        where: {
          id: input.invoiceId,
          organizationId,
          status: { in: ['OPEN', 'PART_PAID'] },
        },
        include: { payments: true },
      });
      if (!invoice) throw new AppError(404, 'INVOICE_NOT_PAYABLE', 'Choose an open purchase invoice.');
      if (invoice.stationId !== input.stationId) throw new AppError(400, 'PAYMENT_STATION_MISMATCH', 'The payment fuel station must match the purchase invoice fuel station.');
      const remaining = outstanding(invoice);
      if (input.amount > remaining + 0.001) throw new AppError(400, 'PAYMENT_EXCEEDS_DUE', 'Payment cannot exceed the invoice outstanding.');
      const payment = await tx.supplierPayment.create({
        data: {
          organizationId,
          stationId: input.stationId,
          supplierId: invoice.supplierId,
          invoiceId: invoice.id,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          referenceNo: input.referenceNo || null,
          createdById: userId,
        },
      });
      const next = remaining - input.amount;
      await tx.purchaseInvoice.update({
        where: { id: invoice.id },
        data: { status: next < 0.01 ? 'PAID' : 'PART_PAID', version: { increment: 1 } },
      });
      await postJournal(tx, {
        organizationId,
        stationId: input.stationId,
        createdById: userId,
        journalDate: payment.paidAt,
        reference: `SP-${payment.id.slice(-8)}`,
        description: 'Supplier payment',
        sourceType: 'SUPPLIER_PAYMENT',
        sourceId: payment.id,
        lines: [
          { account: '2000', debit: input.amount },
          {
            account: collectionAccount(input.paymentMethod),
            credit: input.amount,
          },
        ],
      });
      return payment;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export async function createExpense(organizationId: string, userId: string, input: ExpenseInput) {
  const [station, category] = await Promise.all([
    prisma.station.findFirst({
      where: { id: input.stationId, organizationId, active: true },
    }),
    prisma.expenseCategory.findFirst({
      where: { id: input.categoryId, organizationId, active: true },
    }),
  ]);
  if (!station || !category) throw new AppError(404, 'EXPENSE_CONTEXT_INVALID', 'Choose an active fuel station and expense category.');
  return safeTransaction(prisma, async (tx) => {
    const expense = await tx.expense.create({
      data: {
        organizationId,
        stationId: station.id,
        categoryId: category.id,
        description: input.description,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        incurredAt: new Date(input.incurredAt),
        referenceNo: input.referenceNo || null,
        notes: input.notes || null,
        createdById: userId,
        ...(input.attachment
          ? {
              attachments: {
                create: {
                  fileName: input.attachment.fileName,
                  mimeType: input.attachment.mimeType,
                  size: input.attachment.size,
                  content: Buffer.from(input.attachment.contentBase64, 'base64'),
                },
              },
            }
          : {}),
      },
      include: expenseInclude,
    });
    await postJournal(tx, {
      organizationId,
      stationId: station.id,
      createdById: userId,
      journalDate: expense.incurredAt,
      reference: `EXP-${expense.id.slice(-8)}`,
      description: expense.description,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
      lines: [
        { account: '6100', debit: input.amount },
        {
          account: collectionAccount(input.paymentMethod),
          credit: input.amount,
        },
      ],
    });
    return expense;
  });
}
export async function attachment(organizationId: string, id: string) {
  const file = await prisma.attachment.findFirst({
    where: {
      id,
      OR: [{ purchaseInvoice: { organizationId } }, { expense: { organizationId } }],
    },
  });
  if (!file) throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found.');
  return file;
}
