import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportsPage } from './ReportsPage';

vi.mock('../components/StationProvider',()=>({useStation:()=>({selectedStationId:'',selectStation:vi.fn()})}));

vi.mock('../lib/api', () => ({
  ApiRequestError: class extends Error {},
  api: { reportsBootstrap: vi.fn().mockResolvedValue({
    filter:{startDate:'2026-09-01',endDate:'2026-09-01',station:null},stations:[{id:'station-1',name:'Station C',code:'ST-C'}],
    summary:{grossSales:1020,transactions:1,meteredVolume:10,purchases:0,expenses:100,receivables:500,payables:300,inventoryValue:1200,grossProfit:300,netProfit:200},
    sales:{byProduct:[{key:'ms',product:'Motor Spirit',code:'MS',unit:'LITRE',quantity:10,revenue:1020}],byPayment:[{key:'CASH',method:'CASH',transactions:1,amount:1020}],daily:[{key:'2026-09-01',date:'2026-09-01',transactions:1,amount:1020}],byStation:[]},
    inventory:[],customers:[],payables:[],expenses:[{key:'UTIL',category:'Utilities',amount:100}],
    financial:{accounts:[],revenue:500,cogs:200,operatingExpenses:100,grossProfit:300,netProfit:200},
  }) },
}));

describe('ReportsPage',()=>{it('shows operational and financial reporting together',async()=>{render(<ReportsPage/>);expect(await screen.findByRole('heading',{name:'Clear answers from trusted station data'})).toBeInTheDocument();expect((await screen.findAllByText('₹1,020')).length).toBeGreaterThan(0);expect(screen.getByRole('heading',{name:'Posted profit & loss'})).toBeInTheDocument();});});
