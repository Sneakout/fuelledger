import type { Prisma } from '@prisma/client';
import type { HistoricalSalesRowInput } from '@fuelledger/shared';
import { indiaDate, indiaDayRange } from './india-time.js';

export type ObservationTank = { id: string; stationId: string; productId: string };
export type TankObservation = {
  volume: number; dipCm: number | null; date: string; observedAt: string | null;
  precision: 'MORNING' | 'EXACT'; source: 'DSR' | 'TANK_CHECK' | 'SHIFT_OPENING' | 'SHIFT_CLOSING';
  sourceId: string; sourceLabel: string; sourcePath: string; savedAt: string | null; timingNote?: string;
};
export type ObservationCandidate = TankObservation & ObservationTank;
/** Measurements are ranked by their business date, never their upload/edit time.
 * A DSR has only a morning date: do not manufacture an exact measurement time.
 * For a same-day tie, prefer a timestamped operational observation; retain the
 * precision in the result so the UI can explain what is actually known. */
export function latestObservations(tanks: ObservationTank[], candidates: ObservationCandidate[], asOf: Date) {
  const scope = new Map(tanks.map(tank => [tank.id, tank]));
  const result = new Map<string, TankObservation>();
  for (const candidate of candidates) {
    const tank = scope.get(candidate.id);
    if (!tank || tank.stationId !== candidate.stationId || tank.productId !== candidate.productId || !Number.isFinite(candidate.volume) || candidate.volume < 0 || candidate.date > indiaDate(asOf) || (candidate.observedAt && new Date(candidate.observedAt) > asOf)) continue;
    const previous = result.get(tank.id);
    const rank = (reading: TankObservation) => `${reading.date}:${reading.observedAt ? '1' : '0'}:${reading.observedAt ?? ''}:${reading.source === 'SHIFT_CLOSING' ? '3' : reading.source === 'TANK_CHECK' ? '2' : '1'}`;
    if (!previous || rank(candidate) > rank(previous) || (rank(candidate) === rank(previous) && (candidate.savedAt ?? '') > (previous.savedAt ?? ''))) {
      const { id: _id, stationId: _stationId, productId: _productId, ...observation } = candidate;
      result.set(tank.id, observation);
    }
  }
  for (const [id, observation] of result) {
    const tank = scope.get(id)!;
    if (observation.precision === 'EXACT' && candidates.some(candidate => candidate.id === id && candidate.stationId === tank.stationId && candidate.productId === tank.productId && candidate.date === observation.date && candidate.precision === 'MORNING')) {
      observation.timingNote = 'A DSR morning reading also exists for this date. The timestamped reading is shown; their exact order cannot be verified without the DSR time.';
    }
  }
  return result;
}
export function dsrObservationCandidates(tanks: ObservationTank[], records: Array<{id:string;stationId:string;productId:string;updatedAt:Date;rows:unknown}>, asOf: Date): ObservationCandidate[] {
  return records.flatMap(record => {
    const matches = new Map(tanks.filter(tank => tank.stationId === record.stationId && tank.productId === record.productId).map(tank => [tank.id,tank]));
    if (!Array.isArray(record.rows)) return [];
    return (record.rows as HistoricalSalesRowInput[]).flatMap(row => {
      if (!row || typeof row !== 'object') return [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') || row.date > indiaDate(asOf) || !Array.isArray(row.tankReadings)) return [];
      try { indiaDayRange(row.date); } catch { return []; }
      return row.tankReadings.flatMap(reading => {
        if (!reading || typeof reading !== 'object') return [];
        const tank = matches.get(reading.tankId);
        if (!tank || (reading.calibration && !reading.calibration.reviewConfirmed)) return [];
        const sourceVolume = reading.calibration?.volumeLitres ?? reading.openingStock;
        if (typeof sourceVolume !== 'number') return [];
        const volume = sourceVolume;
        if (!Number.isFinite(volume) || volume < 0) return [];
        return [{...tank, volume, dipCm:reading.dipReading ?? null, date:row.date, observedAt:null, precision:'MORNING' as const, source:'DSR' as const, sourceId:record.id, sourceLabel:'Confirmed DSR · morning',sourcePath:`/sales/history/import?${new URLSearchParams({stationId:record.stationId,productId:record.productId,month:row.date.slice(0,7)})}`, savedAt:record.updatedAt.toISOString()}];
      });
    });
  });
}
export async function readLatestTankObservations(db: Pick<Prisma.TransactionClient,'historicalSalesImport'|'tankReading'|'shiftTankReading'>, organizationId: string, tanks: ObservationTank[], asOf = new Date()) {
  if (!tanks.length) return new Map<string,TankObservation>();
  const stationIds = [...new Set(tanks.map(tank => tank.stationId))], tankIds = tanks.map(tank => tank.id);
  const [registers, checks, shifts] = await Promise.all([
    db.historicalSalesImport.findMany({where:{organizationId,stationId:{in:stationIds},productId:{in:[...new Set(tanks.map(tank => tank.productId))]},monthStart:{lte:asOf}},select:{id:true,stationId:true,productId:true,updatedAt:true,rows:true}}),
    db.tankReading.findMany({where:{organizationId,stationId:{in:stationIds},tankId:{in:tankIds},recordedAt:{lte:asOf}},orderBy:{recordedAt:'desc'},distinct:['tankId'],select:{id:true,tankId:true,stationId:true,physicalStock:true,dipReading:true,recordedAt:true}}),
    db.shiftTankReading.findMany({where:{tankId:{in:tankIds},shift:{status:{not:'CANCELLED'},station:{organizationId},stationId:{in:stationIds},openedAt:{lte:asOf}}},orderBy:{shift:{openedAt:'desc'}},distinct:['tankId'],select:{tankId:true,openingDip:true,closingDip:true,shift:{select:{id:true,stationId:true,shiftNumber:true,openingSource:true,openedAt:true,closedAt:true}}}}),
  ]);
  const byTank = new Map(tanks.map(tank => [tank.id,tank]));
  const candidates = dsrObservationCandidates(tanks, registers, asOf);
  for (const check of checks) {
    const tank = byTank.get(check.tankId); if (!tank) continue;
    candidates.push({...tank,stationId:check.stationId,volume:Number(check.physicalStock),dipCm:check.dipReading === null ? null : Number(check.dipReading), date:indiaDate(check.recordedAt),observedAt:check.recordedAt.toISOString(),precision:'EXACT',source:'TANK_CHECK',sourceId:check.id,sourceLabel:'Tank check',sourcePath:`/inventory?tankId=${tank.id}`,savedAt:null});
  }
  for (const reading of shifts) {
    const tank = byTank.get(reading.tankId); if (!tank) continue;
    const shift = reading.shift;
    for (const [source,volume,at] of [['SHIFT_OPENING',reading.openingDip,shift.openedAt],['SHIFT_CLOSING',reading.closingDip,shift.closedAt]] as const) {
      if (volume === null || !at || at > asOf) continue;
      // Reusing a DSR morning dip is not a new timestamped physical measurement.
      const snapshot = shift.openingSource as { tanks?: Array<{ id: string }> } | null;
      if (source === 'SHIFT_OPENING' && snapshot?.tanks?.some(row => row.id === tank.id)) continue;
      candidates.push({...tank,stationId:shift.stationId,volume:Number(volume),dipCm:null,date:indiaDate(at),observedAt:at.toISOString(),precision:'EXACT',source,sourceId:shift.id,sourceLabel:`Shift #${shift.shiftNumber} ${source === 'SHIFT_CLOSING' ? 'closing' : 'opening'}`,sourcePath:`/operations?shiftId=${shift.id}`,savedAt:null});
    }
  }
  return latestObservations(tanks,candidates,asOf);
}
