import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { api, OfflineQueuedError, setOfflineUserScope } from './api';
import {
  getOfflineSyncSnapshot,
  markOffline,
  markOnline,
  syncOfflineRequests,
} from './offline-sync';

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('fuelnerve-offline-v1');
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Offline database remained open.'));
});
const waitForPending = async (expected: number) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getOfflineSyncSnapshot().pending === expected) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

beforeEach(async () => {
  await deleteDatabase();
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  markOffline();
  setOfflineUserScope('org-1:user-1');
});

afterEach(() => {
  setOfflineUserScope(null);
  vi.unstubAllGlobals();
});

it('durably queues an offline financial record and replays it once with the same idempotency key', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  await expect(api.createExpense({ stationId: 'station-1', categoryId: 'category-1', description: 'Generator fuel', amount: 750, paymentMethod: 'CASH', incurredAt: new Date().toISOString(), attachment: null })).rejects.toBeInstanceOf(OfflineQueuedError);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getOfflineSyncSnapshot()).toMatchObject({ online: false, pending: 1, attention: 0 });

  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  markOnline();
  fetchMock.mockResolvedValue({
    status: 201,
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ expense: { id: 'expense-1' } }),
  });
  await syncOfflineRequests();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string>; body: string };
  expect(init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  expect(JSON.parse(init.body)).toMatchObject({ description: 'Generator fuel', amount: 750 });
  expect(getOfflineSyncSnapshot()).toMatchObject({ online: true, pending: 0, attention: 0 });
});

it('keeps queued records isolated to the authenticated organization and user', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(api.createSale({ stationId: 'station-1', shiftId: 'shift-1', productId: 'product-1', employeeId: 'user-1', paymentMethod: 'CASH', unitPrice: 100, quantity: 2, tankId: null, nozzleId: null, meterOpening: null, meterClosing: null, customerId: null, vehicleId: null })).rejects.toBeInstanceOf(OfflineQueuedError);
  expect(getOfflineSyncSnapshot().pending).toBe(1);

  setOfflineUserScope('org-2:user-2');
  await waitForPending(0);
  expect(getOfflineSyncSnapshot().pending).toBe(0);

  setOfflineUserScope('org-1:user-1');
  await waitForPending(1);
  expect(getOfflineSyncSnapshot().pending).toBe(1);
});

it('uses a scoped last-known response when a read loses its connection', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  markOnline();
  const cachedDashboard = { asOf: '2026-09-27T00:00:00.000Z', tankStocks: [] };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => cachedDashboard })
    .mockRejectedValueOnce(new TypeError('offline'));
  vi.stubGlobal('fetch', fetchMock);

  await expect(api.dashboardBootstrap()).resolves.toEqual(cachedDashboard);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await expect(api.dashboardBootstrap()).resolves.toEqual(cachedDashboard);
  expect(getOfflineSyncSnapshot().online).toBe(false);
});

it('stops retrying a rejected record and surfaces it for attention', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(api.createExpense({ stationId: 'station-1', categoryId: 'category-1', description: 'Invalid expense', amount: 50, paymentMethod: 'CASH', incurredAt: new Date().toISOString(), attachment: null })).rejects.toBeInstanceOf(OfflineQueuedError);

  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  markOnline();
  vi.mocked(fetch).mockResolvedValue({
    status: 409,
    ok: false,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: { code: 'STALE_RECORD', message: 'Review this saved record before posting.' } }),
  } as unknown as Response);
  await syncOfflineRequests();

  expect(getOfflineSyncSnapshot()).toMatchObject({ pending: 0, attention: 1, lastError: 'Review this saved record before posting.' });
});
