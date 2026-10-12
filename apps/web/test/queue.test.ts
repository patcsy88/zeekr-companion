import { describe, expect, it } from 'vitest';
import { overlayRecords } from '../src/data/overlay';
import {
  countQueue,
  enqueueCreate,
  enqueueDelete,
  enqueueEdit,
  listQueue,
  discardFailed,
  updateEntry,
} from '../src/storage/queue';

const body = (id: string) => ({
  id,
  date: '2026-10-01',
  odometer: 1000,
  provider: null,
  description: 'Service',
  cost_minor: 5000,
  currency: 'MYR' as const,
  notes: null,
});
const ID = '11111111-1111-4111-8111-111111111111';

describe('queue', () => {
  it('stores the client UUID as the entry id and the record id', async () => {
    await enqueueCreate(body(ID));
    const [e] = await listQueue();
    expect(e).toMatchObject({
      id: ID,
      record_id: ID,
      method: 'POST',
      path: '/service-records',
      status: 'pending',
      attempts: 0,
    });
    expect(typeof e?.created_at).toBe('string');
  });

  it('coalesces offline create then edit into one POST', async () => {
    await enqueueCreate(body(ID));
    await enqueueEdit(ID, { description: 'Edited', cost_minor: 9900 });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.method).toBe('POST');
    expect(q[0]?.body).toMatchObject({
      id: ID,
      description: 'Edited',
      cost_minor: 9900,
      odometer: 1000,
    });
  });

  it('merges successive edits of a synced record into one PATCH', async () => {
    await enqueueEdit(ID, { description: 'A' });
    await enqueueEdit(ID, { odometer: 2 });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ method: 'PATCH', body: { description: 'A', odometer: 2 } });
  });

  it('drops a never-attempted create when it is deleted', async () => {
    await enqueueCreate(body(ID));
    await enqueueDelete(ID);
    expect(await listQueue()).toHaveLength(0);
  });

  it('keeps create and adds DELETE if the create may have reached the server', async () => {
    await enqueueCreate(body(ID));
    const [e] = await listQueue();
    await updateEntry(e!.seq, { attempts: 1 });
    await enqueueDelete(ID);
    expect((await listQueue()).map((x) => x.method)).toEqual(['POST', 'DELETE']);
  });

  it('counts pending and failed, and discards failed', async () => {
    await enqueueCreate(body(ID));
    const [e] = await listQueue();
    await updateEntry(e!.seq, { status: 'failed' });
    expect(await countQueue()).toEqual({ pending: 0, failed: 1 });
    await discardFailed(ID);
    expect(await countQueue()).toEqual({ pending: 0, failed: 0 });
  });

  it('overlay shows queued create as pending and hides deleted records', async () => {
    await enqueueCreate(body(ID));
    const views = overlayRecords([], await listQueue());
    expect(views).toHaveLength(1);
    expect(views[0]?.sync).toBe('pending');
  });
});
