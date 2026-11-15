import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { deleteHistoricalDraft, draftFile, historicalDraftById, historicalDraftId, historicalDraftScope, latestHistoricalDraft, saveHistoricalDraft, type HistoricalOcrDraft } from './historical-draft-store';

const reset = () => new Promise<void>((resolve, reject) => {
  const operation = indexedDB.deleteDatabase('fuelnerve-historical-drafts-v1');
  operation.onsuccess = () => resolve();
  operation.onerror = () => reject(operation.error);
});

const makeDraft = (fingerprint: string, updatedAt: string): HistoricalOcrDraft => ({
  id: historicalDraftId('station-1', 'product-1', fingerprint), scopeKey: historicalDraftScope('station-1', 'product-1'), stationId: 'station-1', productId: 'product-1', sourceFingerprint: fingerprint,
  sourceFileName: 'DSR.pdf', sourceMimeType: 'application/pdf', sourceLastModified: 1, sourceBlob: new Blob(['source'], { type: 'application/pdf' }), month: '2026-10',
  rows: [], extractionWarnings: [], layoutIssues: [], uncertainCells: [], periodNeedsConfirmation: true, periodConfirmed: false, periodSource: 'DOCUMENT', readerStatus: 'Draft ready', applyCutover: false, updatedAt,
});

beforeEach(reset);

it('restores the latest autosaved OCR draft and its source file', async () => {
  await saveHistoricalDraft(makeDraft('older', '2026-11-15T10:00:00.000Z'));
  await saveHistoricalDraft(makeDraft('newer', '2026-11-15T11:00:00.000Z'));
  const restored = await latestHistoricalDraft('station-1', 'product-1');
  expect(restored?.sourceFingerprint).toBe('newer');
  const file = draftFile(restored!);
  expect(file.name).toBe('DSR.pdf');
  expect(file.type).toBe('application/pdf');
  expect(file.size).toBeGreaterThan(0);
});

it('deduplicates by station, product and source fingerprint and can clear a submitted draft', async () => {
  const draft = makeDraft('same-source', '2026-11-15T10:00:00.000Z');
  await saveHistoricalDraft(draft);
  await saveHistoricalDraft({ ...draft, month: '2026-11', updatedAt: '2026-11-15T11:00:00.000Z' });
  expect((await historicalDraftById(draft.id))?.month).toBe('2026-11');
  await deleteHistoricalDraft(draft.id);
  expect(await historicalDraftById(draft.id)).toBeUndefined();
});
