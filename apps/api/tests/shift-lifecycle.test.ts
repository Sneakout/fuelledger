import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../src/modules/accounting/service.js', () => ({ postJournal: vi.fn(), collectionAccount: () => '1030' }));
import { closeShift, openShift } from '../src/modules/shifts/service.js';
const d = (n: number) => new Prisma.Decimal(n);

describe('closing shift', () => {
  it('opens with prior meters, stock including an intervening delivery, and chosen attendant', async () => {
    const tx: any = {
      station: { findFirst: vi.fn().mockResolvedValue({id:'station', configurations:[{id:'cfg',tanks:[{id:'t',code:'T1',openingStock:d(1000)}],dispensers:[{nozzles:[{id:'n',code:'N1',openingMeter:d(1000)}]}]}]}) },
      shift: { findFirst: vi.fn().mockResolvedValueOnce({shiftNumber:1,closedAt:new Date('2026-01-01'),tankReadings:[{tankId:'t',closingDip:d(900)}],nozzleReadings:[{nozzleId:'n',closingMeter:d(1100)}]}).mockResolvedValueOnce(null), aggregate:vi.fn().mockResolvedValue({_max:{shiftNumber:1}}),create:vi.fn(async ({data})=>({...data,nozzleReadings:[],tankReadings:[]})) },
      inventoryLedger:{groupBy:vi.fn().mockResolvedValueOnce([{tankId:'t',_sum:{quantityDelta:d(100)}}]).mockResolvedValueOnce([{tankId:'t',_sum:{quantityDelta:d(200)}}])},
      user:{findMany:vi.fn().mockResolvedValue([{id:'u'}])},
    };
    db.$transaction.mockImplementation(async fn=>fn(tx));
    await openShift('org',{stationId:'station',managerId:'u',userIds:['u'],nozzleAssignments:[{nozzleId:'n',userId:'u'}],openingCash:50,tankReadings:[{id:'t',value:1100}],nozzleReadings:[{id:'n',value:1100}]});
    const saved = tx.shift.create.mock.calls[0][0].data;
    expect(saved.tankReadings.create[0].openingDip.toNumber()).toBe(1100);
    expect(saved.nozzleReadings.create[0].openingMeter.toNumber()).toBe(1100);
    expect(saved.nozzleAssignments.create).toEqual([{nozzleId:'n',userId:'u'}]);
  });
  it('creates only missing metered sales and rejects a repeated close', async () => {
    const shift = { id: 's', stationId: 'station', status: 'OPEN', configurationId: 'config', openedAt: new Date(), notes: null,
      tankReadings: [{ tankId: 't', tank: { productId: 'fuel' }, closingDip: null }],
      nozzleReadings: [{ nozzleId: 'n', openingMeter: d(1000), closingMeter: null, nozzle: { code: 'N1', dispenser: { code: 'D1' } } }],
      nozzleAssignments: [{ nozzleId: 'n', userId: 'u', user: { name: 'Staff' } }] };
    const tx: any = {
      shift: { findFirst: vi.fn(async () => shift), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async ({data}) => Object.assign(shift, data)) },
      sale: { groupBy: vi.fn().mockResolvedValue([{ nozzleId: 'n', _sum: { quantity: d(20) } }]), create: vi.fn(async ({data}) => ({id:'sale', ...data})) },
      nozzle: { findUnique: vi.fn().mockResolvedValue({id:'n',productId:'fuel',product:{name:'Fuel', code:'MS', inventoryTracked:true,sellingPrice:d(100),purchasePrice:d(90),sellingPriceHistory:[],purchasePriceHistory:[]},tankMappings:[{tankId:'t',tank:{productId:'fuel'}}]}) },
      tank: { findFirst: vi.fn().mockResolvedValue({openingStock:d(1000)}) },
      inventoryLedger: { aggregate: vi.fn().mockResolvedValue({_sum:{quantityDelta:d(-20)}}), create:vi.fn() },
      shiftTankReading:{update:vi.fn()},shiftNozzleReading:{update:vi.fn()},shiftNozzleAssignment:{update:vi.fn()},
    };
    db.$transaction.mockImplementation(async fn => fn(tx));
    const input = { closingCash: 8000, tankReadings:[{id:'t',value:900}], nozzleReadings:[{id:'n',value:1100}], nozzleCollections:[{nozzleId:'n',amount:8000}] };
    await closeShift('org','s',input);
    expect(tx.sale.create).toHaveBeenCalledTimes(1);
    expect(tx.sale.create.mock.calls[0][0].data.quantity.toNumber()).toBe(80);
    expect(tx.sale.create.mock.calls[0][0].data.totalAmount.toNumber()).toBe(8000);
    await expect(closeShift('org','s',input)).rejects.toMatchObject({code:'SHIFT_NOT_OPEN'});
    expect(tx.sale.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'});
  });
});
