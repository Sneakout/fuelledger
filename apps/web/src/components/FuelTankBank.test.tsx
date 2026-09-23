import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FuelTankBank } from './FuelTankBank';

vi.mock('../lib/api', () => ({ api: { recordDensity: vi.fn() }, ApiRequestError: class extends Error {} }));

describe('FuelTankBank', () => {
  it('shows the book balance and the last shift estimate separately when they disagree', () => {
    render(<MemoryRouter><FuelTankBank asOf="2026-09-22T12:00:00.000Z" tanks={[{
      id: 'hsd-1', code: 'HSD-1', product: 'High Speed Diesel', productCode: 'HSD', unit: 'LITRE',
      station: { id: 'station', name: 'Saleema Petroleum', code: 'SALEEMA' },
      bookStock: 25900, expectedFromLastDip: 23000, bookDifferenceFromLastDip: 2900,
      lastClosingDipAt: '2026-09-09T17:12:40.500Z', workingCapacity: 19000,
      fillPercent: 136.3158, sellingPrice: 94, density: null, densityRecordedAt: null,
      physicalStock: null, physicalReadingAt: null, status: 'OVER_CAPACITY',
    }]} /></MemoryRouter>);
    expect(screen.getByText('25,900 L')).toBeInTheDocument();
    expect(screen.getByText('23,000 L')).toBeInTheDocument();
    expect(screen.getByText(/Books are 2,900 L higher/)).toBeInTheDocument();
    expect(screen.getByText(/Shift estimate exceeds safe capacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/121.1 percent estimated stock/)).toBeInTheDocument();
  });
});
