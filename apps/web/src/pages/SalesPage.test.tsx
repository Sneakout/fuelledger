import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesPage } from './SalesPage';

const { salesBootstrap, createSale } = vi.hoisted(() => ({ salesBootstrap: vi.fn(), createSale: vi.fn() }));
vi.mock('../components/StationProvider', () => ({ useStation: () => ({ selectedStationId: 'station' }) }));
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { salesBootstrap, createSale } }));
const products = [
  { id: 'def-pack', code: 'DEF-10L', name: 'DEF 10 L pack', category: 'DEF', tankLinked: false, meterLinked: false, packSizeLitres: '10', unit: 'PIECE', sellingPrice: '400', isService: false },
  { id: 'def', code: 'DEF', name: 'DEF bulk', category: 'DEF', tankLinked: true, meterLinked: true, unit: 'LITRE', sellingPrice: '50', isService: false },
  { id: 'ms', code: 'MS', name: 'Motor Spirit', category: 'FUEL', meterLinked: true, unit: 'LITRE', sellingPrice: '104', isService: false },
  { id: 'oil', code: 'OIL', name: 'Engine oil 1 L', category: 'LUBRICANTS', meterLinked: false, unit: 'PIECE', sellingPrice: '450', isService: false },
  { id: 'water', code: 'WATER', name: 'Mineral water', category: 'RETAIL', meterLinked: false, unit: 'PIECE', sellingPrice: '20', isService: false },
];
const shift = { id: 'shift', shiftNumber: 1, station: { id: 'station', name: 'Test fuel station' }, manager: { id: 'owner', name: 'Owner', role: 'OWNER' }, users: [], nozzleAssignments: [], nozzleReadings: [] };
const bootstrap = (openShifts: unknown[]) => ({ products, openShifts, sales: [], employees: [{ id: 'counter', name: 'Counter Employee', role: 'ATTENDANT' }], customers: [], stations: [{ id: 'station', name: 'Test fuel station' }], tanks: [{ id: 'def-tank', code: 'DEF-1', productId: 'def', stationId: 'station' }] });
afterEach(cleanup);
beforeEach(() => { salesBootstrap.mockReset(); createSale.mockReset().mockResolvedValue({}); });
const open = () => render(<MemoryRouter><SalesPage /></MemoryRouter>);

describe('Counter sales', () => {
  it('records a counter sale without a shift under the selected employee', async () => {
    salesBootstrap.mockResolvedValue(bootstrap([]));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Mineral water/ }));
    expect(screen.getByRole('button', { name: 'Counter sales' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('link', { name: 'Open a shift' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record Mineral water sale/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sold by' }), { target: { value: 'counter' } });
    fireEvent.click(screen.getByRole('button', { name: /Record Mineral water sale/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledWith(expect.objectContaining({ shiftId: null, employeeId: 'counter', stationId: 'station', productId: 'water' })));
  });
  it('keeps counter sales independent of the open shift and permits an employee outside its team', async () => {
    salesBootstrap.mockResolvedValue(bootstrap([shift]));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Counter sales' }));
    fireEvent.click(screen.getByRole('button', { name: /Engine oil 1 L/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity (piece)' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sold by' }), { target: { value: 'counter' } });
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }));
    fireEvent.click(screen.getByRole('button', { name: /Record Engine oil 1 L sale/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'station', shiftId: null, employeeId: 'counter', productId: 'oil', quantity: 2, unitPrice: 450, paymentMethod: 'UPI', tankId: null, nozzleId: null, meterOpening: null, meterClosing: null })));
  });
  it('sells packaged DEF by whole packs with its own price and no source tank', async () => {
    salesBootstrap.mockResolvedValue(bootstrap([]));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /DEF 10 L pack/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sold by' }), { target: { value: 'counter' } });
    expect(screen.queryByRole('combobox', { name: 'Source tank' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity (packs)' }), { target: { value: '1.5' } });
    expect(screen.getByRole('button', { name: /Record DEF 10 L pack sale/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity (packs)' }), { target: { value: '2' } });
    expect(screen.getByText(/2 packs × 10 L = 20 L/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Record DEF 10 L pack sale/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledWith(expect.objectContaining({ productId: 'def-pack', quantity: 2, unitPrice: 400, tankId: null, shiftId: null })));
  });
  it('places bulk DEF in counter sales and requires the source tank', async () => {
    salesBootstrap.mockResolvedValue(bootstrap([]));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /DEF bulk/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sold by' }), { target: { value: 'counter' } });
    expect(screen.getByRole('button', { name: /Record DEF bulk sale/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Source tank' }), { target: { value: 'def-tank' } });
    fireEvent.click(screen.getByRole('button', { name: /Record DEF bulk sale/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledWith(expect.objectContaining({ productId: 'def', tankId: 'def-tank', shiftId: null, nozzleId: null, quantity: 1 })));
    fireEvent.click(screen.getByRole('button', { name: 'MS & HSD' }));
    expect(screen.queryByRole('button', { name: /DEF bulk/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open a shift' })).toHaveAttribute('href', '/operations');
  });
});
