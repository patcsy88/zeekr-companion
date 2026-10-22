import { ApiError, NetworkError, request } from '../api/client';
import { getVehicle } from '../api/endpoints';
import type { Expense, Reminder, ServiceRecord, Vehicle } from '../api/types';
import { getSession, requestLogin, subscribeSession } from '../auth/session';
import {
  refreshRecords,
  refreshVehicle,
  removeRecordFromCache,
  setVehicleInCache,
  upsertRecordInCache,
} from '../data/repository';
import { refreshExpenses, removeExpenseFromCache, upsertExpenseInCache } from '../data/expenses';
import {
  refreshReminders,
  refreshTemplates,
  removeReminderFromCache,
  upsertReminderInCache,
} from '../data/reminders';
import { isOnline } from '../lib/connectivity';
import { notifyData } from '../lib/events';
import { getMeta, setMeta } from '../storage/cache';
import type { QueueEntry, QueueError } from '../storage/db';
import { listQueue, removeEntry, resetSending, updateEntry } from '../storage/queue';

export interface SyncStatus {
  flushing: boolean;
  /** Queue is paused until the user signs in again (401). */
  paused: boolean;
  /** Last whole-sync error that was not about a single item. */
  lastError: string | null;
  /**
   * The server's vehicle is not the one this device's queue was made for (a restored backup, a
   * different server). The queue is held, not sent.
   */
  identityMismatch: boolean;
}

const INITIAL_STATUS: SyncStatus = {
  flushing: false,
  paused: false,
  lastError: null,
  identityMismatch: false,
};
let status: SyncStatus = INITIAL_STATUS;

/** Meta key holding the vehicle id of the server this device last synced with. */
export const IDENTITY_KEY = 'server_identity';
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Set when flush() is called during a run: a write may have been queued after the run read the queue. */
let rerun = false;

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const l of [...listeners]) l();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Exponential backoff: 2s, 4s, 8s ... capped at 60s. */
export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

function toQueueError(e: ApiError): QueueError {
  return { status: e.status, code: e.code, message: e.message, details: e.details };
}

type Outcome = 'done' | 'failed' | 'retry' | 'auth';

type Identity = 'ok' | 'mismatch' | 'retry' | 'auth';

/**
 * Before the first write of a run, ask the server which vehicle it holds and compare it with the
 * marker stored on this device. A different (or missing) vehicle means a different server or a
 * restored database: replaying the queue there could create records on the wrong server.
 * No marker yet (first use) learns the id if there is one.
 */
async function checkIdentity(): Promise<Identity> {
  let serverId: string | null;
  try {
    serverId = (await getVehicle()).id;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) serverId = null;
    else if (e instanceof ApiError && e.status === 401) return 'auth';
    else return 'retry';
  }
  const marker = await getMeta<string>(IDENTITY_KEY);
  if (marker !== undefined && marker !== serverId) {
    setStatus({ identityMismatch: true });
    return 'mismatch';
  }
  if (marker === undefined && serverId !== null) await setMeta(IDENTITY_KEY, serverId);
  setStatus({ identityMismatch: false });
  return 'ok';
}

async function applySuccess(entry: QueueEntry, data: unknown): Promise<void> {
  switch (entry.kind) {
    case 'create-record':
    case 'edit-record':
      await upsertRecordInCache(data as ServiceRecord);
      break;
    case 'delete-record':
      await removeRecordFromCache(entry.record_id);
      break;
    case 'create-reminder':
    case 'edit-reminder':
      await upsertReminderInCache(data as Reminder);
      break;
    case 'delete-reminder':
      await removeReminderFromCache(entry.record_id);
      break;
    case 'create-expense':
    case 'edit-expense':
      await upsertExpenseInCache(data as Expense);
      break;
    case 'delete-expense':
      await removeExpenseFromCache(entry.record_id);
      break;
    case 'put-vehicle':
      await setVehicleInCache(data as Vehicle);
      if ((await getMeta<string>(IDENTITY_KEY)) === undefined)
        await setMeta(IDENTITY_KEY, (data as Vehicle).id);
      break;
  }
}

async function send(entry: QueueEntry): Promise<Outcome> {
  await updateEntry(entry.seq, { status: 'sending', attempts: entry.attempts + 1 });
  try {
    const res = await request<unknown>({
      method: entry.method,
      path: entry.path,
      body: entry.body,
    });
    // POST: 201 on first create and 200 on an identical replay are both success.
    await applySuccess(entry, res.data);
    await removeEntry(entry.seq);
    return 'done';
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) {
        await updateEntry(entry.seq, { status: 'pending' });
        return 'auth';
      }
      if (entry.method === 'DELETE' && e.status === 404) {
        // Already gone (for example a replayed DELETE): the goal is met.
        if (entry.kind === 'delete-reminder') await removeReminderFromCache(entry.record_id);
        else if (entry.kind === 'delete-expense') await removeExpenseFromCache(entry.record_id);
        else await removeRecordFromCache(entry.record_id);
        await removeEntry(entry.seq);
        return 'done';
      }
      if (e.status >= 500 || e.status === 429) {
        const wait =
          e.retryAfterSeconds !== null ? e.retryAfterSeconds * 1000 : backoffMs(entry.attempts + 1);
        await updateEntry(entry.seq, {
          status: 'pending',
          last_error: toQueueError(e),
          next_attempt_at: Date.now() + wait,
        });
        return 'retry';
      }
      // 400, 404 (edit of a missing record), 409 and any other 4xx: the item cannot succeed as is.
      await updateEntry(entry.seq, { status: 'failed', last_error: toQueueError(e) });
      return 'failed';
    }
    if (e instanceof NetworkError) {
      await updateEntry(entry.seq, {
        status: 'pending',
        last_error: { status: null, code: 'network', message: e.message, details: [] },
        next_attempt_at: Date.now() + backoffMs(entry.attempts + 1),
      });
      return 'retry';
    }
    throw e;
  }
}

async function runFlush(force: boolean): Promise<void> {
  await resetSending();
  const blocked = new Set<string>();
  let stop = false;
  let identityChecked = false;
  for (const entry of await listQueue()) {
    if (stop) break;
    if (entry.status === 'failed' || blocked.has(entry.record_id)) continue;
    if (!force && entry.next_attempt_at > Date.now()) continue;
    if (!identityChecked) {
      const id = await checkIdentity();
      if (id === 'auth') {
        requestLogin();
        setStatus({ paused: true });
        break;
      }
      if (id !== 'ok') break; // mismatch: hold the queue. retry: the server is not answering.
      identityChecked = true;
    }
    const outcome = await send(entry);
    if (outcome === 'failed') blocked.add(entry.record_id);
    else if (outcome === 'auth') {
      requestLogin();
      setStatus({ paused: true });
      stop = true;
    } else if (outcome === 'retry') stop = true; // server or network trouble: stop, retry later
  }
  if (!stop) setStatus({ paused: false });
}

function scheduleRetry(entries: QueueEntry[]): void {
  clearTimeout(retryTimer);
  if (getSession().needsLogin || !getSession().signedIn) return;
  const due = entries
    .filter((e) => e.status === 'pending' && e.next_attempt_at > 0)
    .map((e) => e.next_attempt_at);
  if (due.length === 0) return;
  const delay = Math.max(500, Math.min(...due) - Date.now());
  retryTimer = setTimeout(() => {
    void flush();
  }, delay);
}

/**
 * One flush at a time across tabs: a second tab holding the same queue must not send the same
 * entries. Uses the Web Locks API where it exists; without it (older browsers, insecure
 * contexts) the in-tab single flight below is all there is, which the idempotent POST backs up.
 */
const LOCK_NAME = 'zeekr-companion-queue-flush';
async function underFlushLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== 'function') return fn();
  await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (lock === null) return; // another tab is flushing: it will send these entries
    await fn();
  });
}

/**
 * Send queued writes in FIFO order. Single-flight: concurrent callers share one run, which is
 * what guarantees a record is not POSTed twice by overlapping triggers.
 * `force` (the Sync now button) ignores backoff delays.
 */
export function flush(force = false): Promise<void> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  if (!getSession().signedIn) {
    // Nothing can be sent without a token. If there is work, ask for the password.
    inFlight = listQueue()
      .then((q) => {
        if (q.some((e) => e.status !== 'failed')) {
          requestLogin();
          setStatus({ paused: true });
        }
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }
  setStatus({ flushing: true });
  inFlight = (async () => {
    do {
      rerun = false;
      await underFlushLock(() => runFlush(force));
    } while (rerun && getSession().signedIn && !getSession().needsLogin);
  })()
    .catch((e: unknown) => {
      setStatus({ lastError: e instanceof Error ? e.message : 'Sync failed.' });
    })
    .finally(async () => {
      inFlight = null;
      setStatus({ flushing: false });
      scheduleRetry(await listQueue());
      notifyData();
    });
  return inFlight;
}

/** Flush, then refresh the cache from the server. Errors from the refresh are non-fatal. */
export async function syncAll(force = false): Promise<void> {
  await flush(force);
  if (!getSession().signedIn || !isOnline()) return;
  const queue = await listQueue();
  const hasUnsent = queue.some((e) => e.status !== 'failed');
  if (hasUnsent) return; // do not refresh while writes are still waiting
  try {
    // One after the other: each guarded refresh moves the data epoch, and refreshes running side
    // by side would keep invalidating each other until one gave up.
    await refreshVehicle();
    await refreshRecords();
    await refreshReminders();
//     await refreshExpenses();
    // The template is static: one fetch per sync is enough, and a failure here is not fatal.
    await refreshTemplates().catch(() => undefined);
    setStatus({ lastError: null });
  } catch (e) {
    if (!(e instanceof NetworkError) && !(e instanceof ApiError && e.status === 401)) {
      setStatus({ lastError: e instanceof Error ? e.message : 'Refresh failed.' });
    }
  }
}

let started = false;
/** Wire the triggers: online event, visibilitychange to visible, and sign-in. App start calls syncAll. */
export function startSyncTriggers(): () => void {
  if (started) return () => undefined;
  started = true;
  const trigger = () => {
    if (document.visibilityState === 'visible') void syncAll();
  };
  const onOnline = () => {
    void syncAll(true);
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', trigger);
  let wasSignedIn = getSession().signedIn;
  const unsubscribe = subscribeSession(() => {
    const now = getSession().signedIn;
    if (now && !wasSignedIn) void syncAll(true);
    wasSignedIn = now;
  });
  return () => {
    started = false;
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', trigger);
    unsubscribe();
    clearTimeout(retryTimer);
  };
}

export function resetSyncForTests(): void {
  clearTimeout(retryTimer);
  inFlight = null;
  rerun = false;
  status = INITIAL_STATUS;
  listeners.clear();
}
