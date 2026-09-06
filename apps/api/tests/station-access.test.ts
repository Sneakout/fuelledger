import { describe,expect,it,vi } from 'vitest';
import type { User } from '@fuelledger/shared';

const db=vi.hoisted(()=>({shift:{count:vi.fn()},attachment:{count:vi.fn()}}));
vi.mock('../src/lib/prisma.js',()=>({prisma:db}));

describe('station access',async()=>{
  const {assertStationAccess,permittedStationIds,requireOwner,assertShiftAccess,assertAttachmentAccess}=await import('../src/lib/station-access.js');
  const manager:User={id:'user-1',name:'Manager',email:'manager@example.com',role:'MANAGER',organization:{id:'org-1',name:'Example Fuels'},allStations:false,stations:[{id:'station-1',name:'North Outlet',code:'NORTH'}]};
  const owner:User={...manager,role:'OWNER',allStations:true,stations:[]};

  it('limits a manager to explicitly assigned stations',()=>{
    expect(permittedStationIds(manager)).toEqual(['station-1']);
    expect(()=>assertStationAccess(manager,'station-1')).not.toThrow();
    expect(()=>assertStationAccess(manager,'station-2')).toThrowError(/do not have access/i);
  });
  it('keeps owner shift access inside their organization',async()=>{
    db.shift.count.mockResolvedValue(0);
    await expect(assertShiftAccess(owner,'foreign-shift')).rejects.toThrow(/do not have access/i);
    expect(db.shift.count).toHaveBeenCalledWith({where:{id:'foreign-shift',station:{organizationId:'org-1'}}});
  });
  it('checks both organization and assigned station for manager attachments',async()=>{
    db.attachment.count.mockResolvedValue(0);
    await expect(assertAttachmentAccess(manager,'foreign-attachment')).rejects.toThrow(/do not have access/i);
    expect(db.attachment.count).toHaveBeenCalledWith({where:{id:'foreign-attachment',OR:[{purchaseInvoice:{organizationId:'org-1',stationId:{in:['station-1']}}},{expense:{organizationId:'org-1',stationId:{in:['station-1']}}}]}});
  });

  it('gives owners organization-wide access and reserves access management for them',()=>{
    expect(permittedStationIds(owner)).toBeUndefined();
    expect(()=>assertStationAccess(owner,'any-station')).not.toThrow();
    expect(()=>requireOwner(manager)).toThrowError(/only an owner/i);
    expect(()=>requireOwner(owner)).not.toThrow();
  });
});
