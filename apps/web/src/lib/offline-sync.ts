export type OfflineRequest = {
  id: string;
  scope: string;
  method: "POST" | "PUT" | "PATCH";
  path: string;
  body: string;
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  status: "pending" | "attention";
  lastError?: string;
};

export type OfflineSyncSnapshot = {
  online: boolean;
  syncing: boolean;
  pending: number;
  attention: number;
  lastError: string | undefined;
};

type ReplayResult = { ok: true } | { ok: false; retryable: boolean; message: string };
type Replay = (item: OfflineRequest) => Promise<ReplayResult>;

const DB_NAME = "fuelnerve-offline-v1";
const DB_VERSION = 1;
const REQUESTS = "requests";
const RESPONSES = "responses";
const listeners = new Set<() => void>();
let scope: string | null = null;
let replay: Replay | null = null;
let syncing = false;
let started = false;
let snapshot: OfflineSyncSnapshot = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  attention: 0,
  lastError: undefined,
};

const queueablePaths = [
  /^\/sales$/,
  /^\/inventory\/tank-readings$/,
  /^\/inventory\/density-readings$/,
  /^\/customers\/[^/]+\/receipts$/,
  /^\/purchases\/expenses$/,
];

const cacheablePaths = [
  /^\/dashboard\/bootstrap(?:\?|$)/,
  /^\/shifts\/bootstrap(?:\?|$)/,
  /^\/sales\/bootstrap(?:\?|$)/,
  /^\/inventory\/bootstrap(?:\?|$)/,
  /^\/customers\/bootstrap(?:\?|$)/,
  /^\/purchases\/bootstrap(?:\?|$)/,
  /^\/reconciliation\/bootstrap(?:\?|$)/,
  /^\/accounting\/bootstrap(?:\?|$)/,
  /^\/reports\/bootstrap(?:\?|$)/,
  /^\/stations(?:\?|$)/,
  /^\/products(?:\?|$)/,
];

function emit() {
  listeners.forEach((listener) => listener());
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("fuelnerve:sync-status", { detail: snapshot }));
}

function setSnapshot(next: Partial<OfflineSyncSnapshot>) {
  snapshot = { ...snapshot, ...next };
  emit();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Offline storage is unavailable."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REQUESTS))
        database.createObjectStore(REQUESTS, { keyPath: "id" });
      if (!database.objectStoreNames.contains(RESPONSES))
        database.createObjectStore(RESPONSES, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage could not be opened."));
  });
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("Offline storage failed."));
    tx.oncomplete = () => { database.close(); resolve(result); };
    tx.onerror = () => reject(tx.error ?? new Error("Offline storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Offline storage was interrupted."));
  });
}

async function allRequests(): Promise<OfflineRequest[]> {
  const rows = await transaction<OfflineRequest[]>(REQUESTS, "readonly", (store) => store.getAll());
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function refreshCounts() {
  const requestedScope = scope;
  if (!requestedScope) return setSnapshot({ pending: 0, attention: 0 });
  try {
    const rows = (await allRequests()).filter((item) => item.scope === requestedScope);
    if (scope !== requestedScope) return;
    setSnapshot({
      pending: rows.filter((item) => item.status === "pending").length,
      attention: rows.filter((item) => item.status === "attention").length,
    });
  } catch (error) {
    setSnapshot({ lastError: error instanceof Error ? error.message : "Offline storage failed." });
  }
}

export function isOfflineQueueable(method: string, path: string) {
  return method === "POST" && queueablePaths.some((pattern) => pattern.test(path));
}

export function isOfflineCacheable(path: string) {
  return cacheablePaths.some((pattern) => pattern.test(path));
}

export function currentOfflineScope() {
  return scope;
}

export function configureOfflineSync(nextScope: string | null, nextReplay?: Replay) {
  scope = nextScope;
  if (nextReplay) replay = nextReplay;
  void refreshCounts();
  if (scope && snapshot.online) void syncOfflineRequests();
}

export async function enqueueOfflineRequest(input: Omit<OfflineRequest, "id" | "scope" | "createdAt" | "attempts" | "status">) {
  if (!scope) throw new Error("Sign in online once before saving offline.");
  const item: OfflineRequest = {
    ...input,
    id: input.idempotencyKey,
    scope,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  await transaction(REQUESTS, "readwrite", (store) => store.put(item));
  await refreshCounts();
  return item;
}

async function saveRequest(item: OfflineRequest) {
  await transaction(REQUESTS, "readwrite", (store) => store.put(item));
}

async function deleteRequest(id: string) {
  await transaction(REQUESTS, "readwrite", (store) => store.delete(id));
}

export async function syncOfflineRequests() {
  if (syncing || !scope || !replay || !snapshot.online) return;
  syncing = true;
  setSnapshot({ syncing: true, lastError: undefined });
  try {
    const rows = (await allRequests()).filter((item) => item.scope === scope && item.status === "pending");
    for (const item of rows) {
      const result = await replay(item);
      if (result.ok) {
        await deleteRequest(item.id);
        if (typeof window !== "undefined") window.dispatchEvent(new Event("fuelnerve:records-changed"));
        continue;
      }
      const updated = {
        ...item,
        attempts: item.attempts + 1,
        status: result.retryable ? "pending" as const : "attention" as const,
        lastError: result.message,
      };
      await saveRequest(updated);
      setSnapshot({ lastError: result.message });
      // Preserve posting order. A later record may depend on this one.
      break;
    }
  } finally {
    syncing = false;
    setSnapshot({ syncing: false });
    await refreshCounts();
  }
}

export async function retryOfflineRequests() {
  if (!scope) return;
  const rows = (await allRequests()).filter((item) => item.scope === scope && item.status === "attention");
  for (const item of rows) {
    const { lastError: _lastError, ...withoutError } = item;
    await saveRequest({ ...withoutError, status: "pending" });
  }
  await refreshCounts();
  await syncOfflineRequests();
}

export async function cacheOfflineResponse(path: string, value: unknown) {
  if (!scope || !isOfflineCacheable(path)) return;
  const id = `${scope}:${path}`;
  try {
    await transaction(RESPONSES, "readwrite", (store) =>
      store.put({ id, scope, path, value, cachedAt: new Date().toISOString() }),
    );
  } catch {
    // A fresh server response must never fail because local caching is unavailable.
  }
}

export async function readOfflineResponse<T>(path: string): Promise<T | undefined> {
  if (!scope || !isOfflineCacheable(path)) return undefined;
  try {
    const row = await transaction<{ value: T } | undefined>(RESPONSES, "readonly", (store) =>
      store.get(`${scope}:${path}`),
    );
    return row?.value;
  } catch {
    return undefined;
  }
}

export function markOffline() {
  setSnapshot({ online: false });
}

export function markOnline() {
  setSnapshot({ online: true, lastError: undefined });
}

export function getOfflineSyncSnapshot() {
  return snapshot;
}

export function subscribeOfflineSync(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startOfflineSync() {
  if (started || typeof window === "undefined" || import.meta.env.MODE === "test") return;
  started = true;
  window.addEventListener("offline", markOffline);
  const reconnect = () => {
    if (!navigator.onLine) return;
    markOnline();
    void syncOfflineRequests();
  };
  window.addEventListener("online", reconnect);
  window.addEventListener("focus", reconnect);
  window.setInterval(() => {
    if (snapshot.pending > 0) reconnect();
  }, 15_000);
}
