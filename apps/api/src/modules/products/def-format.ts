import type { Prisma } from '@prisma/client';
import type { ProductInput } from '@fuelledger/shared';
import { AppError } from '../../lib/errors.js';

/** A stocked SKU keeps its unit and known pack size for its complete history. */
export async function assertDefFormatChange(
  db: Pick<Prisma.TransactionClient, 'sale' | 'inventoryLedger'>,
  existing: { id: string; category: string; unit: string; tankLinked: boolean; packSizeLitres: Prisma.Decimal | null },
  input: ProductInput,
) {
  if (existing.category !== 'DEF' && input.category !== 'DEF') return;
  const sizeChanged = existing.packSizeLitres !== null && input.packSizeLitres !== undefined && Number(existing.packSizeLitres) !== Number(input.packSizeLitres);
  if (existing.unit === input.unit && existing.tankLinked === input.tankLinked && !sizeChanged) return;
  const [sales, movements] = await Promise.all([
    db.sale.count({ where: { productId: existing.id } }),
    db.inventoryLedger.count({ where: { productId: existing.id } }),
  ]);
  if (sales || movements) throw new AppError(409, 'DEF_FORMAT_IN_USE', 'This DEF product already has stock or sales. Add a separate product for a different pack size or bulk format.');
}

export function assertDefPackQuantity(product: { category: string; unit: string }, quantity: number) {
  if (product.category !== 'DEF' || product.unit !== 'PIECE') return;
  if (!Number.isInteger(quantity)) throw new AppError(400, 'PACK_QUANTITY_INVALID', 'Enter a whole number of DEF packs. Each pack is tracked as one piece.');

}
