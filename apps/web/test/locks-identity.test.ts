import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '../src/auth/session';
import { getMeta } from '../src/storage/cache';
import { enqueueCreate, listQueue } from '../src/storage/queue';
import { flush, getSyncStatus, syncAll } from '../src/sync/engine';
import { fake, server } from './server';

const ID = '12121212-1212-4212-8212-121212121212';
const rec = {
  id: ID,
  date: '2026-10-01',
  odometer: 1,
  provider: null,
  description: 'Lock test',
  cost_minor: 1,
  currency: 'MYR' as const,
  notes: null,
};
const vehicle = (id: string) => ({
  id,
  model: '7X',
  variant: '',
  drive: 'AWD',
  steering: 'RHD',
  registration: null,
  vin: null,
  purchase_date: null,
  purchase_price_minor: 0,
  currency: 'MYR',
  tyre_spec: null,
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
});

function stubLocks(grant: boolean) {
  const request = vi.fn(
    async (_name: string, _opts: unknown, cb: (l: unknown) => Promise<unknown>) =>
      cb(grant ? { name: 'x' } : null),
  );
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  return request;
}

describe('W4: flush runs under a Web Lock', () => {
  it('takes the lock (ifAvailable) and sends when it is granted', async () => {
    setToken('tok-test', 3600);
    const request = stubLocks(true);
    await enqueueCreate(rec);
    await flush(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('zeekr-companion-queue-flush');
    expect(request.mock.calls[0]?.[1]).toMatchObject({ ifAvailable: true });
    expect(fake.posts).toHaveLength(1);
  });

  it('does not send when another tab holds the lock', async () => {
    setToken('tok-test', 3600);
    stubLocks(false);
    await enqueueCreate(rec);
    await flush(true);
    expect(fake.posts).toHaveLength(0);
    expect(await listQueue()).toHaveLength(1);
  });

  it('falls back to in-tab single flight when navigator.locks is missing', async () => {
    setToken('tok-test', 3600);
    expect('locks' in navigator).toBe(false);
    await enqueueCreate(rec);
    await Promise.all([flush(true), flush(true)]);
    expect(fake.posts).toHaveLength(1);
  });
});

describe('W4: server identity marker', () => {
  it('stores the vehicle id as the server identity after contact', async () => {
    setToken('tok-test', 3600);
    fake.vehicle = vehicle('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await enqueueCreate(rec);
    await flush(true);
    expect(await getMeta('server_identity')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(fake.posts).toHaveLength(1);
  });

  it('does NOT replay the queue against a server with a different vehicle', async () => {
    setToken('tok-test', 3600);
    fake.vehicle = vehicle('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await syncAll(true); // learns identity A
    await enqueueCreate(rec);
    fake.vehicle = vehicle('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'); // restored/other server
    await flush(true);
    expect(fake.posts).toHaveLength(0);
    expect(await listQueue()).toHaveLength(1);
    expect(getSyncStatus().identityMismatch).toBe(true);
  });

  it('a server that lost its vehicle also counts as a different server once identity is known', async () => {
    setToken('tok-test', 3600);
    fake.vehicle = vehicle('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    await syncAll(true);
    await enqueueCreate(rec);
    fake.vehicle = null;
    await flush(true);
    expect(fake.posts).toHaveLength(0);
    expect(getSyncStatus().identityMismatch).toBe(true);
  });

  it('first use (no marker) against a server with no vehicle sends normally', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec);
    await flush(true);
    expect(fake.posts).toHaveLength(1);
    expect(getSyncStatus().identityMismatch).toBe(false);
  });

  it('an unreachable server during the identity check sends nothing and keeps the item', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec);
    server.use(http.get('*/api/v1/vehicle', () => HttpResponse.error()));
    await flush(true);
    expect(fake.posts).toHaveLength(0);
    expect((await listQueue())[0]?.status).toBe('pending');
  });
});
