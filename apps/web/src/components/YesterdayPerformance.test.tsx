import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { YesterdayPerformance } from './YesterdayPerformance';
import type { YesterdayPerformance as Performance } from '../lib/api';
afterEach(cleanup);
const performance:Performance={date:'2026-11-25',status:'RECORDED',start:'2026-11-25T00:30:00Z',end:'2026-11-26T00:30:00Z',closedShifts:2,pendingClosings:0,pendingReconciliations:0,missingMorning:false,sales:12500,meteredVolume:125,collected:12500,verifiedCollected:12500,netProfit:1250,expenses:0,historicalProducts:0,collectionsReason:'Verified cash, UPI, card & other',profitReason:'After recorded product cost and expenses',issues:[],periods:[{stationId:'s',name:'Mughal Petroleum',start:'2026-11-25T00:30:00Z',end:'2026-11-26T00:30:00Z'}]};
it('shows yesterday with the actual overnight window and a separate current-shift link',()=>{
 render(<MemoryRouter><YesterdayPerformance performance={performance} openShifts={1}/></MemoryRouter>);
 expect(screen.getByRole('heading',{name:'Yesterday’s performance'})).toBeInTheDocument();
 expect(screen.getByText('2 shifts closed')).toBeInTheDocument(); expect(screen.getByText('125 L')).toBeInTheDocument();
 expect(screen.getByText(/25 Nov 2026.*26 Nov 2026/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Right now 1 shift running/})).toHaveAttribute('href','/operations');
 expect(screen.queryByText('Sales today')).not.toBeInTheDocument();
});
it('makes pending collections explicit while retaining recorded sales',()=>{
 render(<MemoryRouter><YesterdayPerformance performance={{...performance,collected:null,pendingReconciliations:1,collectionsReason:'Awaiting reconciliation',verifiedCollected:0}} openShifts={1}/></MemoryRouter>);
 expect(screen.getByText('Awaiting reconciliation')).toBeInTheDocument();
 expect(screen.getByRole('link',{name:/1 awaiting reconciliation/})).toHaveAttribute('href','/reconciliation');
 expect(screen.getAllByText('₹12,500')).toHaveLength(1);
});
it('uses dashes for absent records and missing costs instead of misleading zeroes',()=>{
 render(<MemoryRouter><YesterdayPerformance performance={{...performance,status:'NO_DATA',sales:null,collected:null,netProfit:null,meteredVolume:null,periods:[],closedShifts:0}} openShifts={0}/></MemoryRouter>);
 expect(screen.getByText('Not recorded yet')).toBeInTheDocument(); expect(screen.getAllByText('—')).toHaveLength(4);
 expect(screen.getByText('Awaiting yesterday’s records')).toBeInTheDocument();
});
