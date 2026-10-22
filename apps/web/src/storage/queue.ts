import type {
  ReminderCreate,
  ReminderEdit,
  ServiceRecordCreate,
  ServiceRecordPatch,
  Vehicle,
} from '../api/types';
import { notifyData } from '../lib/events';
import { uuid } from '../lib/uuid';
import { getDb, type QueueEntry, type QueueError } from './db';

type NewEntry = Omit<QueueEntry, 'seq'>;

function base(
  kind: QueueEntry['kind'],
  method: QueueEntry['method'],
  path: string,
  body: unknown,
  recordId: string,
  id: string = uuid(),
): NewEntry {
  return {
    id,
    kind,
    method,
    path,
    body,
    record_id: recordId,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    last_error: null,
    next_attempt_at: 0,
  };
}

function reset(entry: QueueEntry, body: unknown): QueueEntry {
  return { ...entry, body, status: 'pending', attempts: 0, last_error: null, next_attempt_at: 0 };
}

export async function listQueue(): Promise<QueueEntry[]> {
  const rows = await (await getDb()).getAll('queue');
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function countQueue(): Promise<{ pending: number; failed: number }> {
  const rows = await listQueue();
  return {
    pending: rows.filter((r) => r.status !== 'failed').length,
    failed: rows.filter((r) => r.status === 'failed').length,
  };
}

/**
 * Queue a record creation. The record id is the entry id, so a replay of the POST can never
 * create a second record. Re-saving a create that has not been sent replaces its body.
 */
export async function enqueueCreate(body: ServiceRecordCreate): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const existing = (await tx.store.index('by_record').getAll(body.id)).find(
    (e) => e.kind === 'create-record' && e.status !== 'sending',
  );
  if (existing) await tx.store.put(reset(existing, body));
  else
    await tx.store.add(
      base('create-record', 'POST', '/service-records', body, body.id, body.id) as QueueEntry,
    );
  await tx.done;
  notifyData();
}

/**
 * Queue an edit. An edit of a record whose create has not been sent is coalesced into that
 * create, so one POST carries the final content. Edits of an unsent edit are merged too.
 */
export async function enqueueEdit(recordId: string, patch: ServiceRecordPatch): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = (await tx.store.index('by_record').getAll(recordId)).sort(
    (a, b) => a.seq - b.seq,
  );
  const create = entries.find((e) => e.kind === 'create-record' && e.status !== 'sending');
  const lastEdit = [...entries].reverse().find((e) => e.kind === 'edit-record');
  if (create) {
    await tx.store.put(reset(create, { ...(create.body as ServiceRecordCreate), ...patch }));
  } else if (lastEdit && lastEdit.status !== 'sending') {
    await tx.store.put(reset(lastEdit, { ...(lastEdit.body as ServiceRecordPatch), ...patch }));
  } else {
    await tx.store.add(
      base(
        'edit-record',
        'PATCH',
        `/service-records/${encodeURIComponent(recordId)}`,
        patch,
        recordId,
      ) as QueueEntry,
    );
  }
  await tx.done;
  notifyData();
}

/**
 * Queue a delete. If the create was never attempted, the server has never seen the record, so
 * both are dropped. If the create was attempted (response may have been lost), keep it and add
 * the DELETE, otherwise a record could be left behind on the server.
 */
export async function enqueueDelete(recordId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = await tx.store.index('by_record').getAll(recordId);
  const create = entries.find((e) => e.kind === 'create-record');
  if (create && create.attempts === 0 && create.status !== 'sending') {
    for (const e of entries) await tx.store.delete(e.seq);
  } else {
    for (const e of entries) {
      if (e.kind === 'edit-record' && e.status !== 'sending') await tx.store.delete(e.seq);
    }
    if (!entries.some((e) => e.kind === 'delete-record')) {
      await tx.store.add(
        base(
          'delete-record',
          'DELETE',
          `/service-records/${encodeURIComponent(recordId)}`,
          undefined,
          recordId,
        ) as QueueEntry,
      );
    }
  }
  await tx.done;
  notifyData();
}

/** Queue a vehicle PUT. A newer unsent PUT replaces an older one (PUT replaces anyway). */
export async function enqueuePutVehicle(vehicle: Vehicle): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = await tx.store.index('by_record').getAll(vehicle.id);
  for (const e of entries) {
    if (e.kind === 'put-vehicle' && e.status !== 'sending') await tx.store.delete(e.seq);
  }
  await tx.store.add(base('put-vehicle', 'PUT', '/vehicle', vehicle, vehicle.id) as QueueEntry);
  await tx.done;
  notifyData();
}

/** Queue a reminder creation. As for records, the reminder id is the entry id (idempotent POST). */
export async function enqueueReminderCreate(body: ReminderCreate): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const existing = (await tx.store.index('by_record').getAll(body.id)).find(
    (e) => e.kind === 'create-reminder' && e.status !== 'sending',
  );
  if (existing) await tx.store.put(reset(existing, body));
  else
    await tx.store.add(
      base('create-reminder', 'POST', '/reminders', body, body.id, body.id) as QueueEntry,
    );
  await tx.done;
  notifyData();
}

/**
 * Queue a reminder edit (including complete and reopen). Merged into the last unsent edit if
 * there is one; otherwise folded into an unsent create so one POST carries the final content.
 * The create body cannot carry `completed_on`, so a completion always travels as its own PATCH,
 * which FIFO order sends after the create.
 */
export async function enqueueReminderEdit(id: string, patch: ReminderEdit): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = (await tx.store.index('by_record').getAll(id)).sort((a, b) => a.seq - b.seq);
  const create = entries.find((e) => e.kind === 'create-reminder' && e.status !== 'sending');
  const lastEdit = [...entries].reverse().find((e) => e.kind === 'edit-reminder');
  if (lastEdit && lastEdit.status !== 'sending') {
    await tx.store.put(reset(lastEdit, { ...(lastEdit.body as ReminderEdit), ...patch }));
  } else if (create && !('completed_on' in patch)) {
    await tx.store.put(reset(create, { ...(create.body as ReminderCreate), ...patch }));
  } else {
    await tx.store.add(
      base(
        'edit-reminder',
        'PATCH',
        `/reminders/${encodeURIComponent(id)}`,
        patch,
        id,
      ) as QueueEntry,
    );
  }
  await tx.done;
  notifyData();
}

/** Same rule as enqueueDelete: an unattempted create is cancelled together with its edits. */
export async function enqueueReminderDelete(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = await tx.store.index('by_record').getAll(id);
  const create = entries.find((e) => e.kind === 'create-reminder');
  if (create && create.attempts === 0 && create.status !== 'sending') {
    for (const e of entries) await tx.store.delete(e.seq);
  } else {
    for (const e of entries) {
      if (e.kind === 'edit-reminder' && e.status !== 'sending') await tx.store.delete(e.seq);
    }
    if (!entries.some((e) => e.kind === 'delete-reminder')) {
      await tx.store.add(
        base(
          'delete-reminder',
          'DELETE',
          `/reminders/${encodeURIComponent(id)}`,
          undefined,
          id,
        ) as QueueEntry,
      );
    }
  }
  await tx.done;
  notifyData();
}

export async function updateEntry(seq: number, changes: Partial<QueueEntry>): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const row = await tx.store.get(seq);
  if (row) await tx.store.put({ ...row, ...changes, seq });
  await tx.done;
  notifyData();
}

export async function removeEntry(seq: number): Promise<void> {
  await (await getDb()).delete('queue', seq);
  notifyData();
}

/** Entries left 'sending' by a page that died mid-request. Safe to resend: the API is idempotent. */
export async function resetSending(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  for (const e of await tx.store.getAll()) {
    if (e.status === 'sending') await tx.store.put({ ...e, status: 'pending' });
  }
  await tx.done;
}

/** Put failed entries for a record back in the queue unchanged. */
export async function retryFailed(recordId?: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  for (const e of await tx.store.getAll()) {
    if (e.status === 'failed' && (recordId === undefined || e.record_id === recordId)) {
      await tx.store.put({
        ...e,
        status: 'pending',
        attempts: 0,
        last_error: null,
        next_attempt_at: 0,
      });
    }
  }
  await tx.done;
  notifyData();
}

/** Drop failed entries for a record: the record goes back to what the server has. */
export async function discardFailed(recordId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  for (const e of await tx.store.index('by_record').getAll(recordId)) {
    if (e.status === 'failed') await tx.store.delete(e.seq);
  }
  await tx.done;
  notifyData();
}

export type { QueueEntry, QueueError };
