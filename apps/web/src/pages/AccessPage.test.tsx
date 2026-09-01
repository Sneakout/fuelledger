import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { AccessPage } from './AccessPage';

const owner={role:'OWNER'};
vi.mock('../components/AuthProvider',()=>({useAuth:()=>({user:owner})}));
vi.mock('../components/StationProvider',()=>({useStation:()=>({stations:[]})}));
vi.mock('../lib/api',()=>({ApiRequestError:class extends Error{},api:{accessBootstrap:vi.fn().mockResolvedValue({stations:[{id:'station-1',name:'Station C',code:'ST-C',city:'Kochi',state:'Kerala',active:true}],users:[{id:'owner-1',name:'Demo Owner',email:'owner@example.com',role:'OWNER',allStations:true,stationIds:[]},{id:'manager-1',name:'Demo Manager',email:'manager@example.com',role:'MANAGER',allStations:false,stationIds:['station-1']}]}),updateStationAccess:vi.fn()}}));

describe('AccessPage',()=>{it('shows outlet directory and role-based assignments',async()=>{render(<AccessPage/>);expect(await screen.findByRole('heading',{name:'Put the right people at the right outlets'})).toBeInTheDocument();expect(screen.getAllByText('Station C')).toHaveLength(2);expect(screen.getByText('Demo Manager')).toBeInTheDocument();expect(screen.getByText('All stations')).toBeInTheDocument();});});
