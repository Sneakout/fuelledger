import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoricalSalesImportPage } from './HistoricalSalesImportPage';
import { readManualHistoricalDraft } from '../lib/manual-historical-draft';
import { latestHistoricalDraft, saveHistoricalDraft } from '../lib/historical-draft-store';

const { MockApiRequestError, correctHistoricalSalesImport, createHistoricalSalesImport, extractHistoricalSales, historicalSalesImport, historicalSalesImports, validateHistoricalSales, validateHistoricalSalesCorrection } = vi.hoisted(() => ({
  MockApiRequestError: class extends Error {
    constructor(message: string, public code: string, public requestId?: string, public details?: unknown) { super(message); }
  },
  correctHistoricalSalesImport: vi.fn(), createHistoricalSalesImport: vi.fn(), extractHistoricalSales: vi.fn(), historicalSalesImport: vi.fn(), historicalSalesImports: vi.fn().mockResolvedValue({ imports: [] }), validateHistoricalSales: vi.fn(), validateHistoricalSalesCorrection: vi.fn(),
}));
vi.mock('../components/StationProvider', () => ({ useStation: () => ({ stations: [{ id: 'station-1', name: 'Saleema Petroleum' }], selectedStationId: 'station-1', selectStation: vi.fn() }) }));
vi.mock('../lib/api', () => ({
  ApiRequestError: MockApiRequestError, historicalSalesSourceUrl: vi.fn(),
  api: {
    historicalSalesSetup: vi.fn().mockResolvedValue({ products: [
      { product: { id: 'product-1', code: 'HSD', name: 'High Speed Diesel', sellingPrice: '94' }, tanks: [{ id: 'tank-1', code: 'HSD-1', nominalCapacity: '20000', workingCapacity: '19000', openingStock: '5000', tankType: 'UNDERGROUND' }], nozzles: [{ id: 'nozzle-1', code: 'HSD-1', dispenserCode: 'D-1', openingMeter: '1000' }] },
      { product: { id: 'product-2', code: 'MS', name: 'Motor Spirit', sellingPrice: '105' }, tanks: [{ id: 'tank-2', code: 'MS-1', nominalCapacity: '20000', workingCapacity: '19000', openingStock: '4000', tankType: 'UNDERGROUND' }], nozzles: [{ id: 'nozzle-2', code: 'MS-1', dispenserCode: 'D-2', openingMeter: '2000' }] },
    ] }),
    historicalSalesImports,
    historicalSalesImport,
    createHistoricalSalesImport,
    subscription: vi.fn().mockResolvedValue({ intelligenceEnabledAt: '2026-01-01T00:00:00.000Z', intelligenceExpiresAt: null }),
    extractHistoricalSales,
    validateHistoricalSales,
    validateHistoricalSalesCorrection,
    correctHistoricalSalesImport,
  },
}));

describe('HistoricalSalesImportPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const operation = indexedDB.deleteDatabase('fuelnerve-historical-drafts-v1');
      operation.onsuccess = () => resolve();
      operation.onerror = () => reject(operation.error);
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it('does not present live equipment balances as a historical draft by default', async () => {
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    expect(await screen.findByText('Attach a DSR to begin')).toBeInTheDocument();
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openFilePicker = vi.spyOn(fileInput, 'click');
    fireEvent.click(screen.getByRole('button', { name: /Attach DSR/ }));
    expect(openFilePicker).toHaveBeenCalledOnce();
    expect(screen.queryByText('Review grid')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('5000')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('1000')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enter manually/ }));
    expect(await screen.findByLabelText(/HSD-1 stock/)).toHaveValue(0);
  });

  it('switches from an HSD draft to MS without rendering the HSD equipment against MS', async () => {
    extractHistoricalSales
      .mockResolvedValueOnce({ rows: [{ date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15086 }], testingQuantity: 25, salesQuantity: 0, sellingPrice: 94 }], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] })
      .mockResolvedValueOnce({ rows: [{ date: '2026-11-02', tankReadings: [{ tankId: 'tank-2', openingStock: 6800, dipReading: 75 }], receiptQuantity: 0, totalStock: 6800, nozzleReadings: [{ nozzleId: 'nozzle-2', meterReading: 2200 }], testingQuantity: 5, salesQuantity: 0, sellingPrice: 105 }], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .92, detectedProduct: 'MS', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /MS · Motor Spirit/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'HSD draft.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready/);

    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'product-2' } });

    expect(screen.getByLabelText('Product')).toHaveValue('product-2');
    expect(await screen.findByText('Attach a DSR to begin')).toBeInTheDocument();
    expect(screen.queryByLabelText(/HSD-1 stock/)).not.toBeInTheDocument();
    expect(screen.queryByText('HSD draft.pdf')).not.toBeInTheDocument();

    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['ms scan'], 'MS draft.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText(/Draft ready · 1 day recognised · 92%/)).toBeInTheDocument();
    expect(screen.getByLabelText('MS-1 stock 2026-11-02')).toBeInTheDocument();
    expect(extractHistoricalSales).toHaveBeenLastCalledWith(expect.objectContaining({ productId: 'product-2', sourceFileName: 'MS draft.pdf' }));
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
    expect(screen.getByLabelText('Nozzle sales 2026-11-02')).toHaveValue(null);
    expect(screen.getByLabelText('Nozzle sales 2026-11-02')).toHaveAttribute('readonly');
    expect(screen.queryByText('Sales litres could not be read confidently.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm historical import/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm historical import/ }));
    expect(await screen.findByText(/Confirm the DSR month and year before importing/)).toBeInTheDocument();
    expect(view.container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2026-11-02');
  });

  it('calculates daily sales from all nozzle movement less testing', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [
      { date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15000 }], testingQuantity: 25, salesQuantity: 0, sellingPrice: 94 },
      { date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7000, dipReading: 75 }], receiptQuantity: 0, totalStock: 7000, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15125 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 94 },
    ], warnings: [], layoutIssues: [], uncertainCells: ['2026-11-01:salesQuantity'], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready/);
    expect(screen.getByLabelText('Nozzle sales 2026-11-01')).toHaveValue(100);
    expect(screen.getByLabelText('Sales value 2026-11-01')).toHaveValue(9400);
    expect(screen.getByLabelText('Cumulative sales 2026-11-01')).toHaveValue(100);
    expect(screen.getByLabelText('Stock gain or loss 2026-11-01')).toHaveValue(-800);
    expect(screen.queryByText('Sales litres could not be read confidently.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('15125'), { target: { value: '15150' } });
    expect(screen.getByLabelText('Nozzle sales 2026-11-01')).toHaveValue(125);
    expect(screen.getByLabelText('Sales value 2026-11-01')).toHaveValue(11750);
    fireEvent.change(screen.getByLabelText('RSP 2026-11-01'), { target: { value: '95.5' } });
    expect(screen.getByLabelText('Sales value 2026-11-01')).toHaveValue(11937.5);
    expect(screen.getByLabelText('Cumulative sales 2026-11-01')).toHaveValue(125);
    expect(screen.getByLabelText('Stock gain or loss 2026-11-01')).toHaveValue(-775);
    fireEvent.change(screen.getByLabelText('HSD-1 stock 2026-11-02'), { target: { value: '6950' } });
    expect(screen.getByLabelText('Stock gain or loss 2026-11-01')).toHaveValue(-825);
  });

  it('applies one confirmed RSP across the draft and recalculates sales value', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [
      { date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 7900 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15000 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 0 },
      { date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7800 }], receiptQuantity: 0, totalStock: 7800, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15100 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 0 },
    ], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready/);

    fireEvent.change(screen.getByLabelText('RSP for all days'), { target: { value: '96.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply RSP' }));

    expect(screen.getByLabelText('Sales value 2026-11-01')).toHaveValue(9650);
    expect(screen.getByLabelText('RSP 2026-11-01')).toHaveValue(96.5);
    expect(screen.getByLabelText('RSP 2026-11-02')).toHaveValue(96.5);
  });

  it('carries a user-entered RSP forward from its effective date', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [
      { date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 7900 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15000 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 0 },
      { date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7800 }], receiptQuantity: 0, totalStock: 7800, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15100 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 0 },
      { date: '2026-11-03', tankReadings: [{ tankId: 'tank-1', openingStock: 7700 }], receiptQuantity: 0, totalStock: 7700, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15200 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 0 },
    ], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready/);

    fireEvent.change(screen.getByLabelText('RSP 2026-11-01'), { target: { value: '96.5' } });

    expect(screen.getByLabelText('RSP 2026-11-01')).toHaveValue(96.5);
    expect(screen.getByLabelText('RSP 2026-11-02')).toHaveValue(96.5);
    expect(screen.getByLabelText('RSP 2026-11-03')).toHaveValue(96.5);
    expect(screen.getByLabelText('Sales value 2026-11-01')).toHaveValue(9650);
    expect(screen.getByLabelText('Sales value 2026-11-02')).toHaveValue(9650);
  });

  it('does not show draft actions or the empty state while OCR is still reading', async () => {
    extractHistoricalSales.mockImplementationOnce(() => new Promise(() => undefined));
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'Reading.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText('Reading the DSR')).toBeInTheDocument();
    expect(screen.queryByText('Browser draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Attach a DSR to begin')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh calculations/ })).not.toBeInTheDocument();
  });

  it('shows validation messages directly beneath the affected date row', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [{ date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15086 }], testingQuantity: 25, salesQuantity: 1804, cumulativeSales: 1779, sellingPrice: 94 }], warnings: [], layoutIssues: [], uncertainCells: [], effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    validateHistoricalSales.mockResolvedValueOnce({ issues: [{ date: '2026-11-02', level: 'ERROR', field: 'nozzleReadings', message: 'A nozzle meter reading moves backwards.' }] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready/);
    fireEvent.click(screen.getByRole('button', { name: /Check data/ }));
    const message = await screen.findByText('A nozzle meter reading moves backwards.');
    expect(message.closest('tr')).toHaveClass('historical-row-review');
    expect(screen.queryByText('Checks to review')).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('Actual DSR month')).toHaveValue('10');
    fireEvent.change(screen.getByLabelText('Actual DSR year'), { target: { value: '2026' } });
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
    expect(screen.getByLabelText('Total stock 2026-10-02')).toHaveValue(13614.54);
    expect(screen.getByLabelText('Total stock 2026-10-02')).toHaveAttribute('readonly');
    expect(screen.getByText(/Official chart: 13,614.54 L · interpolated/)).toBeInTheDocument();
    expect(extractHistoricalSales).toHaveBeenCalledTimes(1);
  });

  it('refreshes every dependent value and immediately updates the saved browser draft', async () => {
    extractHistoricalSales.mockResolvedValueOnce({ rows: [
      { date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 7900, dipReading: 83 }], receiptQuantity: 100, totalStock: 8000, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15000 }], testingQuantity: 25, salesQuantity: 0, sellingPrice: 94 },
      { date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7000, dipReading: 75 }], receiptQuantity: 0, totalStock: 7000, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15125 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 94 },
    ], warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .9, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    const source = new File(['scan'], 'DSR-refresh.pdf', { type: 'application/pdf', lastModified: 1 });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [source] } });
    await screen.findByText(/Draft ready/);

    fireEvent.click(screen.getByRole('button', { name: /Refresh calculations & save draft/ }));

    expect(await screen.findByText(/Calculations refreshed and draft saved/)).toBeInTheDocument();
    expect(screen.getByLabelText('HSD-1 stock 2026-11-01')).toHaveValue(7950.2);
    expect(screen.getByLabelText('Total stock 2026-11-01')).toHaveValue(8050.2);
    expect(screen.getByLabelText('Nozzle sales 2026-11-01')).toHaveValue(100);
    expect(screen.getByLabelText('Cumulative sales 2026-11-01')).toHaveValue(100);
    await waitFor(async () => {
      const saved = await latestHistoricalDraft('station-1', 'product-1');
      expect(saved?.rows[0]).toMatchObject({ totalStock: 8050.2, salesQuantity: 100, cumulativeSales: 100 });
    });
    expect(extractHistoricalSales).toHaveBeenCalledTimes(1);
  });

  it('replaces a submitted draft with a confirmation and direct edit action', async () => {
    const rows = [
      { date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 7900 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15000 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 94 },
    ];
    const record = { id: 'import-new', month: '2026-11', monthStart: '2026-10-31T18:30:00.000Z', sourceFileName: 'November DSR.pdf', cutoverApplied: false, createdAt: '2026-11-16T03:30:00.000Z', updatedAt: '2026-11-16T03:30:00.000Z', product: { name: 'High Speed Diesel', code: 'HSD' }, importedBy: { name: 'Owner' }, _count: { corrections: 0 } };
    extractHistoricalSales.mockResolvedValueOnce({ rows, warnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: true, effectiveMonth: '2026-11', periodSource: 'DOCUMENT', confidence: .95, detectedProduct: 'HSD', detectedMonth: 'November 2026', detectedPumpColumns: ['1'], detectedTankColumns: ['1'] });
    createHistoricalSalesImport.mockResolvedValueOnce({ record, issues: [] });
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option', { name: /HSD/ });
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File(['scan'], 'November DSR.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/Draft ready/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirm DSR period/ }));

    fireEvent.click(screen.getByRole('button', { name: /Confirm historical import/ }));

    expect(await screen.findByRole('heading', { name: 'Historic DSR updated' })).toBeInTheDocument();
    expect(screen.getByText(/browser draft has been cleared/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit data if required/ })).toBeInTheDocument();
    expect(screen.queryByText('Review grid')).not.toBeInTheDocument();
    expect(screen.queryByText('Browser draft')).not.toBeInTheDocument();
    expect(screen.getByText('Imported registers')).toBeInTheDocument();
    expect(createHistoricalSalesImport).toHaveBeenCalledOnce();
  });

  it('removes a stale browser draft when that product month is already imported', async () => {
    const record = { id: 'import-existing', month: '2026-11', monthStart: '2026-10-31T18:30:00.000Z', sourceFileName: 'Submitted DSR.pdf', cutoverApplied: false, createdAt: '2026-11-16T03:30:00.000Z', updatedAt: '2026-11-16T03:30:00.000Z', product: { name: 'High Speed Diesel', code: 'HSD' }, importedBy: { name: 'Owner' }, _count: { corrections: 0 } };
    await saveHistoricalDraft({
      id: 'station-1:product-1:v4:stale', scopeKey: 'station-1:product-1', stationId: 'station-1', productId: 'product-1', sourceFingerprint: 'stale',
      sourceFileName: 'Old browser draft.pdf', sourceMimeType: 'application/pdf', sourceLastModified: 1, sourceBlob: new Blob(['scan'], { type: 'application/pdf' }), month: '2026-11',
      rows: [{ date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 7900 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 15000 }], testingQuantity: 0, salesQuantity: 0, sellingPrice: 94 }],
      extractionWarnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: false, periodConfirmed: true, periodSource: 'DOCUMENT', readerStatus: 'Draft ready', applyCutover: false, updatedAt: '2026-11-16T03:35:00.000Z',
    });
    historicalSalesImports.mockResolvedValueOnce({ imports: [record] });

    render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);

    expect(await screen.findByText('Imported registers')).toBeInTheDocument();
    await waitFor(async () => expect(await latestHistoricalDraft('station-1', 'product-1')).toBeUndefined());
    expect(screen.queryByText('Review grid')).not.toBeInTheDocument();
    expect(screen.queryByText(/Saved OCR draft restored/)).not.toBeInTheDocument();
    expect(screen.getByText('Attach a DSR to begin')).toBeInTheDocument();
  });

  it('reopens a submitted register, recalculates edits, and saves an audited correction', async () => {
    const rows = [
      { date: '2026-10-01', tankReadings: [{ tankId: 'tank-1', openingStock: 8000 }], receiptQuantity: 0, totalStock: 8000, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 1000 }], testingQuantity: 10, salesQuantity: 90, cumulativeSales: 90, sellingPrice: 94 },
      { date: '2026-10-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 1100 }], testingQuantity: 0, salesQuantity: 0, cumulativeSales: 90, sellingPrice: 94 },
    ];
    const record = { id: 'import-1', stationId: 'station-1', productId: 'product-1', month: '2026-10', monthStart: '2026-09-30T18:30:00.000Z', sourceFileName: 'October DSR.pdf', cutoverApplied: false, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', product: { name: 'High Speed Diesel', code: 'HSD' }, importedBy: { name: 'Owner' }, corrections: [], rows };
    historicalSalesImports.mockResolvedValueOnce({ imports: [{ ...record, _count: { corrections: 0 } }] });
    historicalSalesImport.mockResolvedValueOnce({ record });
    validateHistoricalSalesCorrection.mockResolvedValueOnce({ issues: [] });
    correctHistoricalSalesImport.mockResolvedValueOnce({ record: { ...record, updatedAt: '2026-11-15T11:00:00.000Z', corrections: [{ id: 'correction-1', reason: 'Corrected meter', changedAt: '2026-11-15T11:00:00.000Z', changedBy: { name: 'Owner' } }] }, issues: [], liveBalancesUnchanged: true });

    render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /View \/ edit data/ }));
    expect(await screen.findByText(/Editing submitted register/)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('1100'), { target: { value: '1125' } });
    expect(screen.getByLabelText('Nozzle sales 2026-10-01')).toHaveValue(115);
    fireEvent.change(screen.getByPlaceholderText('What was corrected, and why?'), { target: { value: 'Corrected meter from physical DSR' } });
    fireEvent.click(screen.getByRole('button', { name: /Save corrections/ }));
    await waitFor(() => expect(correctHistoricalSalesImport).toHaveBeenCalledWith('import-1', expect.objectContaining({ reason: 'Corrected meter from physical DSR', expectedUpdatedAt: '2026-11-15T10:00:00.000Z', rows: expect.arrayContaining([expect.objectContaining({ salesQuantity: 115 })]) })));
    expect(await screen.findByText(/Corrections saved/)).toBeInTheDocument();
  });

  it('shows server correction errors on the affected row and highlights the exact field', async () => {
    const rows = [
      { date: '2026-11-01', tankReadings: [{ tankId: 'tank-1', openingStock: 8000 }], receiptQuantity: 0, totalStock: 8000, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 1000 }], testingQuantity: 0, salesQuantity: 100, cumulativeSales: 100, sellingPrice: 94 },
      { date: '2026-11-02', tankReadings: [{ tankId: 'tank-1', openingStock: 7900 }], receiptQuantity: 0, totalStock: 7900, nozzleReadings: [{ nozzleId: 'nozzle-1', meterReading: 1100 }], testingQuantity: 0, salesQuantity: 0, cumulativeSales: 100, sellingPrice: 94 },
    ];
    const record = { id: 'import-invalid', stationId: 'station-1', productId: 'product-1', month: '2026-11', monthStart: '2026-10-31T18:30:00.000Z', sourceFileName: 'November DSR.pdf', cutoverApplied: false, createdAt: '2026-11-16T03:30:00.000Z', updatedAt: '2026-11-16T03:30:00.000Z', product: { name: 'High Speed Diesel', code: 'HSD' }, importedBy: { name: 'Owner' }, corrections: [], rows };
    historicalSalesImports.mockResolvedValueOnce({ imports: [{ ...record, _count: { corrections: 0 } }] });
    historicalSalesImport.mockResolvedValueOnce({ record });
    correctHistoricalSalesImport.mockRejectedValueOnce(new MockApiRequestError('Correct the highlighted historical data before saving.', 'HISTORICAL_IMPORT_INVALID', 'request-1', [
      { date: '2026-11-01', level: 'ERROR', field: 'sellingPrice', message: 'Enter a valid RSP for this date.' },
    ]));

    render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /View \/ edit data/ }));
    await screen.findByText(/Editing submitted register/);
    fireEvent.change(screen.getByPlaceholderText('What was corrected, and why?'), { target: { value: 'Corrected price from DSR' } });
    fireEvent.click(screen.getByRole('button', { name: /Save corrections/ }));

    expect(await screen.findByText('Enter a valid RSP for this date.')).toBeInTheDocument();
    expect(screen.getByText(/1 field needs review/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('RSP 2026-11-01')).toHaveClass('server-needs-review'));
    expect(screen.getByLabelText('RSP 2026-11-01').closest('tr')).toHaveClass('server-needs-review');
  });
  it('continues a partial month without blocking, preserves saved mornings and recomputes the boundary day', async () => {
    const rows = [
      {date:'2026-11-01',tankReadings:[{tankId:'tank-1',openingStock:8000}],receiptQuantity:0,totalStock:8000,nozzleReadings:[{nozzleId:'nozzle-1',meterReading:1000}],testingQuantity:0,salesQuantity:100,cumulativeSales:100,sellingPrice:94},
      {date:'2026-11-02',tankReadings:[{tankId:'tank-1',openingStock:7900}],receiptQuantity:0,totalStock:7900,nozzleReadings:[{nozzleId:'nozzle-1',meterReading:1100}],testingQuantity:0,salesQuantity:0,cumulativeSales:100,sellingPrice:94},
    ];
    const record = {id:'existing',stationId:'station-1',productId:'product-1',month:'2026-11',monthStart:'2026-10-31T18:30:00Z',sourceFileName:'saved.pdf',cutoverApplied:false,createdAt:'2026-11-15T10:00:00Z',updatedAt:'2026-11-15T10:00:00Z',product:{code:'HSD',name:'Diesel'},importedBy:{name:'Owner'},corrections:[],rows};
    historicalSalesImports.mockResolvedValue({imports:[{...record,_count:{corrections:0}}]}); historicalSalesImport.mockResolvedValue({record});
    correctHistoricalSalesImport.mockImplementationOnce(async (_id, payload) => ({ record: { ...record, rows: payload.rows }, issues: [] }));
    render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:/Add missing days/}));
    expect(await screen.findByText(/Continue saved register/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('HSD-1 stock 2026-11-01')).not.toBeInTheDocument();
    expect(screen.getByLabelText('HSD-1 stock 2026-11-03')).toHaveValue(null);
    expect(screen.getByLabelText('D-1/HSD-1 meter 2026-11-03')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('HSD-1 stock 2026-11-03'),{target:{value:'7800'}});
    fireEvent.change(screen.getByLabelText('D-1/HSD-1 meter 2026-11-03'),{target:{value:'1200'}});
    expect(screen.getByText(/Awaiting next morning’s readings/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review & save days'}));
    expect(await screen.findByRole('dialog',{name:'Review register changes'})).toHaveTextContent('Adding 1 day · Updating 0 existing days');
    expect(correctHistoricalSalesImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Confirm changes'}));
    await waitFor(() => expect(correctHistoricalSalesImport).toHaveBeenCalledWith('existing',expect.objectContaining({ mode:'APPEND', expectedUpdatedAt:record.updatedAt, rows:expect.arrayContaining([expect.objectContaining({ date:'2026-11-02',salesQuantity:100 }),expect.objectContaining({date:'2026-11-03',salesQuantity:0})]) })));
    expect(createHistoricalSalesImport).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Add missing days', { selector: '.eyebrow' })).not.toBeInTheDocument());
    historicalSalesImports.mockResolvedValue({imports:[]});
  });

  it.each([false, true])('merges a new upload and replaces a saved date only when selected (%s)', async (replace) => {
    const makeRow = (day: number, meter: number) => ({date:`2026-11-0${day}`,tankReadings:[{tankId:'tank-1',openingStock:8100-day*100}],receiptQuantity:0,nozzleReadings:[{nozzleId:'nozzle-1',meterReading:meter}],testingQuantity:0,salesQuantity:0,sellingPrice:94});
    const record = {id:'saved-upload',stationId:'station-1',productId:'product-1',month:'2026-11',monthStart:'2026-10-31T18:30:00Z',sourceFileName:'saved.pdf',cutoverApplied:false,createdAt:'2026-11-15T10:00:00Z',updatedAt:'2026-11-15T10:00:00Z',product:{code:'HSD',name:'Diesel'},importedBy:{name:'Owner'},corrections:[],rows:[makeRow(1,1000),makeRow(2,1100)]};
    historicalSalesImports.mockResolvedValue({imports:[{...record,_count:{corrections:0}}]}); historicalSalesImport.mockResolvedValue({record});
    extractHistoricalSales.mockResolvedValueOnce({rows:[makeRow(1,1005),makeRow(3,1200)],warnings:[],layoutIssues:[],uncertainCells:[],periodNeedsConfirmation:false,effectiveMonth:'2026-11',periodSource:'DOCUMENT',confidence:1});
    const view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    await screen.findByRole('option',{name:/HSD/});
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!,{target:{files:[new File(['new source'],'more-days.pdf',{type:'application/pdf'})]}});
    await screen.findByText(/Draft ready/);
    fireEvent.click(screen.getByRole('checkbox',{name:/Confirm DSR period/}));
    fireEvent.click(screen.getByRole('button',{name:'Confirm historical import'}));
    expect(await screen.findByRole('dialog',{name:'Review matching dates'})).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox',{name:'Replace 2026-11-01'});
    expect(checkbox).not.toBeChecked(); if (replace) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button',{name:'Review combined register'}));
    await screen.findByText(/Continue saved register/);
    if (replace) {
      expect(screen.getByLabelText('D-1/HSD-1 meter 2026-11-01')).toHaveValue(1005);
      expect(screen.getByRole('button',{name:'Review & save days'})).toBeEnabled();
      fireEvent.change(screen.getByPlaceholderText('What was corrected, and why?'),{target:{value:'Corrected from original DSR'}});
    } else expect(screen.queryByLabelText('D-1/HSD-1 meter 2026-11-01')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review & save days'}));
    expect(await screen.findByRole('dialog',{name:'Review register changes'})).toHaveTextContent(`Updating ${replace ? 1 : 0} existing day`);
    expect(correctHistoricalSalesImport).not.toHaveBeenCalled();
    historicalSalesImports.mockResolvedValue({imports:[]});
  });

  it('autosaves manual readings without a source and restores them after leaving the page', async () => {
    historicalSalesImports.mockResolvedValue({imports:[]});
    let view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:/Enter manually/}));
    const stock = await screen.findByLabelText(/HSD-1 stock/);
    const date = stock.getAttribute('aria-label')!.slice(-10);
    fireEvent.change(stock,{target:{value:'8123.456'}});
    fireEvent.change(screen.getByLabelText(`D-1/HSD-1 meter ${date}`),{target:{value:'15123.789'}});
    expect(readManualHistoricalDraft('station-1','product-1',date.slice(0,7))?.rows[0]?.tankReadings[0]?.openingStock).toBe(8123.456);
    view.unmount();
    view = render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    expect(await screen.findByLabelText(`D-1/HSD-1 meter ${date}`)).toHaveValue(15123.789);
    expect(screen.getByLabelText(`HSD-1 stock ${date}`)).toHaveValue(8123.456);
    expect(createHistoricalSalesImport).not.toHaveBeenCalled();
    expect(correctHistoricalSalesImport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('option',{name:/MS ·/}).parentElement!,{target:{value:'product-2'}});
    await waitFor(() => expect(screen.queryByLabelText(`HSD-1 stock ${date}`)).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('option',{name:/HSD ·/}).parentElement!,{target:{value:'product-1'}});
    expect(await screen.findByLabelText(`HSD-1 stock ${date}`)).toHaveValue(8123.456);
  });
  it('restores unsubmitted continuation and correction reason, retains version and clears only after successful save', async () => {
    const row = {date:'2026-11-01',tankReadings:[{tankId:'tank-1',openingStock:8000}],receiptQuantity:0,nozzleReadings:[{nozzleId:'nozzle-1',meterReading:1000}],testingQuantity:0,salesQuantity:0,sellingPrice:94};
    const record = {id:'manual-saved',stationId:'station-1',productId:'product-1',month:'2026-11',monthStart:'2026-10-31T18:30:00Z',sourceFileName:'saved.pdf',cutoverApplied:false,createdAt:'2026-11-15T10:00:00Z',updatedAt:'2026-11-15T10:00:00Z',product:{code:'HSD',name:'Diesel'},importedBy:{name:'Owner'},corrections:[],rows:[row]};
    historicalSalesImports.mockResolvedValue({imports:[{...record,_count:{corrections:0}}]}); historicalSalesImport.mockResolvedValue({record});
    let view = render(<MemoryRouter initialEntries={['/?month=2026-11']}><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:/Add missing days/}));
    fireEvent.change(await screen.findByLabelText('HSD-1 stock 2026-11-02'),{target:{value:'7900'}});
    fireEvent.change(screen.getByLabelText('D-1/HSD-1 meter 2026-11-02'),{target:{value:'1100'}});
    fireEvent.click(screen.getByRole('button',{name:'Edit 2026-11-01'}));
    fireEvent.change(screen.getByLabelText('RSP 2026-11-01'),{target:{value:'95'}});
    fireEvent.change(screen.getByPlaceholderText('What was corrected, and why?'),{target:{value:'Corrected RSP from DSR'}});
    view.unmount();
    view = render(<MemoryRouter initialEntries={['/?month=2026-11']}><HistoricalSalesImportPage/></MemoryRouter>);
    expect(await screen.findByLabelText('D-1/HSD-1 meter 2026-11-02')).toHaveValue(1100);
    expect(screen.getByPlaceholderText('What was corrected, and why?')).toHaveValue('Corrected RSP from DSR');
    correctHistoricalSalesImport.mockRejectedValueOnce(new MockApiRequestError('Temporarily unavailable','OFFLINE'));
    fireEvent.click(screen.getByRole('button',{name:'Review & save days'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm changes'}));
    await screen.findByText('Temporarily unavailable');
    expect(readManualHistoricalDraft('station-1','product-1','2026-11')?.baseRegister?.updatedAt).toBe(record.updatedAt);
    correctHistoricalSalesImport.mockResolvedValueOnce({record:{...record,corrections:[],rows:[row]},issues:[]});
    fireEvent.click(screen.getByRole('button',{name:'Review & save days'}));
    if (screen.queryByRole('button',{name:'Confirm changes'})) fireEvent.click(screen.getByRole('button',{name:'Confirm changes'}));
    await waitFor(() => expect(readManualHistoricalDraft('station-1','product-1','2026-11')).toBeNull());
    expect(correctHistoricalSalesImport).toHaveBeenCalledWith(record.id,expect.objectContaining({expectedUpdatedAt:record.updatedAt,reason:'Corrected RSP from DSR',mode:'CORRECT'}));
    historicalSalesImports.mockResolvedValue({imports:[]});
  });

  it('discards only the local manual draft and warns clearly if browser saving fails', async () => {
    historicalSalesImports.mockResolvedValue({imports:[]});
    render(<MemoryRouter><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:/Enter manually/}));
    const stock = await screen.findByLabelText(/HSD-1 stock/);
    const date = stock.getAttribute('aria-label')!.slice(-10);
    const failSave = vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('Quota exceeded');});
    fireEvent.change(stock,{target:{value:'8765'}});
    expect(await screen.findByText(/Browser autosave is unavailable/)).toBeInTheDocument();
    expect(stock).toHaveValue(8765);
    failSave.mockRestore();
    fireEvent.change(stock,{target:{value:'8766'}});
    expect(readManualHistoricalDraft('station-1','product-1',date.slice(0,7))).not.toBeNull();
    const confirm = vi.spyOn(window,'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button',{name:'Discard draft'}));
    await waitFor(() => expect(screen.queryByLabelText(/HSD-1 stock/)).not.toBeInTheDocument());
    expect(readManualHistoricalDraft('station-1','product-1',date.slice(0,7))).toBeNull();
    expect(createHistoricalSalesImport).not.toHaveBeenCalled();
    expect(correctHistoricalSalesImport).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('rechecks a corrected saved boundary meter without requiring a reason until save', async () => {
    const makeRow = (day: number, meter: number, stock: number) => ({date:`2026-11-${day}`,tankReadings:[{tankId:'tank-1',openingStock:stock}],receiptQuantity:0,nozzleReadings:[{nozzleId:'nozzle-1',meterReading:meter}],testingQuantity:0,salesQuantity:0,sellingPrice:94});
    const record = {id:'boundary',stationId:'station-1',productId:'product-1',month:'2026-11',monthStart:'2026-10-31T18:30:00Z',sourceFileName:'saved.pdf',cutoverApplied:false,createdAt:'2026-11-15T10:00:00Z',updatedAt:'2026-11-15T10:00:00Z',product:{code:'HSD',name:'Diesel'},importedBy:{name:'Owner'},corrections:[],rows:[makeRow(12,1200,8000),makeRow(13,1500,7900)]};
    historicalSalesImports.mockResolvedValue({imports:[{...record,_count:{corrections:0}}]}); historicalSalesImport.mockResolvedValue({record});
    validateHistoricalSalesCorrection.mockReset().mockResolvedValueOnce({issues:[{date:'2026-11-14',level:'ERROR',field:'nozzleReadings',message:'A nozzle meter reading moves backwards or does not match the configured nozzles.'}]}).mockResolvedValueOnce({issues:[]});
    correctHistoricalSalesImport.mockImplementationOnce(async (_id,payload) => ({record:{...record,rows:payload.rows},issues:[]}));
    render(<MemoryRouter initialEntries={['/?month=2026-11']}><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:/Add missing days/}));
    fireEvent.change(await screen.findByLabelText('HSD-1 stock 2026-11-14'),{target:{value:'7800'}});
    fireEvent.change(screen.getByLabelText('D-1/HSD-1 meter 2026-11-14'),{target:{value:'1400'}});
    expect(screen.getByText(/reads 1,400 L on 2026-11-14, below 1,500 L on 2026-11-13/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Check data'}));
    await waitFor(() => expect(validateHistoricalSalesCorrection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button',{name:'Check data'})).toBeEnabled());
    await screen.findByLabelText('D-1/HSD-1 meter 2026-11-13');
    const meter = screen.getByLabelText('D-1/HSD-1 meter 2026-11-13');
    expect(meter).toHaveValue(1500); expect(meter).toHaveAttribute('aria-invalid','true');
    fireEvent.change(meter,{target:{value:'1300'}});
    expect(screen.queryByText(/below 1,500 L/)).not.toBeInTheDocument();
    expect(screen.queryByText(/moves backwards/)).not.toBeInTheDocument();
    expect(meter).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Nozzle sales 2026-11-13')).toHaveValue(100);
    expect(screen.getByLabelText('Cumulative sales 2026-11-13')).toHaveValue(200);
    expect(screen.getByLabelText('Sales value 2026-11-13')).toHaveValue(9400);
    fireEvent.change(screen.getByLabelText('Reason for correction'),{target:{value:'a'}});
    fireEvent.click(screen.getByRole('button',{name:'Check data'}));
    expect(await screen.findByText(/Data checked. No errors found/)).toBeInTheDocument();
    expect(validateHistoricalSalesCorrection).toHaveBeenLastCalledWith(record.id,expect.objectContaining({mode:'CORRECT',reason:'Check readings only; no changes saved.',rows:expect.arrayContaining([expect.objectContaining({date:'2026-11-13',salesQuantity:100})])}));
    fireEvent.click(screen.getByRole('button',{name:'Review & save days'}));
    expect(screen.getByLabelText('Reason for correction')).toHaveFocus();
    expect(screen.getByText(/You changed saved readings. Enter a short reason/)).toBeInTheDocument();
    expect(correctHistoricalSalesImport).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason for correction'),{target:{value:'Corrected 13th meter against DSR'}});
    fireEvent.click(screen.getByRole('button',{name:'Review & save days'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm changes'}));
    await waitFor(() => expect(correctHistoricalSalesImport).toHaveBeenCalledWith(record.id,expect.objectContaining({mode:'CORRECT',reason:'Corrected 13th meter against DSR',expectedUpdatedAt:record.updatedAt})));
    historicalSalesImports.mockResolvedValue({imports:[]});
  });

  it('expands both saved mornings for a backward comparison and keeps them editable after fixing it', async () => {
    const makeRow = (day: number, meter: number) => ({date:`2026-11-${day}`,tankReadings:[{tankId:'tank-1',openingStock:9000-day*100}],receiptQuantity:0,nozzleReadings:[{nozzleId:'nozzle-1',meterReading:meter}],testingQuantity:0,salesQuantity:0,sellingPrice:94});
    const record = {id:'previous-morning',stationId:'station-1',productId:'product-1',month:'2026-11',monthStart:'2026-10-31T18:30:00Z',sourceFileName:'saved.pdf',cutoverApplied:false,createdAt:'2026-11-15T10:00:00Z',updatedAt:'2026-11-15T10:00:00Z',product:{code:'HSD',name:'Diesel'},importedBy:{name:'Owner'},corrections:[],rows:[makeRow(12,13328),makeRow(13,12627)]};
    historicalSalesImports.mockResolvedValue({imports:[{...record,_count:{corrections:0}}]}); historicalSalesImport.mockResolvedValue({record});
    render(<MemoryRouter initialEntries={['/?month=2026-11']}><HistoricalSalesImportPage/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:/Add missing days/}));
    const previous = await screen.findByLabelText('D-1/HSD-1 meter 2026-11-12');
    const current = screen.getByLabelText('D-1/HSD-1 meter 2026-11-13');
    expect(previous).toHaveValue(13328); expect(current).toHaveValue(12627);
    expect(previous).toHaveAttribute('aria-invalid','true'); expect(current).toHaveAttribute('aria-invalid','true');
    fireEvent.change(previous,{target:{value:'12328'}});
    expect(screen.queryByText(/below 13,328 L/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('D-1/HSD-1 meter 2026-11-12')).toHaveValue(12328);
    expect(screen.getByLabelText('D-1/HSD-1 meter 2026-11-13')).toHaveValue(12627);
    expect(previous).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Nozzle sales 2026-11-12')).toHaveValue(299);
    expect(screen.getByLabelText('Reason for correction')).toBeInTheDocument();
    expect(correctHistoricalSalesImport).not.toHaveBeenCalled();
    historicalSalesImports.mockResolvedValue({imports:[]});
  });

});
