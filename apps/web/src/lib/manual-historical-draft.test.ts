import { beforeEach, expect, it } from 'vitest';
import { saveManualHistoricalDraft, readManualHistoricalDraft, deleteManualHistoricalDraft, manualHistoricalDraftKey, type ManualHistoricalDraft } from './manual-historical-draft';
const draft: ManualHistoricalDraft = {stationId:'station-a',productId:'hsd',month:'2026-11',rows:[{date:'2026-11-01',tankReadings:[{tankId:'tank-a',openingStock:8123.456}],nozzleReadings:[{nozzleId:'nozzle-a',meterReading:15123.789}],receiptQuantity:0,testingQuantity:25,salesQuantity:0,sellingPrice:94}],uncertainCells:[],continuingRegister:false,editableSavedDates:[],correctionReason:'',baseRegister:null,updatedAt:'2026-11-21T01:00:00Z'};
beforeEach(() => localStorage.clear());
it('keeps full precision and isolates fuel station, product and month', () => {
  saveManualHistoricalDraft(draft);
  expect(readManualHistoricalDraft('station-a','hsd','2026-11')).toEqual(draft);
  expect(readManualHistoricalDraft('station-b','hsd','2026-11')).toBeNull();
  expect(readManualHistoricalDraft('station-a','ms','2026-11')).toBeNull();
  expect(readManualHistoricalDraft('station-a','hsd','2026-10')).toBeNull();
  saveManualHistoricalDraft({...draft,productId:'ms'});
  deleteManualHistoricalDraft('station-a','hsd','2026-11');
  expect(readManualHistoricalDraft('station-a','hsd','2026-11')).toBeNull();
  expect(readManualHistoricalDraft('station-a','ms','2026-11')).not.toBeNull();
});
it('ignores corrupt, mismatched and incomplete stored records safely', () => {
  const key = manualHistoricalDraftKey('station-a','hsd','2026-11');
  for (const value of ['broken JSON',JSON.stringify({...draft,stationId:'station-b'}),JSON.stringify({...draft,rows:[{date:'2026-11-01'}]}),JSON.stringify({...draft,rows:[{...draft.rows[0],tankReadings:[{tankId:'tank-a',openingStock:-1}]}]})]) {
    localStorage.setItem(key,value);
    expect(readManualHistoricalDraft('station-a','hsd','2026-11')).toBeNull();
  }
});
