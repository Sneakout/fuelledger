import { type HistoricalSalesRowInput, historicalSalesRowSchema } from '@fuelledger/shared';
import type { HistoricalSalesImportDetail } from './api';

const PREFIX = 'fuelnerve:manual-dsr:v1:';
export type ManualHistoricalDraft = {
  stationId: string; productId: string; month: string;
  rows: HistoricalSalesRowInput[];
  uncertainCells: string[]; continuingRegister: boolean; editableSavedDates: string[];
  correctionReason: string; baseRegister: HistoricalSalesImportDetail | null; updatedAt: string;
};
export const manualHistoricalDraftKey = (stationId: string, productId: string, month: string) => `${PREFIX}${stationId}:${productId}:${month}`;
export function saveManualHistoricalDraft(draft: ManualHistoricalDraft) {
  // Synchronous small JSON snapshots survive immediate refresh/navigation, without
  // waiting for an OCR file or a debounce timer. No server request is made.
  localStorage.setItem(manualHistoricalDraftKey(draft.stationId, draft.productId, draft.month), JSON.stringify(draft));
}
const rowFacts = historicalSalesRowSchema.omit({tankReadings:true,nozzleReadings:true});
const tankFacts = historicalSalesRowSchema.shape.tankReadings.element.omit({tankId:true});
const nozzleFacts = historicalSalesRowSchema.shape.nozzleReadings.element.omit({nozzleId:true});
function validRows(rows: ManualHistoricalDraft['rows']): boolean {
  return Array.isArray(rows) && rows.length > 0 && rows.length <= 31 && rows.every(row =>
    rowFacts.safeParse(row).success && Array.isArray(row.tankReadings) && row.tankReadings.length > 0 &&
    row.tankReadings.every(reading => typeof reading?.tankId === 'string' && tankFacts.safeParse(reading).success) &&
    Array.isArray(row.nozzleReadings) && row.nozzleReadings.length > 0 &&
    row.nozzleReadings.every(reading => typeof reading?.nozzleId === 'string' && nozzleFacts.safeParse(reading).success));
}
export function readManualHistoricalDraft(stationId: string, productId: string, month: string): ManualHistoricalDraft | null {
  const value = localStorage.getItem(manualHistoricalDraftKey(stationId, productId, month));
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as ManualHistoricalDraft;
    if (draft.stationId !== stationId || draft.productId !== productId || draft.month !== month ||
      !Array.isArray(draft.uncertainCells) || draft.uncertainCells.some(cell => typeof cell !== 'string') ||
      !Array.isArray(draft.editableSavedDates) || draft.editableSavedDates.some(date => typeof date !== 'string') ||
      typeof draft.correctionReason !== 'string' || typeof draft.continuingRegister !== 'boolean' ||
      !validRows(draft.rows) || draft.rows.some(row => !row.date.startsWith(`${month}-`)) ||
      (draft.continuingRegister && !draft.baseRegister) ||
      (draft.baseRegister && (draft.baseRegister.stationId !== stationId || draft.baseRegister.productId !== productId ||
        draft.baseRegister.month !== month || typeof draft.baseRegister.id !== 'string' ||
        !Number.isFinite(Date.parse(draft.baseRegister.updatedAt)) || !validRows(draft.baseRegister.rows)))) return null;
    return draft;
  } catch { return null; }
}
export function deleteManualHistoricalDraft(stationId: string, productId: string, month: string) {
  localStorage.removeItem(manualHistoricalDraftKey(stationId, productId, month));
}
