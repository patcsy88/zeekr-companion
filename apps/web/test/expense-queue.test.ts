import { describe, expect, it } from 'vitest';
import {
  enqueueExpenseCreate,
  enqueueExpenseDelete,
  enqueueExpenseEdit,
  listQueue,
  updateEntry,
} from '../src/storage/queue';

const ID = '33333333-3333-4333-8333-333333333333';
const body = {
  id: ID,
  date: '2026-10-01',
  category: 'charging' as const,
  amount_minor: 1250,
  currency: 'MYR' as const,
  notes: null,
};

describe('expense queue (AC-40)', () => {
  it('uses the expense id as entry id and record id', async () => {
    await enqueueExpenseCreate(body);
    const [e] = await listQueue();
    expect(e).toMatchObject({
      id: ID,
      record_id: ID,
      kind: 'create-expense',
      method: 'POST',
      path: '/expenses',
    });
  });

  it('saving the same unsent create again replaces its body instead of adding an entry', async () => {
    await enqueueExpenseCreate(body);
    await enqueueExpenseCreate({ ...body, amount_minor: 99 });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]?.body).toMatchObject({ amount_minor: 99 });
  });

  it('create then edit offline is coalesced into one POST with the final content', async () => {
    await enqueueExpenseCreate(body);
    await enqueueExpenseEdit(ID, { amount_minor: 5000, notes: 'edited' });
    await enqueueExpenseEdit(ID, { category: 'parking' });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ method: 'POST', kind: 'create-expense' });
    expect(q[0]?.body).toMatchObject({
      id: ID,
      date: '2026-10-01',
      category: 'parking',
      amount_minor: 5000,
      notes: 'edited',
    });
  });

  it('successive edits of a synced expense merge into one PATCH', async () => {
    await enqueueExpenseEdit(ID, { amount_minor: 100 });
    await enqueueExpenseEdit(ID, { notes: null });
    const q = await listQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      kind: 'edit-expense',
      method: 'PATCH',
      path: `/expenses/${ID}`,
      body: { amount_minor: 100, notes: null },
    });
  });

  it('delete after an unsent create cancels both', async () => {
    await enqueueExpenseCreate(body);
    await enqueueExpenseEdit(ID, { amount_minor: 7 });
    await enqueueExpenseDelete(ID);
    expect(await listQueue()).toHaveLength(0);
  });

  it('delete after an attempted create keeps the create and adds a DELETE', async () => {
    await enqueueExpenseCreate(body);
    const [e] = await listQueue();
    await updateEntry(e?.seq ?? 0, { attempts: 1 });
    await enqueueExpenseDelete(ID);
    expect((await listQueue()).map((x) => x.method)).toEqual(['POST', 'DELETE']);
  });

  it('delete of a synced expense drops its pending edit and queues one DELETE', async () => {
    await enqueueExpenseEdit(ID, { amount_minor: 1 });
    await enqueueExpenseDelete(ID);
    await enqueueExpenseDelete(ID);
    const q = await listQueue();
    expect(q.map((x) => x.method)).toEqual(['DELETE']);
    expect(q[0]).toMatchObject({ kind: 'delete-expense', path: `/expenses/${ID}` });
  });

  it('entries of different expenses do not interfere', async () => {
    const other = '44444444-4444-4444-8444-444444444444';
    await enqueueExpenseCreate(body);
    await enqueueExpenseCreate({ ...body, id: other });
    await enqueueExpenseDelete(other);
    const q = await listQueue();
    expect(q.map((x) => x.record_id)).toEqual([ID]);
  });
});
