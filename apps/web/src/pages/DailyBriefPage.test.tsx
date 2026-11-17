import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyBriefPage } from './DailyBriefPage';

const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { dailyBriefWorkspace: load, setDailyBriefPreference: save }, ApiRequestError: class extends Error {} }));
vi.mock('../components/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('../components/StationProvider', () => ({ useStation: () => ({ selectedStationId: 'station', stations: [{ id: 'station', name: 'Fixture fuel station' }], loading: false }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Daily Brief', () => {
  it('puts the next action first and keeps an acknowledged issue out of Resolved', async () => {
    const checkedAt = '2026-11-17T05:00:00Z';
    load.mockResolvedValue({
      station: { id: 'station', name: 'Fixture fuel station' }, date: '2026-11-17', checkedAt, demo: false,
      coverage: { incompleteShifts: 1, noSales: false, collectionsIncomplete: true, stockUnavailable: false,
        gaps: [{ productId: 'hsd', productCode: 'HSD', missingFrom: '2026-11-16', missingThrough: '2026-11-16', missingDates: ['2026-11-16'], path: '/sales/history/import?productId=hsd&month=2026-11' }] },
      attention: [{ key: 'shift', title: 'Shift #1 needs reconciliation', agent: 'Shift Review', severity: 'URGENT', impact: 'Collections are provisional.',
        action: 'Review closing collections.', amount: null, checkedAt, records: [{ label: 'Shift #1', path: '/reconciliation?shiftId=one' }], acknowledgedAt: null, remindAt: null }],
      summary: { sales: 200, collections: null, credit: 0, creditIssued: 0, stock: [], receipts: [], products: [] },
      approvals: [], specialists: [], upcoming: { suppliers: [], customers: [], replenishment: [] }, resolved: [],
    });
    save.mockResolvedValue({ acknowledgedAt: checkedAt, remindAt: null });
    render(<MemoryRouter><DailyBriefPage /></MemoryRouter>);
    await screen.findByText('Shift #1 needs reconciliation');
    expect(screen.getAllByRole('heading', { level: 2 }).map(item => item.textContent)).toEqual([
      'Needs your attention', 'Daily operating summary', 'Approvals waiting', 'Specialist reviews', 'Upcoming', 'Resolved', 'Ask FuelNerve',
    ]);
    const attention = screen.getByRole('region', { name: 'Needs your attention' });
    expect(within(attention).getByText(/1 missing DSR day/)).toBeInTheDocument();
    expect(within(attention).getByRole('link', { name: 'View record: Shift #1' })).toHaveAttribute('href', '/reconciliation?shiftId=one');
    fireEvent.click(within(attention).getByRole('button', { name: 'Acknowledge' }));
    await screen.findByText('Acknowledged. The finding remains open.');
    expect(within(attention).getByText('Shift #1 needs reconciliation')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resolved' })).getByText(/No recorded closures/)).toBeInTheDocument();
  });
});

describe('Daily Brief record states', () => {
  const clean = (checkedAt: string) => ({
    station: { id: 'station', name: 'Fixture fuel station' }, date: '2026-11-17', checkedAt, demo: false,
    coverage: { incompleteShifts: 0, noSales: false, collectionsIncomplete: false, stockUnavailable: false, gaps: [] },
    attention: [], summary: { sales: 200, collections: 200, credit: 0, creditIssued: 0, stock: [], receipts: [], products: [] },
    approvals: [], specialists: [], upcoming: { suppliers: [], customers: [], replenishment: [] }, resolved: [],
  });

  it('reports loading, then distinguishes no findings from incomplete records after refresh', async () => {
    const data = clean(new Date().toISOString());
    load.mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, coverage: { ...data.coverage, noSales: true } });
    render(<MemoryRouter><DailyBriefPage /></MemoryRouter>);
    expect(screen.getByText('Loading the daily brief…')).toBeInTheDocument();
    expect(await screen.findByText('No open issue found in the records checked.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('The available records do not support an all-clear.')).toBeInTheDocument();
    expect(screen.getByText('No records')).toBeInTheDocument();
  });

  it('flags stale results, preserves them on refresh failure and then shows the resolved record', async () => {
    load.mockResolvedValueOnce(clean(new Date(Date.now() - 16 * 60_000).toISOString()))
      .mockRejectedValueOnce(new Error('Private server failure'))
      .mockResolvedValueOnce({ ...clean(new Date().toISOString()), resolved: [{
        id: 'closed', title: 'Shift #1 reconciled', detail: 'Cash and UPI verified', closedAt: new Date().toISOString(), path: '/reconciliation?shiftId=one',
      }] });
    render(<MemoryRouter><DailyBriefPage /></MemoryRouter>);
    expect(await screen.findByText(/checked at least 15 minutes ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last successful check.');
    expect(screen.getByText('No open issue found in the records checked.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Shift #1 reconciled')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resolved' })).getByRole('link', { name: 'View record' }))
      .toHaveAttribute('href', '/reconciliation?shiftId=one');
    expect(screen.queryByText(/checked at least 15 minutes ago/)).not.toBeInTheDocument();
  });
});
