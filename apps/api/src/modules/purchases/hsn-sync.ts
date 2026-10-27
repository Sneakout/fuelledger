export type HsnInvoiceLine = {
  productId?: string | null | undefined;
  hsnCode?: string | null | undefined;
};

export type HsnProduct = {
  id: string;
  hsnCode?: string | null | undefined;
};

export type ProductHsnUpdate = {
  productId: string;
  hsnCode: string;
};

export function normalizeHsnCode(value?: string | null) {
  const normalized = (value ?? '').replace(/\s+/g, '');
  return /^\d{4,8}$/.test(normalized) ? normalized : null;
}

export function planProductHsnUpdates(lines: HsnInvoiceLine[], products: HsnProduct[]): ProductHsnUpdate[] {
  const capturedByProduct = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!line.productId) continue;
    const hsnCode = normalizeHsnCode(line.hsnCode);
    if (!hsnCode) continue;
    const codes = capturedByProduct.get(line.productId) ?? new Set<string>();
    codes.add(hsnCode);
    capturedByProduct.set(line.productId, codes);
  }

  return products.flatMap((product) => {
    if ((product.hsnCode ?? '').trim()) return [];
    const codes = capturedByProduct.get(product.id);
    if (!codes || codes.size !== 1) return [];
    return [{ productId: product.id, hsnCode: [...codes][0]! }];
  });
}
