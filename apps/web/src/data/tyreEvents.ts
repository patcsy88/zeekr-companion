import { listTyreEvents } from '../api/endpoints';
import type { CurrentOdometer, TyreEvent } from '../api/types';
import { bumpEpoch, notifyData } from '../lib/events';
import { getCache, setCache } from '../storage/cache';
import { listQueue } from '../storage/queue';
import { deriveBasis, type OdometerBasis } from './reminders';
import { markSynced, refreshGuarded, withCacheLock } from './repository';
import { compareTyreEvents, overlayTyreEvents, type TyreEventView } from './tyreEventOverlay';

const KEY = 'tyre-events';
/** The contract's maximum page size. */
const PAGE_SIZE = 100;
/** 1,000 events at most (AC-85), so 10 pages is a full fetch. */
const MAX_PAGES = 10;

interface TyreEventCache {
  items: TyreEvent[];
  next_cursor: string | null;
  current_odometer: CurrentOdometer | null;
}

export interface TyreEventsSnapshot {
  /** False until the list has been fetched at least once on this device. */
  loaded: boolean;
  views: TyreEventView[];
  /** True when the server has more events than this device holds. */
  partial: boolean;
  /** The current odometer, by the same rule as reminders. Null when unknown. */
  basis: OdometerBasis | null;
  fetchedAt: string | null;
}

export async function readTyreEvents(): Promise<TyreEventsSnapshot> {
  const [cached, queue] = await Promise.all([getCache<TyreEventCache>(KEY), listQueue()]);
  return {
    loaded: cached !== undefined,
    views: overlayTyreEvents(cached?.value.items ?? [], queue),
    partial: (cached?.value.next_cursor ?? null) !== null,
    basis: await deriveBasis(cached?.value.current_odometer),
    fetchedAt: cached?.fetched_at ?? null,
  };
}

export async function readTyreEvent(id: string): Promise<{ view: TyreEventView | null }> {
  const snap = await readTyreEvents();
  return { view: snap.views.find((v) => v.event.id === id) ?? null };
}

async function fetchAll(): Promise<TyreEventCache> {
  const seen = new Map<string, TyreEvent>();
  let cursor: string | null = null;
  let current: CurrentOdometer | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await listTyreEvents(PAGE_SIZE, cursor);
    if (i === 0) current = page.current_odometer ?? null;
    for (const x of page.items) seen.set(x.id, x);
    cursor = page.next_cursor;
    if (cursor === null) break;
  }
  return {
    items: [...seen.values()].sort(compareTyreEvents),
    next_cursor: cursor,
    current_odometer: current,
  };
}

export async function refreshTyreEvents(): Promise<void> {
  await refreshGuarded(fetchAll, (value) => setCache(KEY, value satisfies TyreEventCache));
  await markSynced();
  notifyData();
}

/**
 * Without a cached list there is nothing to update, and writing a one-item list would claim the
 * cache is complete. The next refresh fills it.
 */
export function upsertTyreEventInCache(event: TyreEvent): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<TyreEventCache>(KEY);
    if (cached) {
      const items = cached.value.items.filter((x) => x.id !== event.id);
      items.push(event);
      items.sort(compareTyreEvents);
      await setCache(KEY, { ...cached.value, items } satisfies TyreEventCache);
    }
    bumpEpoch();
  });
}

export function removeTyreEventFromCache(id: string): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<TyreEventCache>(KEY);
    if (cached) {
      await setCache(KEY, {
        ...cached.value,
        items: cached.value.items.filter((x) => x.id !== id),
      } satisfies TyreEventCache);
    }
    bumpEpoch();
  });
}
