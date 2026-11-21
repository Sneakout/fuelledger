import { describe, expect, it, vi } from 'vitest';
import { dsrObservationCandidates, latestObservations, readLatestTankObservations, type ObservationCandidate } from '../src/lib/tank-observations.js';

const now = new Date('2026-11-21T08:00:00Z');
const tanks = [{id:'ms',stationId:'one',productId:'MS'},{id:'hsd',stationId:'two',productId:'HSD'}];
const register = (date:string, volume:number, updatedAt = now) => ({id:'register',stationId:'one',productId:'MS',updatedAt,rows:[{date,tankReadings:[{tankId:'ms',openingStock:volume,dipReading:83}]}]});
const dsr = (date:string,volume:number,updatedAt=now) => dsrObservationCandidates(tanks,[register(date,volume,updatedAt)],now);
const exact = (date:string,volume:number):ObservationCandidate => ({...tanks[0]!,volume,dipCm:null,date:date.slice(0,10),observedAt:date,precision:'EXACT',source:'SHIFT_CLOSING',sourceId:'shift',sourceLabel:'Shift closing',sourcePath:'/operations',savedAt:null});

describe('latest confirmed tank measurements', () => {
  it('ranks measurement date rather than correction or upload time', () => {
    const observations = latestObservations(tanks,[...dsr('2026-11-13',2809),...dsr('2026-11-20',9000,new Date('2026-11-20T08:00:00Z'))],now);
    expect(observations.get('ms')).toMatchObject({volume:9000,date:'2026-11-20',precision:'MORNING',observedAt:null});
  });
  it('shows corrected DSR volumes immediately without altering the ledger', () => {
    expect(latestObservations(tanks,dsr('2026-11-20',9500),now).get('ms')?.volume).toBe(9500);
    expect(register('2026-11-20',9500).rows[0]?.tankReadings[0]?.openingStock).toBe(9500);
  });
  it('chooses a later operational measurement; prefers exact evidence for same-day ordering', () => {
    expect(latestObservations(tanks,[...dsr('2026-11-20',9000),exact('2026-11-21T06:00:00Z',8500)],now).get('ms')?.volume).toBe(8500);
    expect(latestObservations(tanks,[exact('2026-11-20T06:00:00Z',8500),...dsr('2026-11-20',9000)],now).get('ms')).toMatchObject({source:'SHIFT_CLOSING',timingNote:expect.stringContaining('exact order cannot be verified')});
  });
  it('rejects future readings and incompatible tank/product/station associations', () => {
    const valid = dsr('2026-11-20',9000)[0]!;
    const bad = [{...valid,stationId:'two'},{...valid,productId:'HSD'},exact('2026-11-22T06:00:00Z',123),exact('2026-11-21T10:00:00Z',123)];
    expect(latestObservations(tanks,bad,now).size).toBe(0);
    expect(dsrObservationCandidates(tanks,[{...register('2026-11-20',123),productId:'HSD'}],now)).toEqual([]);
  });
  it('uses the reviewed chart result at full precision and does not cap at nominal capacity', () => {
    const record = register('2026-11-20',20000);
    Object.assign(record.rows[0]!.tankReadings[0]!,{calibration:{volumeLitres:21628.93,reviewConfirmed:true}});
    expect(dsrObservationCandidates(tanks,[record],now)[0]?.volume).toBe(21628.93);
    Object.assign(record.rows[0]!.tankReadings[0]!,{calibration:{volumeLitres:21628.93,reviewConfirmed:false}});
    expect(dsrObservationCandidates(tanks,[record],now)).toEqual([]);
  });
  it.each([null,undefined,'',NaN,-1,Infinity])('does not turn invalid volume %s into measured stock', volume => {
    const record = register('2026-11-20',0);
    Object.assign(record.rows[0]!.tankReadings[0]!,{openingStock:volume});
    expect(dsrObservationCandidates(tanks,[record],now)).toEqual([]);
  });
  it('queries only the organization and selected tanks without writing any records', async () => {
    const db = {historicalSalesImport:{findMany:vi.fn().mockResolvedValue([register('2026-11-20',9500)])},tankReading:{findMany:vi.fn().mockResolvedValue([])},shiftTankReading:{findMany:vi.fn().mockResolvedValue([])}};
    const result = await readLatestTankObservations(db as never,'org',[tanks[0]!],now);
    expect(result.get('ms')?.volume).toBe(9500);
    expect(result.has('hsd')).toBe(false);
    expect(db.historicalSalesImport.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:'org',stationId:{in:['one']},productId:{in:['MS']}})}));
    expect(db.tankReading.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({organizationId:'org',tankId:{in:['ms']},recordedAt:{lte:now}})}));
    expect(db.shiftTankReading.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tankId:{in:['ms']},shift:expect.objectContaining({station:{organizationId:'org'}})})}));
  });
});
