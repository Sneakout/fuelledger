import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationsPage } from './OperationsPage';

const { shiftBootstrap, tankReceiptHistory, openShift, cancelShift, closeShift, shiftClosingPreview } = vi.hoisted(() => ({
  shiftBootstrap: vi.fn(),
  tankReceiptHistory: vi.fn(),
  openShift: vi.fn(),
  cancelShift: vi.fn(),
  closeShift: vi.fn(),
  shiftClosingPreview: vi.fn(),
}));
vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { shiftBootstrap, tankReceiptHistory, openShift, cancelShift, closeShift, shiftClosingPreview },
}));
vi.mock('../components/StationProvider', () => ({
  useStation: () => ({ selectedStationId: 'station-1', selectStation: vi.fn() }),
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

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
  fireEvent.click(screen.getByText('Cash added, bank deposits or other withdrawals (if applicable)'));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Cash handed to owner / other withdrawals (₹)' }), { target: { value: '600' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Cash deposited in bank between shifts (₹)' }), { target: { value: '200' } });
  fireEvent.change(counted, { target: { value: '200.25' } });
  fireEvent.click(screen.getByRole('button', { name: /^Open shift$/ }));
  expect(await screen.findByText('Add a cash handover reason before opening this shift.')).toBeInTheDocument();
  expect(openShift).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: /Cash handover reason/ }), { target: { value: 'Cash handed to owner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh cash' }));
  expect(await screen.findByText(/Previous closing cash refreshed/)).toBeInTheDocument();
  expect(counted).toHaveValue(200.25);
  expect(screen.getByRole('spinbutton', { name: 'Cash handed to owner / other withdrawals (₹)' })).toHaveValue(600);
  expect(screen.getByRole('spinbutton', { name: 'Cash deposited in bank between shifts (₹)' })).toHaveValue(200);
  fireEvent.click(screen.getByRole('button', { name: /^Open shift$/ }));
  await screen.findByText('Opening cash handover');
  expect(openShift).toHaveBeenCalledWith(expect.objectContaining({ openingCash: 200.25, cashHandover: {
    previousShiftId: 'prior', previousClosingCash: 1200.25, added: 0, removed: 800, bankDeposited: 200, otherWithdrawals: 600, reason: 'Cash handed to owner',
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
  expect(await screen.findByText('No purchase or confirmed DSR tank receipts for this fuel station.')).toBeInTheDocument();
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
  expect(screen.getByText('Cash added, bank deposits or other withdrawals (if applicable)').closest('details')).not.toHaveAttribute('open');
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

it('shows confirmed DSR receipts with their business day without inventing a shift or receipt time', async () => {
 shiftBootstrap.mockResolvedValue(workspace(0));
 tankReceiptHistory.mockResolvedValue({nextCursor:null,receipts:[{
  id:'dsr:import:2026-11-20',source:'DSR',businessDate:'2026-11-20',sourceUrl:'/sales/history/import?stationId=station-1&productId=hsd&month=2026-11',
  quantity:'600',dsrQuantity:'1000',postedQuantity:'400',occurredAt:'2026-11-19T18:30:00Z',reference:'Confirmed historical DSR',supplier:null,
  tank:'T2',product:'HSD',unit:'LITRE',period:'DATE_ONLY',shiftNumber:null,shiftId:null,
 }]});
 render(<MemoryRouter><OperationsPage/></MemoryRouter>);
 await screen.findByText('Tank receipt history'); fireEvent.click(screen.getByText('Tank receipt history'));
 expect(await screen.findByText(/Confirmed historical DSR · 20 Nov 2026 · day only/)).toBeInTheDocument();
 expect(screen.getByText('Receipt day recorded in DSR · exact time unavailable')).toBeInTheDocument();
 expect(screen.getByText(/Already recorded through purchases 400 L/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'View DSR'})).toHaveAttribute('href','/sales/history/import?stationId=station-1&productId=hsd&month=2026-11');
 expect(screen.queryByRole('button',{name:/View shift #/})).not.toBeInTheDocument();
});

it('opens from the reviewed DSR morning values and submits their version', async () => {
  const data: any = workspace(1000);
  data.stations[0].lastClosing.closingCash = "0";
  data.stations[0].openingReadings = { version: 'reviewed-dsr', blockingReason: null,
    tanks: [{ id: 'ms', value: 7719.826000000001, date: '2026-11-25', registerId: 'register' }],
    nozzles: [{ id: 'n', value: 20000, source: 'DSR', date: '2026-11-25' }],
  };
  data.stations[0].configurations[0].dispensers = [{ code: 'D1', location: null, nozzles: [{ id: 'n', code: 'N1', openingMeter: 12627, product: { code: 'MS', name: 'Petrol' } }] }];
  shiftBootstrap.mockReset().mockResolvedValue(data); openShift.mockReset().mockResolvedValue({ shift: { id: 'new' } });
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  expect(await screen.findByText('Start from confirmed DSR · 2026-11-25 morning')).toBeInTheDocument();
  expect(screen.getByRole('spinbutton', { name: 'DSR morning stock in litres for MS · MS' })).toHaveValue(7719.83);
  expect(screen.getByRole('spinbutton', { name: 'DSR morning stock in litres for MS · MS' })).toHaveAttribute('readonly');
  expect(screen.getByText('20,000')).toBeInTheDocument();
  expect(screen.getByText('MS/Petrol')).toHaveClass('nozzle-product-name');
  const attendant = screen.getByRole('combobox', { name: /Attendant for D1/ });
  expect(attendant).toBeRequired();
  expect(attendant).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: /^Open shift$/ }));
  expect(await screen.findByText('Assign an attendant to every nozzle before opening this shift.')).toBeInTheDocument();
  expect(openShift).not.toHaveBeenCalled();
  expect(attendant).toHaveFocus();
  fireEvent.change(attendant, { target: { value: 'owner' } });
  fireEvent.click(screen.getByRole('button', { name: /^Open shift$/ }));
  await waitFor(() => expect(openShift).toHaveBeenCalledWith(expect.objectContaining({ openingReadingsVersion: 'reviewed-dsr', nozzleReadings: [{ id: 'n', value: 20000 }], tankReadings: expect.arrayContaining([{ id: 'ms', value: 7719.826000000001 }]) })));
});

it('requires an owner confirmation and reason before cancelling, then loads replacement readings', async () => {
  const data: any = workspace(0); data.canCancelShift = true;
  data.shifts = [{ id: 'mistake', shiftNumber: 1, status: 'OPEN', openedAt: '2026-11-24T13:03:00Z',
    station: { id: 'station-1', name: 'Test fuel station' }, manager: { name: 'Owner' }, openingCash: 0,
    nozzleReadings: [], nozzleAssignments: [], tankReadings: [] }];
  const replacement: any = workspace(0); replacement.canCancelShift = true;
  replacement.cancelledShifts = [{ id: 'mistake', stationId: 'station-1', shiftNumber: 1, cancellation: { reason: 'Opened with old readings', cancelledAt: '2026-11-25T06:00:00Z', cancelledByName: 'Owner' } }];
  shiftBootstrap.mockReset().mockResolvedValueOnce(data).mockResolvedValue(replacement);
  tankReceiptHistory.mockResolvedValue({ receipts: [], nextCursor: null });
  cancelShift.mockReset().mockResolvedValue({ shift: { id: 'mistake', status: 'CANCELLED' } });
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText('Opened this shift by mistake?'));
  const button = screen.getByRole('button', { name: 'Cancel mistaken shift' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for cancellation' }), { target: { value: 'Opened with old readings' } });
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirm shift #1/ }));
  fireEvent.click(button);
  expect(await screen.findByText(/Shift #1 was cancelled/)).toBeInTheDocument();
  expect(cancelShift).toHaveBeenCalledWith('mistake', 'Opened with old readings');
  expect(await screen.findByText('Cancelled shifts')).toBeInTheDocument();
  expect(screen.getByText('Opened with old readings')).toBeInTheDocument();
});

it('defaults to close now and checks a selected past IST closing time without losing entered counts', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-26T06:00:00Z'));
  const data: any = workspace(0);
  const active = { id: 'live', shiftNumber: 2, status: 'OPEN', openedAt: '2026-11-25T06:00:00Z',
    station: { id: 'station-1', name: 'Test fuel station' }, manager: { name: 'Owner' }, openingCash: 0,
    nozzleReadings: [], nozzleAssignments: [], tankReadings: [] };
  data.shifts = [active];
  shiftBootstrap.mockReset().mockResolvedValue(data);
  tankReceiptHistory.mockResolvedValue({ receipts: [], nextCursor: null });
  shiftClosingPreview.mockReset().mockResolvedValue({ shift: active, closingAt: '2026-11-25T12:00:00Z' });
  closeShift.mockReset().mockResolvedValue({ shift: { id: 'live' } });
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  const mode = await screen.findByRole('combobox', { name: 'Shift closing time' });
  expect(mode).toHaveValue('now');
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Physical cash counted at closing (₹)' }), { target: { value: '250' } });
  fireEvent.change(mode, { target: { value: 'custom' } });
  const time = screen.getByLabelText('Closing date and time (IST)');
  fireEvent.change(time, { target: { value: '2026-11-25T10:00' } });
  expect(screen.getByText('Closing time cannot be before this shift opened.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close & review shift' })).toBeDisabled();
  fireEvent.change(time, { target: { value: '2026-11-27T10:00' } });
  expect(screen.getByText('Closing time cannot be in the future.')).toBeInTheDocument();
  fireEvent.change(time, { target: { value: '2026-11-25T17:30' } });
  await waitFor(() => expect(shiftClosingPreview).toHaveBeenCalledWith('live', '2026-11-25T12:00:00.000Z'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close & review shift' })).toBeEnabled());
  expect(screen.getByRole('spinbutton', { name: 'Physical cash counted at closing (₹)' })).toHaveValue(250);
  fireEvent.click(screen.getByRole('button', { name: 'Close & review shift' }));
  await waitFor(() => expect(closeShift).toHaveBeenCalledWith('live', expect.objectContaining({ closedAt: '2026-11-25T12:00:00.000Z', closingCash: 250 })));
});
