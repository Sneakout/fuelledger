import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FuelTankBank } from './FuelTankBank';

vi.mock('../lib/api', () => ({ api: { recordDensity: vi.fn() }, ApiRequestError: class extends Error {} }));

afterEach(cleanup);

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
    expect(screen.getByText(/Displayed stock exceeds safe capacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/136.3 percent calculated stock/)).toBeInTheDocument();
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

it('keeps the dashboard compact and links to the tank details', () => {
  render(<MemoryRouter><FuelTankBank asOf="2026-11-21T08:00:00Z" tanks={[{
    id:'ms',code:'T-1',product:'Motor Spirit',productCode:'MS',unit:'LITRE',station:{id:'one',name:'One',code:'ONE'},
    bookStock:2809,workingCapacity:20000,fillPercent:14,sellingPrice:114,density:null,densityRecordedAt:null,physicalStock:null,physicalReadingAt:null,status:'LOW',
    latestObservation:{volume:10000,dipCm:99,date:'2026-11-20',observedAt:null,precision:'MORNING',source:'DSR',sourceId:'r',sourceLabel:'Confirmed DSR · morning',sourcePath:'/sales/history/import?month=2026-11',savedAt:'2026-11-21T08:00:00Z'},
  }]} /></MemoryRouter>);
  expect(screen.getByLabelText(/14 percent calculated stock/)).toBeInTheDocument();
  expect(screen.queryByText(/Last measured/)).not.toBeInTheDocument();
  expect(screen.getAllByText('2,809 L')[0]).toBeInTheDocument();
  expect(screen.queryByText(/20 Nov 2026 · morning/)).not.toBeInTheDocument();
  expect(screen.queryByText(/not a live dip/)).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:/View stock details/})).toHaveAttribute('href','/inventory?tankId=ms');
});

it('displays latest checkpoint availability rather than the drifted cumulative balance', () => {
  render(<MemoryRouter><FuelTankBank asOf="2026-11-21T09:00:00Z" tanks={[{
    id:'hsd',code:'T-2',product:'Diesel',productCode:'HSD',unit:'LITRE',station:{id:'one',name:'One',code:'ONE'},
    bookStock:17147.57,workingCapacity:20000,fillPercent:85.7,sellingPrice:103,density:null,densityRecordedAt:null,physicalStock:null,physicalReadingAt:null,status:'HEALTHY',
    operationalStock:{quantity:8398.67,opening:4398.67,receipts:4000,sales:0,adjustments:0,checkpointDate:'2026-11-20',checkpointAt:null,source:'Confirmed DSR',asOf:'2026-11-21T09:00:00Z',incomplete:true,issues:['Next morning readings missing']},
  }]} /></MemoryRouter>);
  expect(screen.getByText('8,398.7 L')).toBeInTheDocument();
  expect(screen.getByText('Available before unrecorded sales')).toBeInTheDocument();
  expect(screen.queryByText('17,147.6 L')).not.toBeInTheDocument();
  expect(screen.getByLabelText(/42 percent calculated stock/)).toBeInTheDocument();
});
