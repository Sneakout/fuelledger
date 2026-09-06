import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { api } from './api';

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
it('coalesces double submissions and reuses the key after a lost response', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const keys: string[] = [];
  let attempt = 0;
  const fetchMock = vi.fn(async (_url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    if (++attempt === 1) throw new TypeError('Connection lost after server saved');
    return { status: 201, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ expense: { id: 'saved-once' } }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  const input = { stationId: 's', amount: 100 } as any;
  const first = await Promise.allSettled([api.createExpense(input), api.createExpense(input)]);
  expect(first.every(result => result.status === 'rejected')).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await api.createExpense(input);
  expect(keys[0]).toBe(keys[1]);
  expect(sessionStorage.length).toBe(0);
});
