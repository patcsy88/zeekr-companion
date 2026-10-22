import { getServiceRecord, getVehicle, listServiceRecords } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { ServiceRecord, ServiceRecordPage, Vehicle } from '../api/types';
import { bumpEpoch, dataEpoch, notifyData } from '../lib/events';
import { deleteCache, getCache, getMeta, setCache, setMeta } from '../storage/cache';
import { listQueue } from '../storage/queue';
import {
  compareRecords,
  overlayRecords,
  overlayVehicle,
  type RecordView,
  type VehicleView,
} from './overlay';

export const PAGE_SIZE = 20;

const LIST_KEY = 'service-records';
const VEHICLE_KEY = 'vehicle';
const detailKey = (id: string) => `sr:${id}`;

interface ListCache {
  items: ServiceRecord[];
  next_cursor: string | null;
}

/** `value: null` means the server said there is no vehicle yet; a missing entry means unknown. */
interface VehicleCache {
  value: Vehicle | null;
}

/** Serialises cache read-modify-write so two updates cannot overwrite each other. */
let lockTail: Promise<unknown> = Promise.resolve();
export function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockTail.then(fn, fn);
  lockTail = run.catch(() => undefined);
  return run;
}

/**
 * Fetch, then apply the result only if no local write happened since the request started.
 * Otherwise the response may be older than a local change (a delete, an edit, a created record)
 * and applying it would undo that change; fetch again instead. Gives up quietly after 3 tries:
 * the next sync refreshes.
 */
export async function refreshGuarded<T>(
  fetcher: () => Promise<T>,
  apply: (value: T) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = dataEpoch();
    const value = await fetcher();
    const applied = await withCacheLock(async () => {
      if (dataEpoch() !== started) return false;
      await apply(value);
      bumpEpoch();
      return true;
    });
    if (applied) return;
  }
}

export async function markSynced(): Promise<void> {
  await setMeta('last_synced_at', new Date().toISOString());
}

// ---- Reads (from IndexedDB only, with the unsent queue applied) ----------------------------

export interface RecordsSnapshot {
  /** False until a list has been fetched at least once. */
  loaded: boolean;
  views: RecordView[];
  nextCursor: string | null;
  fetchedAt: string | null;
}

export async function readRecords(): Promise<RecordsSnapshot> {
  const [cached, queue] = await Promise.all([getCache<ListCache>(LIST_KEY), listQueue()]);
  return {
    loaded: cached !== undefined,
    views: overlayRecords(cached?.value.items ?? [], queue),
    nextCursor: cached?.value.next_cursor ?? null,
    fetchedAt: cached?.fetched_at ?? null,
  };
}

export async function readRecord(id: string): Promise<RecordView | null> {
  const [list, detail, queue] = await Promise.all([
    getCache<ListCache>(LIST_KEY),
    getCache<ServiceRecord>(detailKey(id)),
    listQueue(),
  ]);
  const fromList = list?.value.items.find((r) => r.id === id);
  const base = fromList ?? detail?.value;
  return (
    overlayRecords(
      base ? [base] : [],
      queue.filter((e) => e.record_id === id),
    )[0] ?? null
  );
}

export interface VehicleSnapshot {
  loaded: boolean;
  view: VehicleView | null;
}

export async function readVehicle(): Promise<VehicleSnapshot> {
  const [cached, queue] = await Promise.all([getCache<VehicleCache>(VEHICLE_KEY), listQueue()]);
  const view = overlayVehicle(cached?.value.value ?? null, queue);
  return { loaded: cached !== undefined || view !== null, view };
}

// ---- Network refreshes (write through to the cache) ----------------------------------------

export async function refreshVehicle(): Promise<void> {
  await refreshGuarded(
    async (): Promise<Vehicle | null> => {
      try {
        return await getVehicle();
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    async (vehicle) => {
      await setCache(VEHICLE_KEY, { value: vehicle } satisfies VehicleCache);
      // First contact: remember which server this device belongs to (see sync/engine.ts).
      if (vehicle && (await getMeta<string>('server_identity')) === undefined)
        await setMeta('server_identity', vehicle.id);
    },
  );
  await markSynced();
  notifyData();
}

/** Fetch the newest page and make it the cached list. Pages loaded before are dropped. */
export async function refreshRecords(): Promise<void> {
  await refreshGuarded(
    () => listServiceRecords(PAGE_SIZE, null),
    (page) =>
      setCache(LIST_KEY, { items: page.items, next_cursor: page.next_cursor } satisfies ListCache),
  );
  await markSynced();
  notifyData();
}

export async function loadMoreRecords(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = dataEpoch();
    const cached = await getCache<ListCache>(LIST_KEY);
    const cursor = cached?.value.next_cursor ?? null;
    if (!cached || cursor === null) return;
    const page: ServiceRecordPage = await listServiceRecords(PAGE_SIZE, cursor);
    const done = await withCacheLock(async () => {
      if (dataEpoch() !== started) return false;
      const seen = new Set(cached.value.items.map((r) => r.id));
      const items = [...cached.value.items, ...page.items.filter((r) => !seen.has(r.id))];
      await setCache(LIST_KEY, { items, next_cursor: page.next_cursor } satisfies ListCache);
      bumpEpoch();
      return true;
    });
    if (done) {
      notifyData();
      return;
    }
  }
}

/** Fetch one record, used when it is not in the cached list. 404 removes it from the cache. */
export async function refreshRecord(id: string): Promise<void> {
  await refreshGuarded(
    async (): Promise<ServiceRecord | null> => {
      try {
        return await getServiceRecord(id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    (record) => (record ? upsertUnlocked(record) : removeUnlocked(id)),
  );
  notifyData();
}

// ---- Cache writes used by the sync engine (serialised, and they move the epoch) ------------

async function upsertUnlocked(record: ServiceRecord): Promise<void> {
  await setCache(detailKey(record.id), record);
  const list = await getCache<ListCache>(LIST_KEY);
  if (list) {
    const items = list.value.items.filter((r) => r.id !== record.id);
    items.push(record);
    items.sort(compareRecords);
    await setCache(LIST_KEY, { items, next_cursor: list.value.next_cursor } satisfies ListCache);
  }
}

async function removeUnlocked(id: string): Promise<void> {
  await deleteCache(detailKey(id));
  const list = await getCache<ListCache>(LIST_KEY);
  if (list) {
    await setCache(LIST_KEY, {
      items: list.value.items.filter((r) => r.id !== id),
      next_cursor: list.value.next_cursor,
    } satisfies ListCache);
  }
}

export function upsertRecordInCache(record: ServiceRecord): Promise<void> {
  return withCacheLock(async () => {
    await upsertUnlocked(record);
    bumpEpoch();
  });
}

export function removeRecordFromCache(id: string): Promise<void> {
  return withCacheLock(async () => {
    await removeUnlocked(id);
    bumpEpoch();
  });
}

export function setVehicleInCache(vehicle: Vehicle): Promise<void> {
  return withCacheLock(async () => {
    await setCache(VEHICLE_KEY, { value: vehicle } satisfies VehicleCache);
    bumpEpoch();
  });
}
