import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoricalSalesImportPage } from './HistoricalSalesImportPage';

const { extractHistoricalSales } = vi.hoisted(() => ({ extractHistoricalSales: vi.fn() }));
vi.mock('../components/StationProvider', () => ({ useStation: () => ({ stations: [{ id: 'station-1', name: 'Saleema Petroleum' }], selectedStationId: 'station-1', selectStation: vi.fn() }) }));
vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {}, historicalSalesSourceUrl: vi.fn(),
  api: {
    historicalSalesSetup: vi.fn().mockResolvedValue({ products: [{ product: { id: 'product-1', code: 'HSD', name: 'High Speed Diesel', sellingPrice: '94' }, tanks: [{ id: 'tank-1', code: 'HSD-1', nominalCapacity: '20000', workingCapacity: '19000', openingStock: '5000', tankType: 'UNDERGROUND' }], nozzles: [{ id: 'nozzle-1', code: 'HSD-1', dispenserCode: 'D-1', openingMeter: '1000' }] }] }),
    historicalSalesImports: vi.fn().mockResolvedValue({ imports: [] }),
    subscription: vi.fn().mockResolvedValue({ intelligenceEnabledAt: '2026-01-01T00:00:00.000Z', intelligenceExpiresAt: null }),
    extractHistoricalSales,
  },
}));

describe('HistoricalSalesImportPage', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const operation = indexedDB.deleteDatabase('fuelnerve-historical-drafts-v1');
      operation.onsuccess = () => resolve();
      operation.onerror = () => reject(operation.error);
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it('does not present live equipment balances as a historical draft by default', async () => {
    render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    expect(await screen.findByText('Attach a DSR to begin')).toBeInTheDocument();
    expect(screen.queryByText('Review grid')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('5000')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('1000')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enter manually/ }));
    expect(screen.getByLabelText(/HSD-1 stock/)).toHaveValue(0);
  });
  it('uses Nerve Intelligence to populate the review grid after a DSR is attached', async () => {
    extractHistoricalSales.mockResolvedValue({ rows: [{ date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15086 }], testingQuantity: 25, salesQuantity: 1804, cumulativeSales: 1779, sellingPrice: 94 }], warnings: ['One value needs review.'], layoutIssues: [], uncertainCells: ['2026-11-02:salesQuantity'], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .84, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['HSD-1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    await waitFor(() => expect(screen.getByText(/Nerve Intelligence will fill the table/)).toBeInTheDocument());
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['scan'], 'November DSR.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText(/Draft ready · 1 day recognised · 84%/)).toBeInTheDocument();
    expect(extractHistoricalSales).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'station-1', productId: 'product-1', sourceFileName: 'November DSR.pdf' }));
    expect(screen.getByText('One value needs review.')).toBeInTheDocument();
    expect(view.container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2026-11-02');
  });

  it('switches the temporary month to the period read from the physical DSR', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [{ date: '2026-10-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15086 }], testingQuantity: 25, salesQuantity: 1804, cumulativeSales: 1779, sellingPrice: 94 }], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, effectiveMonth: '2026-10', periodSource: 'DOCUMENT', confidence: .94, detectedProduct: 'HSD', detectedMonth: 'October 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['HSD-1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['scan'], 'October DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready · 1 day recognised · 94%/);
    expect(view.container.querySelector<HTMLInputElement>('input[type="month"]')?.value).toBe('2026-10');
    expect(view.container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2026-10-02');
    expect(screen.getByText(/suggested this month and year from the physical DSR/)).toBeInTheDocument();
  });

  it('lets the user correct an inaccurate OCR period without losing the draft values', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [{ date: '2022-10-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15086 }], testingQuantity: 25, salesQuantity: 1804, cumulativeSales: 1779, sellingPrice: 94 }], warnings: [], layoutIssues: [], uncertainCells: ['2022-10-02:salesQuantity'], periodNeedsConfirmation: true, effectiveMonth: '2022-10', periodSource: 'DOCUMENT', confidence: .8, detectedProduct: 'HSD', detectedMonth: 'October 2022', detectedPumpColumns: ['1'], detectedTankColumns: ['HSD-1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready · 1 day recognised/);
    fireEvent.change(screen.getByLabelText('Actual DSR month and year'), { target: { value: '2026-10' } });
    expect(view.container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2026-10-02');
    expect(screen.getByLabelText('HSD-1 stock 2026-10-02')).toHaveValue(7900);
    expect(screen.getByText(/This period was selected manually/)).toBeInTheDocument();
  });

  it('recalculates volume locally when a dip changes without another OCR request', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [{ date: '2026-10-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15086 }], testingQuantity: 25, salesQuantity: 1804, cumulativeSales: 1779, sellingPrice: 94 }], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: true, effectiveMonth: '2026-10', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'October 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['HSD-1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'DSR-local.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready · 1 day recognised/);
    fireEvent.change(screen.getByLabelText('HSD-1 dip 2026-10-02'), { target: { value: '126.5' } });
    expect(screen.getByLabelText('HSD-1 stock 2026-10-02')).toHaveValue(13614.54);
    expect(screen.getByText(/Official chart: 13,614.54 L · interpolated/)).toBeInTheDocument();
    expect(extractHistoricalSales).toHaveBeenCalledTimes(1);
  });
});
