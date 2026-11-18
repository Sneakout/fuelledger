import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationsPage } from './OperationsPage';

const { shiftBootstrap, tankReceiptHistory } = vi.hoisted(() => ({
  shiftBootstrap: vi.fn(),
  tankReceiptHistory: vi.fn(),
}));
vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { shiftBootstrap, tankReceiptHistory },
}));
vi.mock('../components/StationProvider', () => ({
  useStation: () => ({ selectedStationId: 'station-1', selectStation: vi.fn() }),
}));
afterEach(cleanup);

it('shows receipts in Operations and refreshes only the opening dips the user has not edited', async () => {
  const tank = (id: string, code: string) => ({ id, code, openingStock: '1000', product: { code } });
  const workspace = (received: number) => ({
    stations: [{
      id: 'station-1', name: 'Test fuel station', code: 'S1',
      lastClosing: { closedAt: '2025-09-06T08:00:00Z', tankReadings: [], nozzleReadings: [], nozzleAssignments: [] },
      configurations: [{ tanks: [tank('ms', 'MS'), tank('hsd', 'HSD')], dispensers: [] }],
      availableTankStock: ['ms', 'hsd'].map(id => ({
        id, value: String(1000 + received), lastActual: '1000', received: String(received),
        adjustments: '0', netOther: '0', expectedOpening: String(1000 + received),
      })),
    }],
    users: [{ id: 'owner', name: 'Owner', role: 'OWNER', stationIds: [] }],
    shifts: [],
    stockVarianceTolerance: 50,
  });
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

  fireEvent.click(screen.getByText('Tank receipt history'));
  expect(await screen.findByText('Between shifts · awaiting next opening')).toBeInTheDocument();
  expect(screen.getByText(/INV-1 · Supplier/)).toBeInTheDocument();
  expect(tankReceiptHistory).toHaveBeenCalledWith('station-1', undefined);
});
