import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationsPage } from './OperationsPage';

const { shiftBootstrap, tankReceiptHistory, openShift } = vi.hoisted(() => ({
  shiftBootstrap: vi.fn(),
  tankReceiptHistory: vi.fn(),
  openShift: vi.fn(),
}));
vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { shiftBootstrap, tankReceiptHistory, openShift },
}));
vi.mock('../components/StationProvider', () => ({
  useStation: () => ({ selectedStationId: 'station-1', selectStation: vi.fn() }),
}));
afterEach(cleanup);

it('carries cash forward, explains withdrawals and preserves the actual count on refresh', async () => {
  const initial = workspace(0);
  Object.assign(initial.stations[0]!.lastClosing, { shiftId: 'prior', shiftNumber: 1, closingCash: '1000.25' });
  const updated = structuredClone(initial);
  Object.assign(updated.stations[0]!.lastClosing, { closingCash: '1200.25' });
  shiftBootstrap.mockReset().mockResolvedValueOnce(initial).mockResolvedValue(updated);
  openShift.mockReset().mockResolvedValue({ shift: { id: 'new' } });
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  const counted = await screen.findByRole('spinbutton', { name: 'Physical cash at start (₹)' });
  expect(counted).toHaveValue(1000.25);
  fireEvent.click(screen.getByText('Cash added, removed or handed over (if applicable)'));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Cash removed between shifts (₹)' }), { target: { value: '800' } });
  fireEvent.change(counted, { target: { value: '200.25' } });
  fireEvent.click(screen.getByRole('button', { name: /^Open shift$/ }));
  expect(await screen.findByText('Add a cash handover reason before opening this shift.')).toBeInTheDocument();
  expect(openShift).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: /Cash handover reason/ }), { target: { value: 'Cash handed to owner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh cash' }));
  expect(await screen.findByText(/Previous closing cash refreshed/)).toBeInTheDocument();
  expect(counted).toHaveValue(200.25);
  expect(screen.getByRole('spinbutton', { name: 'Cash removed between shifts (₹)' })).toHaveValue(800);
  fireEvent.click(screen.getByRole('button', { name: /^Open shift$/ }));
  await screen.findByText('Opening cash handover');
  expect(openShift).toHaveBeenCalledWith(expect.objectContaining({ openingCash: 200.25, cashHandover: {
    previousShiftId: 'prior', previousClosingCash: 1200.25, added: 0, removed: 800, reason: 'Cash handed to owner',
  } }));
});

const tank = (id: string, code: string) => ({ id, code, openingStock: '1000', product: { code } });
const workspace = (received: number, book = 1000 + received) => ({
    stations: [{
      id: 'station-1', name: 'Test fuel station', code: 'S1',
      lastClosing: { closedAt: '2025-09-06T08:00:00Z', tankReadings: [], nozzleReadings: [], nozzleAssignments: [] },
      configurations: [{ tanks: [tank('ms', 'MS'), tank('hsd', 'HSD')], dispensers: [] }],
      availableTankStock: ['ms', 'hsd'].map(id => ({
        id, value: String(book), lastActual: '1000', received: String(received),
        adjustments: '0', netOther: '0', expectedOpening: String(1000 + received),
      })),
    }],
    users: [{ id: 'owner', name: 'Owner', role: 'OWNER', stationIds: [] }],
    shifts: [],
    stockVarianceTolerance: 50,
});

it('shows receipts in Operations and refreshes only the opening dips the user has not edited', async () => {
  shiftBootstrap.mockResolvedValueOnce(workspace(300)).mockResolvedValueOnce(workspace(500));
  tankReceiptHistory.mockResolvedValue({ nextCursor: null, receipts: [{
    id: 'receipt', quantity: '200', occurredAt: '2025-09-06T08:00:00Z', reference: 'INV-1',
    supplier: 'Supplier', tank: 'MS', product: 'MS', unit: 'LITRE',
    period: 'GAP', shiftNumber: null, shiftId: null,
  }] });

  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  const ms = await screen.findByRole('spinbutton', { name: 'Actual opening dip in litres for MS · MS' });
  const hsd = screen.getByRole('spinbutton', { name: 'Actual opening dip in litres for HSD · HSD' });
  expect(ms).toHaveValue(1300);
  fireEvent.change(ms, { target: { value: '1320' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh stock' }));
  expect(await screen.findAllByText('Expected opening 1,500 L')).toHaveLength(2);
  expect(ms).toHaveValue(1320);
  expect(hsd).toHaveValue(1500);
  expect(screen.getByText("Expected opening stock updated.")).toBeInTheDocument();
  expect(shiftBootstrap).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to expected opening for MS · MS' }));
  expect(ms).toHaveValue(1500);

  fireEvent.click(screen.getByText('Tank receipt history'));
  expect(await screen.findByText('Between shifts · awaiting next opening')).toBeInTheDocument();
  expect(screen.getByText(/INV-1 · Supplier/)).toBeInTheDocument();
  expect(tankReceiptHistory).toHaveBeenCalledWith('station-1', undefined);
});

it('explains why a fresh opening estimate can differ from book stock and links to receipts', async () => {
  shiftBootstrap.mockResolvedValue(workspace(0, 5000));
  tankReceiptHistory.mockResolvedValue({ nextCursor: null, receipts: [] });

  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  const ms = await screen.findByRole('spinbutton', { name: 'Actual opening dip in litres for MS · MS' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh stock' }));
  expect(await screen.findByText('Stock refreshed. The expected opening is unchanged.')).toBeInTheDocument();
  expect(screen.getAllByText('Book stock is 4,000 L higher.')).toHaveLength(2);
  expect(ms).toHaveValue(1000);

  fireEvent.click(screen.getByRole('button', { name: 'Review tank receipt history' }));
  expect(await screen.findByText('No posted tank receipts for this fuel station.')).toBeInTheDocument();
});

it('keeps the first shift focused on starting cash without historical comparisons', async () => {
  const first = workspace(0);
  Object.assign(first.stations[0]!, { lastClosing: null });
  shiftBootstrap.mockReset().mockResolvedValue(first);
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', {name:'Starting cash'})).toBeInTheDocument();
  expect(screen.getByRole('spinbutton', {name:'Physical cash at start (₹)'})).toHaveValue(0);
  expect(screen.queryByText('Starting count required')).not.toBeInTheDocument();
  expect(screen.queryByText('No previous count to compare')).not.toBeInTheDocument();
  expect(screen.getByText('Cash added, removed or handed over (if applicable)').closest('details')).not.toHaveAttribute('open');
});

it('labels staff totals as mixed collections while keeping closing till cash separate', async () => {
  const data: any = workspace(0);
  data.shifts = [{ id: 'live', shiftNumber: 1, status: 'OPEN', openedAt: '2026-11-21T06:00:00Z',
    station: { id: 'station-1', name: 'Test fuel station' }, manager: { name: 'Owner' }, openingCash: 500,
    nozzleReadings: [{ nozzleId: 'n', openingMeter: 1000, nozzle: { code: 'N1', product: { name: 'MS', code: 'MS' }, dispenser: { code: 'D1', location: null } } }],
    nozzleAssignments: [{ nozzleId: 'n', collectionAmount: 10000, user: { name: 'Staff' } }], tankReadings: [] }];
  shiftBootstrap.mockReset().mockResolvedValue(data);
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Total collections in rupees from Staff' })).toHaveValue(10000));
  expect(screen.getByRole('spinbutton', { name: 'Physical cash counted at closing (₹)' })).toHaveValue(500);
  expect(screen.getByText(/Split and verify payment methods in reconciliation next/)).toBeInTheDocument();
  expect(screen.queryByText('Physical cash handed over (₹)')).not.toBeInTheDocument();
});
