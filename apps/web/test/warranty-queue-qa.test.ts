import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { setToken, signOut } from '../src/auth/session';
import { readWarranty, refreshWarranty } from '../src/data/warranty';
import { reportReachable } from '../src/lib/connectivity';
import { getCache, setCache } from '../src/storage/cache';
import { clearAllLocalData, closeDbForTests, getDb } from '../src/storage/db';
import {
  blockedClaimIds,
  countQueue,
  discardFailedCoverage,
  enqueueClaimCreate,
  enqueueClaimDelete,
  enqueueClaimEdit,
  enqueueCoverageCreate,
  enqueueCoverageDelete,
  enqueueCoverageEdit,
  enqueueCreate,
  enqueueDelete,
  enqueueReminderCreate,
  listQueue,
  retryFailed,
  updateEntry,
} from '../src/storage/queue';
import { flush, syncAll } from '../src/sync/engine';
import {
  claim,
  cid,
  cov,
  lid,
  rid,
  startTrace,
  STAMP,
  stopTrace,
  writesOf,
} from './warranty-qa-helpers';
import { fake, err, server } from './server';

afterEach(() => {
  stopTrace();
});

function online() {
  setToken('tok-test', 3600);
  reportReachable(true);
}

const covBody = (n: number, over: Record<string, unknown> = {}) => ({
  id: cid(n),
  name: `Fictional cover ${n}`,
  provider_type: 'extended' as const,
  start_date: '2026-01-01',
  end_date: '2030-01-01',
  km_limit: 100000,
  ...over,
});
const clmBody = (n: number, covN: number, over: Record<string, unknown> = {}) => ({
  id: lid(n),
  coverage_id: cid(covN),
  date: '2026-10-01',
  odometer: 1000,
  description: `Fictional claim ${n}`,
  status: 'submitted' as const,
  ...over,
});

describe('QA AC-62: queue order', () => {
  it('a claim create queued BEFORE its coverage create is still sent after it', async () => {
    const trace = startTrace();
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueCoverageCreate(covBody(1));
    online();
    await flush(true);
    const order = trace.filter((t) => t.method === 'POST').map((t) => t.path.split('/').pop());
    expect(order).toEqual(['warranty-coverages', 'warranty-claims']);
    expect(fake.claims.size).toBe(1);
    expect(await listQueue()).toHaveLength(0);
  });

  it('coverage 400 then 409 on retry: claim stays Blocked and is never POSTed; other items flow', async () => {
    fake.coveragePostFailures = [400, 0, 409];
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueCoverageCreate(covBody(2));
    await enqueueClaimCreate(clmBody(2, 2));
    await enqueueReminderCreate({
      id: 'e0000000-0000-4000-8000-000000000001',
      title: 'Fictional reminder',
      due_date: '2030-01-01',
    } as never);
    online();
    // First flush: coverage 1 gets 400, coverage 2 is created normally.
    await flush(true);
    expect(fake.claimPosts.map((c) => c.id)).toEqual([lid(2)]);
    expect(fake.coverages.has(cid(2))).toBe(true);
    expect(fake.reminders.size).toBe(1);
    let q = await listQueue();
    expect(q.map((e) => e.kind).sort()).toEqual(['create-claim', 'create-coverage']);
    expect(blockedClaimIds(q).get(lid(1))).toBe(cid(1));
    expect(await countQueue()).toEqual({ pending: 0, failed: 1, blocked: 1 });

    // Retry hits 409: still failed, claim still never sent.
    await retryFailed(cid(1));
    await flush(true);
    expect(fake.claimPosts.map((c) => c.id)).toEqual([lid(2)]);
    q = await listQueue();
    expect(q.find((e) => e.kind === 'create-coverage')?.last_error?.status).toBe(409);
    expect(await countQueue()).toEqual({ pending: 0, failed: 1, blocked: 1 });
    // The blocked claim has no failed state of its own.
    expect(q.find((e) => e.kind === 'create-claim')?.status).toBe('pending');
  });

  it('blocked claim, then the coverage succeeds on retry: the claim is sent exactly once', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    await flush(true);
    expect(fake.claimPosts).toHaveLength(0);
    await retryFailed(cid(1));
    await flush(true);
    await flush(true);
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(2); // the 400 and the success
    expect(fake.claimPosts).toHaveLength(1);
    expect(await listQueue()).toHaveLength(0);
  });

  it('fixing a failed coverage by editing it unblocks the claim (edit coalesces into the failed create)', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    await flush(true);
    await enqueueCoverageEdit(cid(1), { name: 'Fixed name' });
    const q = await listQueue();
    expect(q.filter((e) => e.kind === 'create-coverage')).toHaveLength(1);
    expect(q.find((e) => e.kind === 'create-coverage')?.status).toBe('pending');
    await flush(true);
    expect(fake.claimPosts).toHaveLength(1);
    expect(fake.coverages.get(cid(1))?.name).toBe('Fixed name');
  });

  it('discarding the failed coverage drops its blocked claims and reports how many', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueClaimCreate(clmBody(2, 1));
    await enqueueClaimCreate(clmBody(3, 2)); // another coverage's claim (coverage on server)
    online();
    await flush(true);
    const res = await discardFailedCoverage(cid(1));
    expect(res.droppedClaimCreates).toBe(2);
    expect((await listQueue()).map((e) => e.record_id)).toEqual([lid(3)]);
  });

  it('a network failure (not 400/409) on the coverage does not mark the claim blocked', async () => {
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    server.use(http.post('*/api/v1/warranty-coverages', () => HttpResponse.error()));
    await flush(true);
    let q = await listQueue();
    expect(q).toHaveLength(2);
    expect(blockedClaimIds(q).size).toBe(0);
    expect(await countQueue()).toEqual({ pending: 2, failed: 0, blocked: 0 });
    expect(q.every((e) => e.status === 'pending')).toBe(true);
    expect(fake.claimPosts).toHaveLength(0);
    // A non-forced flush while the coverage waits for its backoff must still not send the claim.
    server.resetHandlers();
    await flush();
    expect(fake.claimPosts).toHaveLength(0);
    // Network back: forced flush sends both, once each.
    await flush(true);
    q = await listQueue();
    expect(q).toHaveLength(0);
    expect(fake.coveragePosts).toHaveLength(1);
    expect(fake.claimPosts).toHaveLength(1);
  });

  it('a coverage waiting for backoff holds only its claims; unrelated items still flow', async () => {
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueCoverageCreate(covBody(2));
    online();
    // Coverage 1 got a 503 earlier: waiting.
    const q0 = await listQueue();
    const first = q0.find((e) => e.record_id === cid(1));
    await updateEntry(first?.seq ?? 0, { next_attempt_at: Date.now() + 60_000, attempts: 1 });
    await flush(); // not forced
    expect(fake.coverages.has(cid(2))).toBe(true);
    expect(fake.coverages.has(cid(1))).toBe(false);
    expect(fake.claimPosts).toHaveLength(0);
  });

  it('a 5xx on one item stops the run and everything is sent once after recovery', async () => {
    fake.coveragePostFailures = [503];
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    await flush(true);
    expect(fake.claimPosts).toHaveLength(0);
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(2);
    expect(fake.claimPosts).toHaveLength(1);
    expect(fake.claims.size).toBe(1);
  });
});

describe('QA AC-62: coalescing and delete rules', () => {
  it('edit of an unsent coverage coalesces and can null end_date/km_limit/notes', async () => {
    await enqueueCoverageCreate(covBody(1, { notes: 'x' }));
    await enqueueCoverageEdit(cid(1), { end_date: null, notes: null });
    await enqueueCoverageEdit(cid(1), { km_limit: 5 });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.body).toMatchObject({ end_date: null, notes: null, km_limit: 5 });
    online();
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(1);
    expect(fake.coveragePosts[0]).toMatchObject({ end_date: null, km_limit: 5, notes: null });
  });

  it('delete of an unsent coverage cancels its unsent claims AND their edits, and sends nothing', async () => {
    const trace = startTrace();
    await enqueueCoverageCreate(covBody(1));
    await enqueueCoverageEdit(cid(1), { name: 'b' });
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueClaimEdit(lid(1), { description: 'edited' });
    await enqueueClaimCreate(clmBody(2, 1));
    await enqueueClaimDelete(lid(2));
    const res = await enqueueCoverageDelete(cid(1), []);
    expect(res.droppedClaimCreates).toBe(1);
    expect(await listQueue()).toHaveLength(0);
    online();
    await flush(true);
    expect(trace.filter((t) => t.method !== 'GET')).toHaveLength(0);
  });

  it('delete of a sent coverage drops pending claim creates, claim edits and claim deletes, keeps one DELETE', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claims.set(lid(9), claim(lid(9), cid(1)));
    await enqueueCoverageEdit(cid(1), { name: 'pending edit' });
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueClaimEdit(lid(9), { description: 'edit of server claim' });
    const res = await enqueueCoverageDelete(cid(1), [lid(9)]);
    expect(res.droppedClaimCreates).toBe(1);
    const q = await listQueue();
    expect(q.map((e) => e.kind)).toEqual(['delete-coverage']);
    // A second delete does not duplicate the DELETE.
    await enqueueCoverageDelete(cid(1), [lid(9)]);
    expect((await listQueue()).map((e) => e.kind)).toEqual(['delete-coverage']);
    online();
    await flush(true);
    expect(fake.coverageDeletes).toEqual([cid(1)]);
    expect(fake.claimPosts).toHaveLength(0);
  });

  async function lostResponseCreate(n: number) {
    online();
    server.use(
      http.post(
        '*/api/v1/warranty-coverages',
        async ({ request }) => {
          const b = (await request.json()) as { id: string };
          fake.coverages.set(b.id, cov(b.id, b));
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
    await enqueueCoverageCreate(covBody(n));
    await flush(true);
    expect(fake.coverages.has(cid(n))).toBe(true);
    expect((await listQueue())[0]?.attempts).toBe(1);
  }

  it('delete of an ATTEMPTED coverage create (lost response) still reaches the server (W8 lesson)', async () => {
    await lostResponseCreate(1);
    await enqueueCoverageDelete(cid(1), []);
    expect((await listQueue()).map((e) => e.kind)).toEqual(['create-coverage', 'delete-coverage']);
    await flush(true);
    expect(fake.coverages.size).toBe(0);
    expect(await listQueue()).toHaveLength(0);
  });

  it('edit then delete of an attempted coverage create keeps attempts and a DELETE entry', async () => {
    await lostResponseCreate(1);
    await enqueueCoverageEdit(cid(1), { name: 'edited offline' });
    expect((await listQueue())[0]?.attempts).toBe(1);
    await enqueueCoverageDelete(cid(1), []);
    expect((await listQueue()).map((e) => e.kind)).toEqual(['create-coverage', 'delete-coverage']);
  });

  // QA-WW3 (fixed): after a lost create response, an edit is folded into the create, so the replay has
  // different content than the row the server already holds and the real server answers 409
  // (AC-48). The create then fails and the DELETE queued behind it for the same id is skipped
  // (engine: blocked.has(record_id)), so the coverage the owner deleted stays on the server.
  it('QA-WW3: edit then delete of an attempted coverage create deletes it on the server', async () => {
    server.use(
      http.post('*/api/v1/warranty-coverages', async ({ request }) => {
        const b = (await request.json()) as { id: string; name: string };
        const have = fake.coverages.get(b.id);
        if (have && have.name !== b.name) return err(409, 'conflict', 'Different content.');
        if (have) return HttpResponse.json(have, { status: 200 });
        fake.coverages.set(b.id, cov(b.id, b));
        return HttpResponse.json(cov(b.id, b), { status: 201 });
      }),
    );
    online();
    server.use(
      http.post(
        '*/api/v1/warranty-coverages',
        async ({ request }) => {
          const b = (await request.json()) as { id: string };
          fake.coverages.set(b.id, cov(b.id, b));
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
    await enqueueCoverageCreate(covBody(1));
    await flush(true);
    await enqueueCoverageEdit(cid(1), { name: 'edited offline' });
    await enqueueCoverageDelete(cid(1), []);
    await flush(true);
    expect(fake.coverages.size).toBe(0);
  });

  it('delete of an ATTEMPTED claim create (lost response) still reaches the server', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    online();
    server.use(
      http.post(
        '*/api/v1/warranty-claims',
        async ({ request }) => {
          const b = (await request.json()) as { id: string };
          fake.claims.set(b.id, claim(b.id, cid(1)));
          return HttpResponse.error();
        },
        { once: true },
      ),
    );
    await enqueueClaimCreate(clmBody(1, 1));
    await flush(true);
    expect(fake.claims.has(lid(1))).toBe(true);
    await enqueueClaimEdit(lid(1), { description: 'edited' });
    await enqueueClaimDelete(lid(1));
    expect((await listQueue()).map((e) => e.kind)).toEqual(['create-claim', 'delete-claim']);
    await flush(true);
    expect(fake.claims.size).toBe(0);
  });

  it('a replayed DELETE answered 404 is success for coverage and for claim (cache and queue cleaned)', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claims.set(lid(1), claim(lid(1), cid(1)));
    online();
    await refreshWarranty();
    fake.coverages.clear();
    fake.claims.clear();
    await enqueueClaimDelete(lid(1));
    await enqueueCoverageDelete(cid(1), []);
    await flush(true);
    expect(await listQueue()).toHaveLength(0);
    const snap = await readWarranty();
    expect(snap.coverages).toHaveLength(0);
    expect(snap.claims).toHaveLength(0);
    expect((await getCache<{ items: unknown[] }>('warranty-claims'))?.value.items).toHaveLength(0);
  });

  it('400 and 409 on one item do not stop the others, and each failure keeps its own error', async () => {
    fake.coveragePostFailures = [400, 409, 0];
    for (const n of [1, 2, 3]) await enqueueCoverageCreate(covBody(n));
    await enqueueClaimCreate(clmBody(3, 3));
    online();
    await flush(true);
    const q = await listQueue();
    const byId = Object.fromEntries(q.map((e) => [e.record_id, e]));
    expect(byId[cid(1)]?.last_error?.status).toBe(400);
    expect(byId[cid(2)]?.last_error?.status).toBe(409);
    expect(byId[cid(3)]).toBeUndefined();
    expect(fake.claims.has(lid(3))).toBe(true);
  });

  it('a claim create that the server refuses (400) fails alone and does not block a later claim', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claimPostFailures = [400, 0];
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueClaimCreate(clmBody(2, 1));
    online();
    await flush(true);
    expect(fake.claims.has(lid(2))).toBe(true);
    expect(fake.claims.has(lid(1))).toBe(false);
    expect((await listQueue()).map((e) => [e.record_id, e.status])).toEqual([[lid(1), 'failed']]);
  });

  it('discarding a failed edit-coverage does not drop claim creates', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    await enqueueCoverageEdit(cid(1), { name: 'x' });
    await enqueueClaimCreate(clmBody(1, 1));
    const q = await listQueue();
    await updateEntry(q[0]?.seq ?? 0, { status: 'failed' });
    const res = await discardFailedCoverage(cid(1));
    expect(res.droppedClaimCreates).toBe(0);
    expect((await listQueue()).map((e) => e.kind)).toEqual(['create-claim']);
  });

  // QA-WW1 (fixed): deleting a coverage whose create FAILED (400) keeps the failed create in the queue
  // next to the DELETE. The DELETE gets 404 (success) and is removed, but the failed create stays
  // and the coverage reappears as a failed item the owner just deleted.
  it('QA-WW1: delete of a failed (400) coverage create leaves nothing behind after the flush', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(covBody(1));
    online();
    await flush(true);
    await enqueueCoverageDelete(cid(1), []);
    await flush(true);
    expect(await listQueue()).toHaveLength(0);
    expect((await readWarranty()).coverages).toHaveLength(0);
  });

  it('delete of a coverage create refused with 409 still sends a DELETE (the server holds that id)', async () => {
    fake.coveragePostFailures = [409];
    await enqueueCoverageCreate(covBody(1));
    online();
    await flush(true);
    await enqueueCoverageDelete(cid(1), []);
    expect((await listQueue()).map((e) => e.kind)).toEqual(['delete-coverage']);
  });

  // QA-WW2 (fixed): same for a claim whose create failed.
  it('QA-WW2: delete of a failed (400) claim create leaves nothing behind', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claimPostFailures = [400];
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    await flush(true);
    await enqueueClaimDelete(lid(1));
    await flush(true);
    expect(await listQueue()).toHaveLength(0);
  });
});

describe('QA AC-62: durability and exactly-once', () => {
  it('the queue survives closing and reopening the database', async () => {
    await enqueueCoverageCreate(covBody(1));
    await enqueueClaimCreate(clmBody(1, 1));
    await closeDbForTests();
    const q = await listQueue();
    expect(q.map((e) => e.kind)).toEqual(['create-coverage', 'create-claim']);
    online();
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(1);
    expect(fake.claimPosts).toHaveLength(1);
  });

  it('entries left "sending" by a dead page are resent once, with the same ids', async () => {
    await enqueueCoverageCreate(covBody(1));
    const q = await listQueue();
    await updateEntry(q[0]?.seq ?? 0, { status: 'sending', attempts: 1 });
    online();
    await flush(true);
    expect(fake.coveragePosts.map((c) => c.id)).toEqual([cid(1)]);
  });

  it('two concurrent flush() calls send each item exactly once', async () => {
    server.use(
      http.post('*/api/v1/warranty-coverages', async ({ request }) => {
        const b = (await request.json()) as { id: string };
        fake.coveragePosts.push(b as never);
        await delay(40);
        const c = cov(b.id);
        fake.coverages.set(b.id, c);
        return HttpResponse.json(c, { status: 201 });
      }),
    );
    await enqueueCoverageCreate(covBody(1));
    await enqueueCoverageCreate(covBody(2));
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    await Promise.all([flush(), flush(true), flush(), flush(true)]);
    await flush(true);
    expect(fake.coveragePosts.map((c) => c.id).sort()).toEqual([cid(1), cid(2)]);
    expect(fake.claimPosts).toHaveLength(1);
    expect(await listQueue()).toHaveLength(0);
  });

  it('a write queued while a flush is running is not lost and not duplicated', async () => {
    server.use(
      http.post('*/api/v1/warranty-coverages', async ({ request }) => {
        const b = (await request.json()) as { id: string };
        fake.coveragePosts.push(b as never);
        await delay(30);
        fake.coverages.set(b.id, cov(b.id));
        return HttpResponse.json(cov(b.id), { status: 201 });
      }),
    );
    await enqueueCoverageCreate(covBody(1));
    online();
    const p = flush(true);
    await delay(10);
    await enqueueCoverageCreate(covBody(2));
    const p2 = flush();
    await Promise.all([p, p2]);
    expect(fake.coveragePosts.map((c) => c.id).sort()).toEqual([cid(1), cid(2)]);
  });

  it('401 while sending a claim pauses the queue and keeps the entry', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    await enqueueClaimCreate(clmBody(1, 1));
    online();
    server.use(
      http.post('*/api/v1/warranty-claims', () => err(401, 'unauthenticated', 'Expired.'), {
        once: true,
      }),
    );
    await flush(true);
    expect(await listQueue()).toHaveLength(1);
    expect((await listQueue())[0]?.status).toBe('pending');
    expect(fake.claims.size).toBe(0);
  });
});

describe('QA AC-61/62: local data, sign-out and identity', () => {
  it('"clear local data" wipes the warranty cache, templates and queue', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    online();
    await syncAll(true);
    await enqueueCoverageCreate(covBody(2));
    expect(await getCache('warranty-coverages')).toBeDefined();
    expect(await getCache('warranty-claims')).toBeDefined();
    expect(await getCache('warranty-templates')).toBeDefined();
    await clearAllLocalData();
    const db = await getDb();
    expect(await db.count('cache')).toBe(0);
    expect(await db.count('queue')).toBe(0);
    expect(await db.count('meta')).toBe(0);
    const snap = await readWarranty();
    expect(snap.loaded).toBe(false);
    expect(snap.coverages).toHaveLength(0);
  });

  it('sign-out (keep data) then sign-in again refreshes a stale cache; deleted-elsewhere items go', async () => {
    fake.coverages.set(cid(1), cov(cid(1), { name: 'Will be deleted elsewhere' }));
    fake.coverages.set(cid(2), cov(cid(2), { name: 'Stays' }));
    online();
    await syncAll(true);
    expect((await readWarranty()).coverages).toHaveLength(2);
    signOut();
    fake.coverages.delete(cid(1));
    expect((await readWarranty()).coverages).toHaveLength(2); // stale, offline of the account
    online();
    await syncAll(true);
    expect((await readWarranty()).coverages.map((v) => v.coverage.name)).toEqual(['Stays']);
  });

  it('signed out: flush sends nothing and keeps the queue', async () => {
    await enqueueCoverageCreate(covBody(1));
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(0);
    expect(await listQueue()).toHaveLength(1);
  });
});

describe('QA AC-52: the offline current odometer is the reminders one', () => {
  const rec = (n: number, date: string, odometer: number, created = STAMP) => ({
    id: rid(n),
    date,
    odometer,
    provider: null,
    description: `Fictional service ${n}`,
    cost_minor: 100,
    currency: 'MYR',
    notes: null,
    created_at: created,
    updated_at: created,
  });
  const seedRecords = (...items: ReturnType<typeof rec>[]) =>
    setCache('service-records', { items, next_cursor: null });
  const snapOdo = async () => (await readWarranty()).basis;

  it('is the record with the latest DATE, not the highest odometer or the latest created_at', async () => {
    await seedRecords(
      rec(1, '2026-05-01', 90000, '2026-06-01T00:00:00Z'),
      rec(2, '2026-09-01', 20000, '2026-06-02T00:00:00Z'),
      rec(3, '2026-07-01', 99999, '2026-10-01T00:00:00Z'),
    );
    expect(await snapOdo()).toEqual({ km: 20000, date: '2026-09-01', unsent: false });
  });

  it('same date: later created_at wins, then the greater id', async () => {
    await seedRecords(
      rec(1, '2026-09-01', 1000, '2026-09-01T10:00:00Z'),
      rec(2, '2026-09-01', 2000, '2026-09-01T11:00:00Z'),
    );
    expect((await snapOdo())?.km).toBe(2000);
    await seedRecords(
      rec(1, '2026-09-01', 1000, '2026-09-01T10:00:00Z'),
      rec(2, '2026-09-01', 2000, '2026-09-01T10:00:00Z'),
    );
    expect((await snapOdo())?.km).toBe(2000);
  });

  it('includes a pending (unsent) service record and says so; a pending delete removes it', async () => {
    await seedRecords(rec(1, '2026-09-01', 20000));
    await enqueueCreate({
      id: rid(7),
      date: '2026-10-05',
      odometer: 21500,
      description: 'Pending service',
      cost_minor: 100,
      currency: 'MYR',
    } as never);
    expect(await snapOdo()).toEqual({ km: 21500, date: '2026-10-05', unsent: true });
    await enqueueDelete(rid(7));
    expect(await snapOdo()).toEqual({ km: 20000, date: '2026-09-01', unsent: false });
    await enqueueDelete(rid(1));
    expect(await snapOdo()).toBeNull();
  });

  it('a pending record older than the newest cached one does not win', async () => {
    await seedRecords(rec(1, '2026-09-01', 20000));
    await enqueueCreate({
      id: rid(8),
      date: '2026-08-01',
      odometer: 99,
      description: 'Backdated',
      cost_minor: 1,
      currency: 'MYR',
    } as never);
    expect((await snapOdo())?.km).toBe(20000);
  });

  it('falls back to the server value only when no service records were ever loaded', async () => {
    await setCache('warranty-coverages', {
      items: [],
      current_odometer: {
        km: 12345,
        source: 'latest_service_record',
        service_record_id: rid(1),
        date: '2026-09-01',
      },
    });
    expect(await snapOdo()).toEqual({ km: 12345, date: '2026-09-01', unsent: false });
    await seedRecords();
    expect(await snapOdo()).toBeNull();
  });

  it('a claim (even pending, with a huge odometer) never changes the current odometer or status', async () => {
    await seedRecords(rec(1, '2026-09-01', 20000));
    await setCache('warranty-coverages', {
      items: [cov(cid(1), { km_limit: 30000, end_date: '2040-01-01' })],
      current_odometer: null,
    });
    await enqueueClaimCreate(clmBody(1, 1, { odometer: 9_000_000 }));
    const snap = await readWarranty();
    expect(snap.basis?.km).toBe(20000);
    expect(snap.coverages[0]?.coverage.status).toBe('active');
    expect(snap.coverages[0]?.coverage.claim_count).toBe(1);
  });

  it('claim_count equals the listed claims after offline create and delete', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claims.set(lid(9), claim(lid(9), cid(1)));
    online();
    await syncAll(true);
    reportReachable(false);
    signOut(); // nothing is sent
    await enqueueClaimCreate(clmBody(1, 1));
    await enqueueClaimCreate(clmBody(2, 1));
    let s = await readWarranty();
    expect(s.claims.filter((c) => c.claim.coverage_id === cid(1))).toHaveLength(3);
    expect(s.coverages[0]?.coverage.claim_count).toBe(3);
    await enqueueClaimDelete(lid(9));
    await enqueueClaimDelete(lid(1));
    s = await readWarranty();
    expect(s.claims).toHaveLength(1);
    expect(s.coverages[0]?.coverage.claim_count).toBe(1);
  });

  it('claims of a coverage deleted offline disappear and the coverage disappears', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claims.set(lid(9), claim(lid(9), cid(1)));
    online();
    await syncAll(true);
    signOut();
    await enqueueCoverageDelete(cid(1), [lid(9)]);
    const s = await readWarranty();
    expect(s.coverages).toHaveLength(0);
    expect(s.claims).toHaveLength(0);
  });
});

describe('QA: queue entry shapes', () => {
  it('a sent claim PATCH carries only changed fields and never coverage_id', async () => {
    fake.coverages.set(cid(1), cov(cid(1)));
    fake.claims.set(lid(1), claim(lid(1), cid(1)));
    await enqueueClaimEdit(lid(1), { status: 'approved' });
    await enqueueClaimEdit(lid(1), { cost_covered_minor: null });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.body).toEqual({ status: 'approved', cost_covered_minor: null });
    const trace = startTrace();
    online();
    await flush(true);
    const patches = writesOf(trace, 'PATCH', 'warranty-claims');
    expect(patches).toHaveLength(1);
  });
});
