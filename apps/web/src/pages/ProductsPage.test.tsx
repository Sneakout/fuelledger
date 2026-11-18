import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsPage } from './ProductsPage';
const { catalog, createProduct } = vi.hoisted(() => ({ catalog: vi.fn(), createProduct: vi.fn() }));
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { catalog, createProduct } }));
afterEach(cleanup);
beforeEach(() => {
  catalog.mockReset().mockResolvedValue({ products: [], categories: [], taxCategories: [] });
  createProduct.mockReset().mockResolvedValue({ product: { id: 'new' } });
});
describe('DEF product formats', () => {
  it.each([10, 12.5, 26])('creates a %s-litre pack as a distinct piece-based SKU with per-pack prices', async (size) => {
    render(<ProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add DEF' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Product editor' }));
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Litres per pack' }), { target: { value: String(size) } });
    expect(dialog.getByRole('spinbutton', { name: 'Litres per pack' })).toHaveValue(size);
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Purchase price per pack' }), { target: { value: '300' } });
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Selling price per pack' }), { target: { value: '400' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({ name: `DEF ${size} L pack`, code: `DEF-${String(size).replace('.', '-')}-L-PACK`, unit: 'PIECE', category: 'DEF', packSizeLitres: size, tankLinked: false, meterLinked: false, purchasePrice: 300, sellingPrice: 400 })));
  });
  it('sets bulk DEF to litres with a tank and no package volume', async () => {
    render(<ProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add DEF' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Product editor' }));
    fireEvent.click(dialog.getByRole('button', { name: /Bulk DEF/ }));
    expect(dialog.queryByRole('spinbutton', { name: 'Litres per pack' })).not.toBeInTheDocument();
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Purchase price per litre' }), { target: { value: '40' } });
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Selling price per litre' }), { target: { value: '50' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({ name: 'DEF bulk', unit: 'LITRE', packSizeLitres: null, tankLinked: true, meterLinked: false })));
  });
});
