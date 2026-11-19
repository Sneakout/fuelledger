import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReconciliationPage } from './ReconciliationPage';

const { bootstrap, reconcile } = vi.hoisted(() => ({ bootstrap: vi.fn(), reconcile: vi.fn() }));
vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { reconciliationBootstrap: bootstrap, reconcileShift: reconcile },
}));
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
const shift = (id = 'shift-1', number = 1) => ({
  id, shiftNumber: number, status: 'RECONCILIATION_REQUIRED', closedAt: '2026-11-18T15:00:00Z',
  station: { id: 'station-1', name: 'Test fuel station' }, manager: { name: 'Owner' },
  salesTotal: 1000, expected: { CASH: 1000 }, allocatedExpected: { CASH: 1000 },
  suggestedActual: { CASH: 1000 }, reconciliation: null,
});
const lockedShift = () => ({ ...shift(), status: 'LOCKED', reconciliation: {
  reconciledBy: { name: 'Owner' }, notes: '', creditAllocations: [],
  collections: [{ paymentMethod: 'CASH', expectedAmount: 1000, adjustmentAmount: 0, actualAmount: 1000 }],
} });
function mount(url = '/reconciliation') {
  return render(<MemoryRouter initialEntries={[url]}><ReconciliationPage /></MemoryRouter>);
}
it('explains the empty state and provides a route to operations', async () => {
  bootstrap.mockResolvedValue({ shifts: [], customers: [] });
  mount();
  expect(await screen.findByRole('heading', { name: 'No shifts are waiting for review' })).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/operations');
});
it('uses the saved shift immediately, without a second list request that can drop the selected shift', async () => {
  bootstrap.mockResolvedValueOnce({ shifts: [shift()], customers: [] }).mockRejectedValue(new Error('offline'));
  let complete!: (value: unknown) => void;
  reconcile.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  mount('/reconciliation?shiftId=shift-1');
  fireEvent.click(await screen.findByRole('button', { name: 'Reconcile & lock shift' }));
  expect(screen.getByRole('button', { name: 'Locking…' })).toBeDisabled();
  expect(screen.getByRole('spinbutton', { name: 'Cash sales amount in rupees' })).toBeDisabled();
  await act(async () => { complete({ shift: lockedShift() }); });
  expect(await screen.findByText('Reconciled & locked')).toBeInTheDocument();
  expect(screen.getByText(/Shift #1 reconciled and locked/)).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: 'Cash sales amount in rupees' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Cash sales amount in rupees')).toHaveTextContent('₹1,000.00');
  expect(bootstrap).toHaveBeenCalledTimes(1);
  expect(bootstrap).toHaveBeenCalledWith('shift-1');
  expect(reconcile).toHaveBeenCalledTimes(1);
});
it('keeps edited amounts when a save fails and provides a useful error', async () => {
  bootstrap.mockResolvedValue({ shifts: [shift()], customers: [] });
  reconcile.mockRejectedValue(new Error('offline'));
  mount();
  const actual = await screen.findByRole('spinbutton', { name: 'Cash verified amount in rupees' });
  fireEvent.change(actual, { target: { value: '950' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile & lock shift' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reconcile this shift.');
  expect(actual).toHaveValue(950);
  expect(screen.getByRole('button', { name: 'Reconcile & lock shift' })).toBeEnabled();
});
it('shows a retryable load failure instead of remaining on a loading screen', async () => {
  bootstrap.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ shifts: [lockedShift()], customers: [] });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Reconciliation could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Reconciled & locked')).toBeInTheDocument();
});
it('ignores an older response after the requested shift changes', async () => {
  let oldResponse!: (value: unknown) => void;
  bootstrap.mockReturnValueOnce(new Promise(resolve => { oldResponse = resolve; }))
    .mockResolvedValueOnce({ shifts: [shift('shift-2', 2)], customers: [] });
  function SwitchShift() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate('/reconciliation?shiftId=shift-2')}>Next shift</button><ReconciliationPage /></>;
  }
  render(<MemoryRouter initialEntries={['/reconciliation?shiftId=shift-1']}><SwitchShift /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Next shift' }));
  await waitFor(() => expect(screen.getByText('Shift #2')).toBeInTheDocument());
  await act(async () => { oldResponse({ shifts: [shift()], customers: [] }); });
  expect(screen.getByText('Shift #2')).toBeInTheDocument();
  expect(screen.queryByText('Shift #1')).not.toBeInTheDocument();
});

it('explains an unavailable linked shift rather than showing a blank detail panel', async () => {
  bootstrap.mockResolvedValue({ shifts: [shift('another-shift', 2)], customers: [] });
  mount('/reconciliation?shiftId=missing');
  expect(await screen.findByRole('alert')).toHaveTextContent('Shift unavailable');
});

it('does not switch back to a previous shift when its save finishes after navigation', async () => {
  let complete!: (value: unknown) => void;
  bootstrap.mockResolvedValueOnce({ shifts: [shift()], customers: [] })
    .mockResolvedValueOnce({ shifts: [shift('shift-2', 2)], customers: [] });
  reconcile.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  function SwitchShift() {
    const navigate = useNavigate();
    return <><button onClick={() => navigate('/reconciliation?shiftId=shift-2')}>Next shift</button><ReconciliationPage /></>;
  }
  render(<MemoryRouter initialEntries={['/reconciliation?shiftId=shift-1']}><SwitchShift /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Reconcile & lock shift' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next shift' }));
  await screen.findByText('Shift #2');
  await act(async () => { complete({ shift: lockedShift() }); });
  expect(screen.getByText('Shift #2')).toBeInTheDocument();
  expect(screen.queryByText('Reconciled & locked')).not.toBeInTheDocument();
});
