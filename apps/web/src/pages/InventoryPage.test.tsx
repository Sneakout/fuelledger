import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryPage } from './InventoryPage';

const { inventoryBootstrap } = vi.hoisted(() => ({ inventoryBootstrap: vi.fn() }));

inventoryBootstrap.mockResolvedValue({
  stations: [{ id: 'station-1', name: 'Saleema Petroleum', code: 'SAL', configurations: [] }],
  products: [],
  tanks: [
    {
      station: { id: 'station-1', name: 'Saleema Petroleum', code: 'SAL' },
      tank: { id: 'tank-ms', code: 'MS-1', nominalCapacity: 20_000, workingCapacity: 19_000 },
      product: { id: 'ms', name: 'Motor Spirit', code: 'MS', unit: 'LITRE', category: 'FUEL', purchasePrice: 100 },
      opening: 0, receipts: 22_000, sales: 1_000, adjustments: -8_550, bookStock: 12_450,
      physicalStock: 12_432, bookStockAtReading: 12_450, variance: -18, dipReading: 12_432,
      readAt: '2026-11-12T07:00:00.000Z', density: 742, densityRecordedAt: '2026-11-12T07:00:00.000Z',
    },
    {
      station: { id: 'station-1', name: 'Saleema Petroleum', code: 'SAL' },
      tank: { id: 'tank-hsd', code: 'HSD-1', nominalCapacity: 20_000, workingCapacity: 19_000 },
      product: { id: 'hsd', name: 'High Speed Diesel', code: 'HSD', unit: 'LITRE', category: 'FUEL', purchasePrice: 90 },
      opening: 0, receipts: 18_000, sales: 5_000, adjustments: 0, bookStock: 13_000,
      physicalStock: 13_000, bookStockAtReading: 13_000, variance: 0, dipReading: 13_000,
      readAt: '2026-11-12T07:00:00.000Z', density: null, densityRecordedAt: null,
    },
  ],
  untanked: [{
    station: { id: 'station-1', name: 'Saleema Petroleum', code: 'SAL' }, tank: null,
    product: { id: 'oil', name: 'Engine Oil', code: 'OIL', unit: 'UNIT', category: 'LUBRICANT', purchasePrice: 500 },
    opening: 10, receipts: 5, sales: 2, adjustments: 0, bookStock: 13, physicalStock: null,
    bookStockAtReading: null, variance: null, dipReading: null, readAt: null, density: null, densityRecordedAt: null,
  }],
  ledger: [], receipts: [],
});

vi.mock('../lib/api', () => ({ ApiRequestError: class extends Error {}, api: { inventoryBootstrap } }));

describe('InventoryPage', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z')));
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('puts the stock answer and plain-language attention before the calculation', async () => {
    render(<InventoryPage/>);
    expect(await screen.findByRole('heading', { name: 'Know what is in every tank.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fuel quantity and stock value' })).toBeInTheDocument();
    expect(screen.getAllByText('₹12,45,000').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'MS Tank 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'HSD Tank 1' })).toBeInTheDocument();
    expect(screen.getByText('18 L less than the system expected at the last check.')).toBeInTheDocument();
    expect(screen.getByText('Engine Oil')).toBeInTheDocument();

    const attentionTabs = screen.getAllByRole('button', { name: /Needs attention/ });
    fireEvent.click(attentionTabs.at(-1)!);
    expect(screen.getByRole('heading', { name: 'Tanks to check' })).toBeInTheDocument();
    expect(screen.queryByText('Engine Oil')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'HSD Tank 1' })).not.toBeInTheDocument();
  });
});
