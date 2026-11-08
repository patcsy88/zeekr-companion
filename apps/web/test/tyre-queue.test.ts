import { describe, expect, it } from 'vitest';
import { assertContractPath } from '../src/api/client';
import {
  enqueueTyreEventCreate,
  enqueueTyreEventDelete,
  enqueueTyreEventEdit,
  listQueue,
  updateEntry,
} from '../src/storage/queue';

const ID = '44444444-4444-4444-8444-444444444444';
const body = {
  id: ID,
  date: '2026-10-01',
  kind: 'replace' as const,
  wheels: ['driver_front' as const],
  odometer: 12000,
  currency: 'MYR' as const,
};

describe('tyre event queue (AC-81)', () => {
  it('uses the event id as entry id and record id', async () => {
    await enqueueTyreEventCreate(body);
    const [e] = await listQueue();
    expect(e).toMatchObject({
      id: ID,
      record_id: ID,
      kind: 'create-tyre-event',
      method: 'POST',
      path: '/tyre-events',
    });
  });

  it('create then edit offline is coalesced into one POST with the final content', async () => {
    await enqueueTyreEventCreate(body);
    await enqueueTyreEventEdit(ID, { odometer: 13000, notes: 'edited' });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.body).toMatchObject({ id: ID, odometer: 13000, notes: 'edited', kind: 'replace' });
  });

  it('successive edits of a synced event merge into one PATCH', async () => {
    await enqueueTyreEventEdit(ID, { odometer: 1 });
    await enqueueTyreEventEdit(ID, { notes: null });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ method: 'PATCH', path: `/tyre-events/${ID}` });
    expect(q[0]?.body).toEqual({ odometer: 1, notes: null });
  });

  it('deleting an unattempted create cancels it and its edits; nothing is sent', async () => {
    await enqueueTyreEventCreate(body);
    await enqueueTyreEventEdit(ID, { notes: 'x' });
    await enqueueTyreEventDelete(ID);
    expect(await listQueue()).toHaveLength(0);
  });

  it('deleting after an attempted create keeps the create and queues one DELETE', async () => {
    await enqueueTyreEventCreate(body);
    const [c] = await listQueue();
    await updateEntry(c!.seq, { attempts: 1, status: 'pending' });
    await enqueueTyreEventDelete(ID);
    await enqueueTyreEventDelete(ID);
    const q = await listQueue();
    expect(q.map((e) => e.kind)).toEqual(['create-tyre-event', 'delete-tyre-event']);
  });

  it('the client allows only the contract paths for tyre events', () => {
    expect(() => {
      assertContractPath('/tyre-events');
    }).not.toThrow();
    expect(() => {
      assertContractPath('/tyre-events?limit=100&cursor=abc');
    }).not.toThrow();
    expect(() => {
      assertContractPath(`/tyre-events/${ID}`);
    }).not.toThrow();
    for (const bad of [
      '/tyre-events/not-a-uuid',
      `/tyre-events/${ID}?x=1`,
      `/tyre-events/${ID}/extra`,
      '/tyre-events/summary',
    ]) {
      expect(() => {
        assertContractPath(bad);
      }).toThrow();
    }
  });
});
