import type {
  ClaimEdit,
  CoverageEdit,
  WarrantyClaimCreate,
  WarrantyCoverageCreate,
  ExpenseCreate,
  ExpenseEdit,
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

/**
 * A create the server certainly never stored: not yet attempted, or refused with a 4xx other than
 * 409 (a 409 means the server holds a row with this id). Deleting such an item just cancels it.
 */
function neverStored(create: QueueEntry): boolean {
  if (create.status === 'sending') return false;
  if (create.attempts === 0) return true;
  return create.status === 'failed' && create.last_error?.status !== 409;
}

/**
 * Whether an edit may be folded into this create. Not after a lost response (status pending,
 * attempts above 0): the server may hold the original content, and a replay with different content
 * is a 409. A failed create is folded, because that is how the owner fixes a rejected item.
 */
function canFoldEdit(create: QueueEntry): boolean {
  return create.status !== 'sending' && (create.attempts === 0 || create.status === 'failed');
}

/**
 * Like reset, but for a create: keeps `attempts`. A create that was sent once may have reached the
 * server (lost response), so a later delete must still send a DELETE rather than cancel it.
 */
function resetCreate(entry: QueueEntry, body: unknown): QueueEntry {
  return { ...reset(entry, body), attempts: entry.attempts };
}

export async function listQueue(): Promise<QueueEntry[]> {
  const rows = await (await getDb()).getAll('queue');
  return rows.sort((a, b) => a.seq - b.seq);
}

const CLAIM_KINDS: QueueEntry['kind'][] = ['create-claim', 'edit-claim', 'delete-claim'];

/**
 * Claim creates that wait for a coverage whose create failed (400/409): claim id -> coverage id.
 * Such claims are shown as blocked and are never sent. Retrying the coverage unblocks them.
 */
export function blockedClaimIds(rows: QueueEntry[]): Map<string, string> {
  const failedCoverages = new Set(
    rows
      .filter((r) => r.kind === 'create-coverage' && r.status === 'failed')
      .map((r) => r.record_id),
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.kind !== 'create-claim') continue;
    const coverageId = (r.body as WarrantyClaimCreate).coverage_id;
    if (failedCoverages.has(coverageId)) out.set(r.record_id, coverageId);
  }
  return out;
}

/** True for any queued claim write whose claim create is blocked by a failed coverage create. */
export function isBlockedEntry(e: QueueEntry, blocked: Map<string, string>): boolean {
  return CLAIM_KINDS.includes(e.kind) && e.status !== 'failed' && blocked.has(e.record_id);
}

export async function countQueue(): Promise<{ pending: number; failed: number; blocked: number }> {
  const rows = await listQueue();
  const blocked = blockedClaimIds(rows);
  const isBlocked = (r: QueueEntry) => isBlockedEntry(r, blocked);
  return {
    pending: rows.filter((r) => r.status !== 'failed' && !isBlocked(r)).length,
    failed: rows.filter((r) => r.status === 'failed').length,
    blocked: rows.filter(isBlocked).length,
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
  if (existing) await tx.store.put(resetCreate(existing, body));
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
    await tx.store.put(resetCreate(create, { ...(create.body as ServiceRecordCreate), ...patch }));
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
  if (existing) await tx.store.put(resetCreate(existing, body));
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
    await tx.store.put(resetCreate(create, { ...(create.body as ReminderCreate), ...patch }));
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

/** Queue an expense creation. As for records, the expense id is the entry id (idempotent POST). */
export async function enqueueExpenseCreate(body: ExpenseCreate): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const existing = (await tx.store.index('by_record').getAll(body.id)).find(
    (e) => e.kind === 'create-expense' && e.status !== 'sending',
  );
  if (existing) await tx.store.put(resetCreate(existing, body));
  else
    await tx.store.add(
      base('create-expense', 'POST', '/expenses', body, body.id, body.id) as QueueEntry,
    );
  await tx.done;
  notifyData();
}

/** Same coalescing as service records: an edit of an unsent create is folded into that create. */
export async function enqueueExpenseEdit(id: string, patch: ExpenseEdit): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = (await tx.store.index('by_record').getAll(id)).sort((a, b) => a.seq - b.seq);
  const create = entries.find((e) => e.kind === 'create-expense' && e.status !== 'sending');
  const lastEdit = [...entries].reverse().find((e) => e.kind === 'edit-expense');
  if (create) {
    await tx.store.put(resetCreate(create, { ...(create.body as ExpenseCreate), ...patch }));
  } else if (lastEdit && lastEdit.status !== 'sending') {
    await tx.store.put(reset(lastEdit, { ...(lastEdit.body as ExpenseEdit), ...patch }));
  } else {
    await tx.store.add(
      base('edit-expense', 'PATCH', `/expenses/${encodeURIComponent(id)}`, patch, id) as QueueEntry,
    );
  }
  await tx.done;
  notifyData();
}

/** Same rule as enqueueDelete: an unattempted create is cancelled together with its edits. */
export async function enqueueExpenseDelete(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = await tx.store.index('by_record').getAll(id);
  const create = entries.find((e) => e.kind === 'create-expense');
  if (create && create.attempts === 0 && create.status !== 'sending') {
    for (const e of entries) await tx.store.delete(e.seq);
  } else {
    for (const e of entries) {
      if (e.kind === 'edit-expense' && e.status !== 'sending') await tx.store.delete(e.seq);
    }
    if (!entries.some((e) => e.kind === 'delete-expense')) {
      await tx.store.add(
        base(
          'delete-expense',
          'DELETE',
          `/expenses/${encodeURIComponent(id)}`,
          undefined,
          id,
        ) as QueueEntry,
      );
    }
  }
  await tx.done;
  notifyData();
}

/** Warranty coverage creation. The coverage id is the entry id (idempotent POST). */
export async function enqueueCoverageCreate(body: WarrantyCoverageCreate): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const existing = (await tx.store.index('by_record').getAll(body.id)).find(
    (e) => e.kind === 'create-coverage' && e.status !== 'sending',
  );
  if (existing) await tx.store.put(resetCreate(existing, body));
  else
    await tx.store.add(
      base('create-coverage', 'POST', '/warranty-coverages', body, body.id, body.id) as QueueEntry,
    );
  await tx.done;
  notifyData();
}

export async function enqueueCoverageEdit(id: string, patch: CoverageEdit): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = (await tx.store.index('by_record').getAll(id)).sort((a, b) => a.seq - b.seq);
  const create = entries.find((e) => e.kind === 'create-coverage' && canFoldEdit(e));
  const lastEdit = [...entries].reverse().find((e) => e.kind === 'edit-coverage');
  if (create) {
    await tx.store.put(
      resetCreate(create, { ...(create.body as WarrantyCoverageCreate), ...patch }),
    );
  } else if (lastEdit && lastEdit.status !== 'sending') {
    await tx.store.put(reset(lastEdit, { ...(lastEdit.body as CoverageEdit), ...patch }));
  } else {
    await tx.store.add(
      base(
        'edit-coverage',
        'PATCH',
        `/warranty-coverages/${encodeURIComponent(id)}`,
        patch,
        id,
      ) as QueueEntry,
    );
  }
  await tx.done;
  notifyData();
}

/**
 * Delete a coverage. An unattempted create is cancelled together with its edits and every queued
 * claim write for it (the server never saw any of them). Otherwise the create stays if it was
 * attempted, a DELETE is added, and pending claim writes for this coverage are dropped locally:
 * the server deletes the claims with the coverage (cascade), and a claim POST sent after the
 * DELETE could only fail. `knownClaimIds` are claims already on the server, whose queued edits
 * and deletes are dropped too. Returns how many unsent claim creates were dropped, for the notice.
 */
export async function enqueueCoverageDelete(
  id: string,
  knownClaimIds: string[] = [],
): Promise<{ droppedClaimCreates: number }> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const all = await tx.store.getAll();
  const claimCreates = all.filter(
    (e) => e.kind === 'create-claim' && (e.body as WarrantyClaimCreate).coverage_id === id,
  );
  const claimIds = new Set([...knownClaimIds, ...claimCreates.map((e) => e.record_id)]);
  for (const e of all) {
    if (CLAIM_KINDS.includes(e.kind) && claimIds.has(e.record_id)) await tx.store.delete(e.seq);
  }
  const entries = await tx.store.index('by_record').getAll(id);
  const create = entries.find((e) => e.kind === 'create-coverage');
  if (create && neverStored(create)) {
    for (const e of entries) await tx.store.delete(e.seq);
  } else {
    for (const e of entries) {
      if (e.kind === 'edit-coverage' && e.status !== 'sending') await tx.store.delete(e.seq);
    }
    // A failed create would block the DELETE queued behind it (same record id); the DELETE removes
    // whatever the server holds.
    if (create && create.status === 'failed') await tx.store.delete(create.seq);
    if (!entries.some((e) => e.kind === 'delete-coverage')) {
      await tx.store.add(
        base(
          'delete-coverage',
          'DELETE',
          `/warranty-coverages/${encodeURIComponent(id)}`,
          undefined,
          id,
        ) as QueueEntry,
      );
    }
  }
  await tx.done;
  notifyData();
  return { droppedClaimCreates: claimCreates.length };
}

/** Warranty claim creation. Sent after its coverage create (see sync/engine.ts). */
export async function enqueueClaimCreate(body: WarrantyClaimCreate): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const existing = (await tx.store.index('by_record').getAll(body.id)).find(
    (e) => e.kind === 'create-claim' && e.status !== 'sending',
  );
  if (existing) await tx.store.put(resetCreate(existing, body));
  else
    await tx.store.add(
      base('create-claim', 'POST', '/warranty-claims', body, body.id, body.id) as QueueEntry,
    );
  await tx.done;
  notifyData();
}

export async function enqueueClaimEdit(id: string, patch: ClaimEdit): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = (await tx.store.index('by_record').getAll(id)).sort((a, b) => a.seq - b.seq);
  const create = entries.find((e) => e.kind === 'create-claim' && canFoldEdit(e));
  const lastEdit = [...entries].reverse().find((e) => e.kind === 'edit-claim');
  if (create) {
    await tx.store.put(resetCreate(create, { ...(create.body as WarrantyClaimCreate), ...patch }));
  } else if (lastEdit && lastEdit.status !== 'sending') {
    await tx.store.put(reset(lastEdit, { ...(lastEdit.body as ClaimEdit), ...patch }));
  } else {
    await tx.store.add(
      base(
        'edit-claim',
        'PATCH',
        `/warranty-claims/${encodeURIComponent(id)}`,
        patch,
        id,
      ) as QueueEntry,
    );
  }
  await tx.done;
  notifyData();
}

export async function enqueueClaimDelete(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const entries = await tx.store.index('by_record').getAll(id);
  const create = entries.find((e) => e.kind === 'create-claim');
  if (create && neverStored(create)) {
    for (const e of entries) await tx.store.delete(e.seq);
  } else {
    for (const e of entries) {
      if (e.kind === 'edit-claim' && e.status !== 'sending') await tx.store.delete(e.seq);
    }
    if (create && create.status === 'failed') await tx.store.delete(create.seq);
    if (!entries.some((e) => e.kind === 'delete-claim')) {
      await tx.store.add(
        base(
          'delete-claim',
          'DELETE',
          `/warranty-claims/${encodeURIComponent(id)}`,
          undefined,
          id,
        ) as QueueEntry,
      );
    }
  }
  await tx.done;
  notifyData();
}

/**
 * Discard a failed coverage create (or other failed coverage entries) and every queued claim
 * write for that coverage: those claims have nothing to attach to once the coverage is gone.
 */
export async function discardFailedCoverage(id: string): Promise<{ droppedClaimCreates: number }> {
  const db = await getDb();
  const tx = db.transaction('queue', 'readwrite');
  const all = await tx.store.getAll();
  const claimCreates = all.filter(
    (e) => e.kind === 'create-claim' && (e.body as WarrantyClaimCreate).coverage_id === id,
  );
  const failedHere = all.filter((e) => e.record_id === id && e.status === 'failed');
  const dropsCoverage = failedHere.some((e) => e.kind === 'create-coverage');
  for (const e of failedHere) await tx.store.delete(e.seq);
  if (dropsCoverage) {
    const ids = new Set(claimCreates.map((e) => e.record_id));
    for (const e of all) {
      if (CLAIM_KINDS.includes(e.kind) && ids.has(e.record_id)) await tx.store.delete(e.seq);
    }
  }
  await tx.done;
  notifyData();
  return { droppedClaimCreates: dropsCoverage ? claimCreates.length : 0 };
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
