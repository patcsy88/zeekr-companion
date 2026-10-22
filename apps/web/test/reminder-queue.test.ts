import { describe, expect, it } from 'vitest';
import {
  enqueueReminderCreate,
  enqueueReminderDelete,
  enqueueReminderEdit,
  listQueue,
  updateEntry,
} from '../src/storage/queue';

const ID = '22222222-2222-4222-8222-222222222222';
const body = {
  id: ID,
  kind: 'service' as const,
  title: 'Service 1',
  due_date: '2027-01-01',
  due_odometer: 20000,
  notes: null,
  template_ref: null,
};

describe('reminder queue (AC-25)', () => {
  it('uses the reminder id as entry id and record id', async () => {
    await enqueueReminderCreate(body);
    const [e] = await listQueue();
    expect(e).toMatchObject({ id: ID, record_id: ID, method: 'POST', path: '/reminders' });
  });

  it('create then edit offline is coalesced into one POST with the final content', async () => {
    await enqueueReminderCreate(body);
    await enqueueReminderEdit(ID, { title: 'Edited', due_odometer: null });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.method).toBe('POST');
    expect(q[0]?.body).toMatchObject({
      id: ID,
      title: 'Edited',
      due_odometer: null,
      due_date: '2027-01-01',
    });
  });

  it('completing an unsent create travels as its own PATCH after the POST', async () => {
    await enqueueReminderCreate(body);
    await enqueueReminderEdit(ID, { completed_on: '2026-10-22' });
    const q = await listQueue();
    expect(q.map((e) => e.method)).toEqual(['POST', 'PATCH']);
  });

  it('successive edits of a synced reminder merge into one PATCH (complete then reopen)', async () => {
    await enqueueReminderEdit(ID, { completed_on: '2026-10-22' });
    await enqueueReminderEdit(ID, { completed_on: null });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ method: 'PATCH', body: { completed_on: null } });
  });

  it('delete after an unsent create cancels both', async () => {
    await enqueueReminderCreate(body);
    await enqueueReminderEdit(ID, { completed_on: '2026-10-22' });
    await enqueueReminderDelete(ID);
    expect(await listQueue()).toHaveLength(0);
  });

  it('delete after an attempted create keeps the create and adds a DELETE', async () => {
    await enqueueReminderCreate(body);
    const [e] = await listQueue();
    await updateEntry(e?.seq ?? 0, { attempts: 1 });
    await enqueueReminderDelete(ID);
    expect((await listQueue()).map((x) => x.method)).toEqual(['POST', 'DELETE']);
  });

  it('delete of a synced reminder drops its pending edits and queues one DELETE', async () => {
    await enqueueReminderEdit(ID, { title: 'x' });
    await enqueueReminderDelete(ID);
    await enqueueReminderDelete(ID);
    expect((await listQueue()).map((x) => x.method)).toEqual(['DELETE']);
  });
});
