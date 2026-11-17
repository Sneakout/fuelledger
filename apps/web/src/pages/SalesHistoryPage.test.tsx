import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesHistoryPage } from './SalesHistoryPage';

const { salesHistory } = vi.hoisted(() => ({ salesHistory: vi.fn() }));
salesHistory.mockResolvedValue({
  filter: { startDate: '2026-10-09', endDate: '2026-11-07', station: { id: 'station-1', name: 'Saleema Petroleum', code: 'SAL' } },
  stations: [{ id: 'station-1', name: 'Saleema Petroleum', code: 'SAL' }],
  summary: { quantity: 3000, revenue: 310000, transactions: 2 },
  daily: [
    { key: '2026-11-06:ms', date: '2026-11-06', productId: 'ms', product: 'Motor Spirit', code: 'MS', unit: 'LITRE', quantity: 900, revenue: 99000, transactions: 1 },
    { key: '2026-11-06:hsd', date: '2026-11-06', productId: 'hsd', product: 'High Speed Diesel', code: 'HSD', unit: 'LITRE', quantity: 1800, revenue: 180000, transactions: 1 },
    { key: '2026-11-07:ms', date: '2026-11-07', productId: 'ms', product: 'Motor Spirit', code: 'MS', unit: 'LITRE', quantity: 1000, revenue: 110000, transactions: 1 },
    { key: '2026-11-07:hsd', date: '2026-11-07', productId: 'hsd', product: 'High Speed Diesel', code: 'HSD', unit: 'LITRE', quantity: 2000, revenue: 200000, transactions: 1 },
  ],
});
vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { salesHistory } }));
vi.mock('../components/StationProvider', () => ({ useStation: () => ({ stations: [{ id: 'station-1', name: 'Saleema Petroleum' }], selectedStationId: 'station-1', selectStation: vi.fn() }) }));

describe('SalesHistoryPage', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-11-07T08:00:00.000Z')));
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('shows separate MS and HSD volume and value trends', async () => {
    render(<MemoryRouter><SalesHistoryPage/></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Fuel sales history' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Daily volume for MS and HSD' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daily sales value for MS and HSD' })).toBeInTheDocument();
    expect(screen.getAllByText('1,000 L').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2,000 L').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹3,10,000').length).toBeGreaterThan(0);
    const volumeChart=screen.getByRole('img',{name:'Daily volume for MS and HSD'});
    vi.spyOn(volumeChart, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 900, bottom: 250, width: 900, height: 250, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent(volumeChart,new MouseEvent('pointermove',{bubbles:true,clientX:785}));
    expect(screen.getByText('Friday, 6 November 2026')).toBeInTheDocument();
    expect(screen.getAllByText('900 L').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₹99,000').length).toBeGreaterThan(0);
    expect(screen.getByText('RSP ₹110/L · 1 sale')).toBeInTheDocument();
    fireEvent.keyDown(volumeChart,{key:'ArrowRight'});
    expect(screen.getByText('Saturday, 7 November 2026')).toBeInTheDocument();
    expect(screen.getByText('Litres sold × recorded RSP')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total sales' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days', pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.getByRole('button', { name: '7 days', pressed: true })).toBeInTheDocument();
  });
});
