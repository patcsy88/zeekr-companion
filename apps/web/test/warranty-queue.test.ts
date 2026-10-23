import { describe, expect, it } from 'vitest';
import { setToken } from '../src/auth/session';
import {
  countQueue,
  discardFailedCoverage,
  enqueueClaimCreate,
  enqueueClaimDelete,
  enqueueClaimEdit,
  enqueueCoverageCreate,
  enqueueCoverageDelete,
  enqueueCoverageEdit,
  listQueue,
  retryFailed,
  updateEntry,
} from '../src/storage/queue';
import { flush } from '../src/sync/engine';
import { reportReachable } from '../src/lib/connectivity';
import { fake } from './server';

const COV = '55555555-5555-4555-8555-555555555555';
const COV2 = '55555555-5555-4555-8555-666666666666';
const CLM = '66666666-6666-4666-8666-666666666666';
const CLM2 = '66666666-6666-4666-8666-777777777777';
const cov = {
  id: COV,
  name: 'Fictional cover',
  provider_type: 'extended' as const,
  start_date: '2026-01-01',
  end_date: '2030-01-01',
  km_limit: 100000,
};
const claim = {
  id: CLM,
  coverage_id: COV,
  date: '2026-10-01',
  odometer: 1000,
  description: 'Fictional repair',
  status: 'submitted' as const,
};

function online() {
  setToken('tok-test', 3600);
  reportReachable(true);
}

describe('AC-62: warranty queue basics', () => {
  it('uses the entity id as entry id and record id', async () => {
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    const q = await listQueue();
    expect(q[0]).toMatchObject({
      id: COV,
      record_id: COV,
      kind: 'create-coverage',
      path: '/warranty-coverages',
    });
    expect(q[1]).toMatchObject({
      id: CLM,
      record_id: CLM,
      kind: 'create-claim',
      path: '/warranty-claims',
    });
  });

  it('create then edit is coalesced for both kinds', async () => {
    await enqueueCoverageCreate(cov);
    await enqueueCoverageEdit(COV, { name: 'Renamed', km_limit: null });
    await enqueueClaimCreate(claim);
    await enqueueClaimEdit(CLM, { description: 'Changed', cost_covered_minor: 500 });
    const q = await listQueue();
    expect(q).toHaveLength(2);
    expect(q[0]?.body).toMatchObject({ name: 'Renamed', km_limit: null });
    expect(q[1]?.body).toMatchObject({ description: 'Changed', cost_covered_minor: 500 });
  });

  it('re-saving an unsent create replaces it; edits of a sent entity merge', async () => {
    await enqueueCoverageCreate(cov);
    await enqueueCoverageCreate({ ...cov, name: 'Second' });
    await enqueueCoverageEdit(COV2, { name: 'a' });
    await enqueueCoverageEdit(COV2, { notes: 'b' });
    const q = await listQueue();
    expect(q).toHaveLength(2);
    expect(q[1]).toMatchObject({ kind: 'edit-coverage', body: { name: 'a', notes: 'b' } });
  });

  it('delete of an unsent claim cancels it; of an attempted one keeps create and adds DELETE', async () => {
    await enqueueClaimCreate(claim);
    await enqueueClaimDelete(CLM);
    expect(await listQueue()).toHaveLength(0);
    await enqueueClaimCreate(claim);
    const [e] = await listQueue();
    await updateEntry(e?.seq ?? 0, { attempts: 1 });
    await enqueueClaimDelete(CLM);
    expect((await listQueue()).map((x) => x.method)).toEqual(['POST', 'DELETE']);
  });

  it('delete of an unsent coverage cancels it together with its unsent claims', async () => {
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    await enqueueClaimCreate({ ...claim, id: CLM2 });
    await enqueueClaimEdit(CLM2, { odometer: 5 });
    const res = await enqueueCoverageDelete(COV);
    expect(res.droppedClaimCreates).toBe(2);
    expect(await listQueue()).toHaveLength(0);
  });

  it('delete of a sent coverage drops pending claim creates and queues one DELETE', async () => {
    await enqueueClaimCreate(claim);
    await enqueueClaimEdit(CLM2, { odometer: 9 });
    const res = await enqueueCoverageDelete(COV, [CLM2]);
    expect(res.droppedClaimCreates).toBe(1);
    const q = await listQueue();
    expect(q.map((x) => x.kind)).toEqual(['delete-coverage']);
  });

  it('delete of an attempted coverage create keeps the create and adds a DELETE', async () => {
    await enqueueCoverageCreate(cov);
    const [e] = await listQueue();
    await updateEntry(e?.seq ?? 0, { attempts: 1 });
    await enqueueCoverageDelete(COV);
    expect((await listQueue()).map((x) => x.method)).toEqual(['POST', 'DELETE']);
  });
});

describe('AC-62: claim depends on coverage', () => {
  it('sends the coverage create before a claim create queued earlier, exactly once each', async () => {
    await enqueueClaimCreate(claim);
    await enqueueCoverageCreate(cov);
    online();
    await flush(true);
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(1);
    expect(fake.claimPosts).toHaveLength(1);
    expect(fake.claims.get(CLM)?.coverage_id).toBe(COV);
    expect(await listQueue()).toHaveLength(0);
  });

  it('a failed coverage create (400) leaves its claim blocked and unsent', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    online();
    await flush(true);
    expect(fake.claimPosts).toHaveLength(0);
    const q = await listQueue();
    expect(q.map((e) => e.status)).toEqual(['failed', 'pending']);
    expect(await countQueue()).toEqual({ pending: 0, failed: 1, blocked: 1 });
    await flush(true);
    expect(fake.claimPosts).toHaveLength(0);
  });

  it('a 409 on the coverage blocks its claim the same way', async () => {
    fake.coveragePostFailures = [409];
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    online();
    await flush(true);
    expect(fake.claimPosts).toHaveLength(0);
    expect((await countQueue()).blocked).toBe(1);
  });

  it('a blocked claim does not wedge unrelated queue items', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    await enqueueCoverageCreate({ ...cov, id: COV2, name: 'Other' });
    await enqueueClaimCreate({ ...claim, id: CLM2, coverage_id: COV2 });
    online();
    await flush(true);
    expect(fake.coverages.has(COV2)).toBe(true);
    expect(fake.claims.has(CLM2)).toBe(true);
    expect(fake.claims.has(CLM)).toBe(false);
  });

  it('retrying the coverage unblocks the claim, which is then sent once', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    online();
    await flush(true);
    await retryFailed(COV);
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(2);
    expect(fake.claimPosts).toHaveLength(1);
    expect(fake.claims.has(CLM)).toBe(true);
    expect(await listQueue()).toHaveLength(0);
    await flush(true);
    expect(fake.claimPosts).toHaveLength(1);
  });

  it('discarding the failed coverage drops its blocked claims too', async () => {
    fake.coveragePostFailures = [400];
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    online();
    await flush(true);
    const res = await discardFailedCoverage(COV);
    expect(res.droppedClaimCreates).toBe(1);
    expect(await listQueue()).toHaveLength(0);
  });

  it('deleting an unsent coverage then flushing sends nothing', async () => {
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    await enqueueCoverageDelete(COV);
    online();
    await flush(true);
    expect(fake.coveragePosts).toHaveLength(0);
    expect(fake.claimPosts).toHaveLength(0);
  });

  it('a server error (500) on the coverage holds the claim and retries both later, once', async () => {
    fake.coveragePostFailures = [500];
    await enqueueCoverageCreate(cov);
    await enqueueClaimCreate(claim);
    online();
    await flush(true);
    expect(fake.claimPosts).toHaveLength(0);
    await flush(true);
    expect(fake.coverages.size).toBe(1);
    expect(fake.claims.size).toBe(1);
    expect(fake.claimPosts).toHaveLength(1);
  });

  it('template items are independent: one failure does not block the others', async () => {
    fake.coveragePostFailures = [400, 0, 0];
    for (const [i, id] of [COV, COV2, '55555555-5555-4555-8555-888888888888'].entries())
      await enqueueCoverageCreate({ ...cov, id, name: `Item ${i}` });
    online();
    await flush(true);
    expect(fake.coverages.size).toBe(2);
    expect((await countQueue()).failed).toBe(1);
  });

  it('a replayed DELETE answered 404 counts as success', async () => {
    await enqueueCoverageDelete(COV);
    await enqueueClaimDelete(CLM);
    online();
    await flush(true);
    expect(fake.coverageDeletes).toEqual([COV]);
    expect(await listQueue()).toHaveLength(0);
  });
});
