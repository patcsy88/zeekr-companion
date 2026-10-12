import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { setToken } from '../src/auth/session';
import { getSession } from '../src/auth/session';
import { readRecords } from '../src/data/repository';
import { saveNewRecord } from '../src/data/mutations';
import { reportReachable } from '../src/lib/connectivity';
import { enqueueCreate, enqueueDelete, enqueueEdit, listQueue } from '../src/storage/queue';
import { backoffMs, flush, syncAll } from '../src/sync/engine';
import { err, fake, server } from './server';

const ID = '22222222-2222-4222-8222-222222222222';
const rec = (id = ID, extra = {}) => ({
  id,
  date: '2026-10-01',
  odometer: 5000,
  provider: null,
  description: 'Oil change',
  cost_minor: 12050,
  currency: 'MYR' as const,
  notes: null,
  ...extra,
});

describe('AC-9: offline create is pending, then sent exactly once', () => {
  it('queues while offline, shows pending, and POSTs exactly once on reconnect', async () => {
    setToken('tok-test', 3600);
    reportReachable(false);
    await saveNewRecord(rec());
    expect(fake.posts).toHaveLength(0); // nothing sent while offline
    const snap = await readRecords();
    expect(snap.views).toHaveLength(1);
    expect(snap.views[0]?.sync).toBe('pending');

    reportReachable(true);
    // Reconnect triggers can overlap (online event + visibilitychange + button): single flight.
    await Promise.all([flush(true), flush(true), syncAll(true)]);
    await flush(true);

    expect(fake.posts).toHaveLength(1);
    expect(fake.records.size).toBe(1);
    expect(await listQueue()).toHaveLength(0);
    const after = await readRecords();
    expect(after.views).toHaveLength(1);
    expect(after.views[0]?.sync).toBe('synced');
  });

  it('offline create then edit is coalesced into one POST with the final content', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec());
    await enqueueEdit(ID, { description: 'Edited', cost_minor: 100 });
    await flush(true);
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]).toMatchObject({ id: ID, description: 'Edited', cost_minor: 100 });
    expect(fake.deletes).toHaveLength(0);
  });

  it('a lost response then a replay does not duplicate: 200 is accepted as success', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec());
    let first = true;
    server.use(
      http.post('*/api/v1/service-records', async ({ request }) => {
        const body = (await request.json()) as { id: string };
        fake.posts.push(body);
        const stored = { ...body, created_at: 'x', updated_at: 'x' };
        fake.records.set(body.id, stored as never);
        if (first) {
          first = false;
          return HttpResponse.error(); // server saved it, the response was lost
        }
        return HttpResponse.json(stored, { status: 200 }); // identical replay
      }),
    );
    await flush(true);
    expect(await listQueue()).toHaveLength(1); // still queued
    await flush(true); // force ignores backoff
    expect(await listQueue()).toHaveLength(0);
    expect(fake.records.size).toBe(1);
  });
});

describe('flush error handling', () => {
  it('401 pauses the queue and asks for the password; the item stays pending', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec());
    server.use(http.post('*/api/v1/service-records', () => err(401, 'unauthenticated', 'x')));
    await flush(true);
    expect(getSession()).toEqual({ signedIn: false, needsLogin: true });
    const [e] = await listQueue();
    expect(e?.status).toBe('pending');
  });

  it('400 marks the item failed and keeps the server details', async () => {
    setToken('tok-test', 3600);
    fake.rejectDate = true;
    await enqueueCreate(rec());
    await flush(true);
    const [e] = await listQueue();
    expect(e?.status).toBe('failed');
    expect(e?.last_error?.details).toEqual([{ field: 'date', issue: 'must not be in the future' }]);
    const snap = await readRecords();
    expect(snap.views[0]?.sync).toBe('failed');
  });

  it('409 marks the item failed', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec());
    server.use(http.post('*/api/v1/service-records', () => err(409, 'conflict', 'exists')));
    await flush(true);
    expect((await listQueue())[0]?.status).toBe('failed');
  });

  it('5xx retries with backoff and does not fail the item', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec());
    fake.down = true;
    await flush(true);
    const [e] = await listQueue();
    expect(e?.status).toBe('pending');
    expect(e?.attempts).toBe(1);
    expect(e?.next_attempt_at).toBeGreaterThan(Date.now());
    // A normal (non-forced) flush respects the backoff window.
    fake.down = false;
    await flush(false);
    expect(fake.posts).toHaveLength(1);
    await flush(true);
    expect(fake.posts).toHaveLength(2);
    expect(fake.records.size).toBe(1);
  });

  it('network error keeps the item pending', async () => {
    setToken('tok-test', 3600);
    await enqueueCreate(rec());
    server.use(http.post('*/api/v1/service-records', () => HttpResponse.error()));
    await flush(true);
    expect((await listQueue())[0]).toMatchObject({
      status: 'pending',
      last_error: { code: 'network' },
    });
  });

  it('DELETE returning 404 counts as success', async () => {
    setToken('tok-test', 3600);
    await enqueueEdit(ID, { description: 'x' }); // makes the id known to the queue
    await enqueueDelete(ID);
    await flush(true);
    expect(await listQueue()).toHaveLength(0);
  });

  it('a failed item does not block other records', async () => {
    setToken('tok-test', 3600);
    const A = '33333333-3333-4333-8333-333333333333';
    await enqueueCreate(rec(A, { cost_minor: -1 }));
    await enqueueCreate(rec());
    server.use(
      http.post('*/api/v1/service-records', async ({ request }) => {
        const b = (await request.json()) as { id: string; cost_minor: number };
        if (b.cost_minor < 0)
          return err(400, 'validation_error', 'bad', [
            { field: 'cost_minor', issue: 'must be >= 0' },
          ]);
        fake.records.set(b.id, b as never);
        return HttpResponse.json(b, { status: 201 });
      }),
    );
    await flush(true);
    const q = await listQueue();
    expect(q.map((e) => e.status)).toEqual(['failed']);
    expect(fake.records.has(ID)).toBe(true);
  });

  it('without a token the queue is not sent and a login is requested', async () => {
    await enqueueCreate(rec());
    await flush(true);
    expect(fake.posts).toHaveLength(0);
    expect(getSession().needsLogin).toBe(true);
  });

  it('backoff grows and is capped', () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(20)).toBe(60000);
  });
});

describe('AC-7 logic: cache is readable with no network and no login', () => {
  it('serves the last list from IndexedDB when the server is unreachable', async () => {
    setToken('tok-test', 3600);
    fake.records.set(ID, {
      ...rec(),
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    });
    await syncAll(true);
    expect((await readRecords()).views).toHaveLength(1);

    // Cold start: new session (no token), server unreachable.
    const { signOut } = await import('../src/auth/session');
    signOut();
    server.use(http.get('*/api/v1/service-records', () => HttpResponse.error()));
    const snap = await readRecords();
    expect(snap.loaded).toBe(true);
    expect(snap.views.map((v) => v.record.id)).toEqual([ID]);
  });

  it('the token and password are never written to storage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    setToken('tok-secret-value', 3600);
    await syncAll(true);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage })).not.toContain('tok-secret-value');
  });
});
