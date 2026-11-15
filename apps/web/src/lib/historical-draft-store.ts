import type { HistoricalSalesRowInput } from '@fuelledger/shared';

const DATABASE = 'fuelnerve-historical-drafts-v1';
const VERSION = 1;
const STORE = 'drafts';

export type HistoricalOcrDraft = {
  id: string;
  scopeKey: string;
  stationId: string;
  productId: string;
  sourceFingerprint: string;
  sourceFileName: string;
  sourceMimeType: string;
  sourceLastModified: number;
  sourceBlob: Blob;
  month: string;
  rows: HistoricalSalesRowInput[];
  extractionWarnings: string[];
  layoutIssues: string[];
  uncertainCells: string[];
  periodNeedsConfirmation: boolean;
  periodConfirmed: boolean;
  periodSource: 'DOCUMENT' | 'SELECTED';
  readerStatus: string;
  applyCutover: boolean;
  updatedAt: string;
};

export const historicalDraftScope = (stationId: string, productId: string) => `${stationId}:${productId}`;
export const historicalDraftId = (stationId: string, productId: string, sourceFingerprint: string) => `${historicalDraftScope(stationId, productId)}:${sourceFingerprint}`;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Browser draft storage is unavailable.'));
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser draft storage could not be opened.'));
  });
}

function request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const operation = action(transaction.objectStore(STORE));
    let result: T;
    operation.onsuccess = () => { result = operation.result; };
    operation.onerror = () => reject(operation.error ?? new Error('Browser draft storage failed.'));
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser draft storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser draft storage was interrupted.'));
  }));
}

export const saveHistoricalDraft = (draft: HistoricalOcrDraft) => request<IDBValidKey>('readwrite', store => store.put(draft));
export const deleteHistoricalDraft = (id: string) => request<undefined>('readwrite', store => store.delete(id));
export const historicalDraftById = (id: string) => request<HistoricalOcrDraft | undefined>('readonly', store => store.get(id));

export async function latestHistoricalDraft(stationId: string, productId: string) {
  const scopeKey = historicalDraftScope(stationId, productId);
  const rows = await request<HistoricalOcrDraft[]>('readonly', store => store.getAll());
  return rows.filter(row => row.scopeKey === scopeKey).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function draftFile(draft: HistoricalOcrDraft) {
  return new File([draft.sourceBlob], draft.sourceFileName, { type: draft.sourceMimeType, lastModified: draft.sourceLastModified });
}
