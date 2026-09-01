import { describe,expect,it,vi } from 'vitest';
import type { User } from '@fuelledger/shared';

vi.mock('../src/lib/prisma.js',()=>({prisma:{}}));

describe('station access',async()=>{
  const {assertStationAccess,permittedStationIds,requireOwner}=await import('../src/lib/station-access.js');
  const manager:User={id:'user-1',name:'Manager',email:'manager@example.com',role:'MANAGER',organization:{id:'org-1',name:'Example Fuels'},allStations:false,stations:[{id:'station-1',name:'North Outlet',code:'NORTH'}]};
  const owner:User={...manager,role:'OWNER',allStations:true,stations:[]};

  it('limits a manager to explicitly assigned stations',()=>{
    expect(permittedStationIds(manager)).toEqual(['station-1']);
    expect(()=>assertStationAccess(manager,'station-1')).not.toThrow();
    expect(()=>assertStationAccess(manager,'station-2')).toThrowError(/do not have access/i);
  });

  it('gives owners organization-wide access and reserves access management for them',()=>{
    expect(permittedStationIds(owner)).toBeUndefined();
    expect(()=>assertStationAccess(owner,'any-station')).not.toThrow();
    expect(()=>requireOwner(manager)).toThrowError(/only an owner/i);
    expect(()=>requireOwner(owner)).not.toThrow();
  });
});
