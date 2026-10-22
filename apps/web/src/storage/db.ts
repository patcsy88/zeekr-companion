import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FieldIssue } from '../api/types';

export type QueueStatus = 'pending' | 'sending' | 'failed';
export type QueueKind =
  | 'create-record'
  | 'edit-record'
  | 'delete-record'
  | 'put-vehicle'
  | 'create-reminder'
  | 'edit-reminder'
  | 'delete-reminder'
  | 'create-expense'
  | 'edit-expense'
  | 'delete-expense';

export interface QueueError {
  /** HTTP status, or null for a network failure. */
  status: number | null;
  code: string;
  message: string;
  details: FieldIssue[];
}

/** Queue entry (ADR-002), plus `seq` for FIFO order, `kind`/`record_id` for coalescing and backoff. */
export interface QueueEntry {
  /** Autoincrement key: FIFO order. */
  seq: number;
  /** Client UUID. For creates this is also the record id, which makes the POST idempotent. */
  id: string;
  kind: QueueKind;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  /** The record (or vehicle) this entry changes. */
  record_id: string;
  created_at: string;
  attempts: number;
  status: QueueStatus;
  last_error: QueueError | null;
  /** Epoch ms before which an automatic retry must not run (0 = now). */
  next_attempt_at: number;
}

export interface CacheRow {
  key: string;
  value: unknown;
  fetched_at: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

interface ZeekrDB extends DBSchema {
  cache: { key: string; value: CacheRow };
  queue: { key: number; value: QueueEntry; indexes: { by_record: string } };
  meta: { key: string; value: MetaRow };
}

export type Db = IDBPDatabase<ZeekrDB>;

const DB_NAME = 'zeekr-companion';
let dbPromise: Promise<Db> | null = null;

/** Holds no token and no password: only API data and pending writes. */
export function getDb(): Promise<Db> {
  dbPromise ??= openDB<ZeekrDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('cache', { keyPath: 'key' });
      const queue = db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
      queue.createIndex('by_record', 'record_id');
      db.createObjectStore('meta', { keyPath: 'key' });
    },
    blocking() {
      // Another tab wants to upgrade: let go of the connection.
      void dbPromise?.then((d) => {
        d.close();
      });
      dbPromise = null;
    },
  });
  return dbPromise;
}

export async function closeDbForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
}

/** Removes cache, queue and meta. Used only by "Sign out and clear local data" after confirmation. */
export async function clearAllLocalData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['cache', 'queue', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('cache').clear(),
    tx.objectStore('queue').clear(),
    tx.objectStore('meta').clear(),
  ]);
  await tx.done;
}
