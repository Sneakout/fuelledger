import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FuelTankBank } from './FuelTankBank';

vi.mock('../lib/api', () => ({ api: { recordDensity: vi.fn() }, ApiRequestError: class extends Error {} }));

describe('FuelTankBank', () => {
  it('uses authoritative book stock without showing closing-dip details', () => {
    render(<MemoryRouter><FuelTankBank asOf="2026-09-22T12:00:00.000Z" tanks={[{
      id: 'hsd-1', code: 'HSD-1', product: 'High Speed Diesel', productCode: 'HSD', unit: 'LITRE',
      station: { id: 'station', name: 'Saleema Petroleum', code: 'SALEEMA' },
      bookStock: 25900, expectedFromLastDip: 23000, bookDifferenceFromLastDip: 2900,
      lastClosingDipAt: '2026-09-09T17:12:40.500Z', workingCapacity: 19000,
      fillPercent: 136.3158, sellingPrice: 94, density: null, densityRecordedAt: null,
      physicalStock: null, physicalReadingAt: null, status: 'OVER_CAPACITY',
    }]} /></MemoryRouter>);
    expect(screen.getByText('25,900 L')).toBeInTheDocument();
    expect(screen.queryByText(/closing-dip/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/below book stock/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Book stock exceeds safe capacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/136.3 percent book stock/)).toBeInTheDocument();
  });

  it('shows current book stock for a healthy tank', () => {
    render(<MemoryRouter><FuelTankBank asOf="2026-09-24T12:00:00.000Z" tanks={[{
      id: 'ms-1', code: 'MS-1', product: 'Motor Spirit', productCode: 'MS', unit: 'LITRE',
      station: { id: 'station', name: 'Saleema Petroleum', code: 'SALEEMA' },
      bookStock: 13000, expectedFromLastDip: 13000, bookDifferenceFromLastDip: 0,
      lastClosingDipAt: '2026-09-23T17:00:00.000Z', workingCapacity: 19000,
      fillPercent: 68.4, sellingPrice: 115.6, density: null, densityRecordedAt: null,
      physicalStock: null, physicalReadingAt: null, status: 'HEALTHY',
    }]} /></MemoryRouter>);
    expect(screen.getByText('13,000 L')).toBeInTheDocument();
    expect(screen.queryByText(/closing-dip/i)).not.toBeInTheDocument();
  });
});
