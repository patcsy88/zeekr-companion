import type { TyreEvent, TyreEventCreate, TyreEventEdit } from '../api/types';
import type { QueueEntry, QueueError } from '../storage/db';
import type { SyncState } from './overlay';

export interface TyreEventView {
  event: TyreEvent;
  sync: SyncState;
  error: QueueError | null;
}

const RANK: Record<SyncState, number> = { synced: 0, pending: 1, sending: 2, failed: 3 };

function worst(a: { sync: SyncState; error: QueueError | null }, e: QueueEntry) {
  const s: SyncState = e.status;
  return RANK[s] > RANK[a.sync]
    ? { sync: s, error: e.last_error }
    : { sync: a.sync, error: a.error };
}

/** Newest first: date, then created_at, then id, all descending (AC-79). */
export function compareTyreEvents(a: TyreEvent, b: TyreEvent): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Drops null or undefined for the required fields so a merge can never null them. */
function definedOnly(patch: TyreEventEdit | TyreEventCreate): Partial<TyreEvent> {
  const out: Partial<TyreEvent> = {};
  if (patch.date != null) out.date = patch.date;
  if (patch.kind != null) out.kind = patch.kind;
  if (patch.wheels != null) out.wheels = patch.wheels;
  if (patch.odometer != null) out.odometer = patch.odometer;
  if ('currency' in patch && patch.currency != null) out.currency = patch.currency;
  if (patch.brand !== undefined) out.brand = patch.brand;
  if (patch.model !== undefined) out.model = patch.model;
  if (patch.size !== undefined) out.size = patch.size;
  if (patch.cost_minor !== undefined) out.cost_minor = patch.cost_minor;
  if (patch.shop !== undefined) out.shop = patch.shop;
  if (patch.notes !== undefined) out.notes = patch.notes;
  return out;
}

/** Cached server events with the unsent queue applied on top, newest first. */
export function overlayTyreEvents(cached: TyreEvent[], queue: QueueEntry[]): TyreEventView[] {
  const map = new Map<string, TyreEventView>();
  for (const x of cached) map.set(x.id, { event: x, sync: 'synced', error: null });
  for (const e of queue) {
    if (e.kind === 'create-tyre-event') {
      const body = e.body as TyreEventCreate;
      const prev = map.get(e.record_id);
      const event: TyreEvent = prev
        ? { ...prev.event, ...definedOnly(body) }
        : {
            id: body.id,
            date: body.date,
            kind: body.kind,
            wheels: body.wheels,
            odometer: body.odometer,
            brand: body.brand ?? null,
            model: body.model ?? null,
            size: body.size ?? null,
            cost_minor: body.cost_minor ?? null,
            currency: body.currency ?? 'MYR',
            shop: body.shop ?? null,
            notes: body.notes ?? null,
            created_at: e.created_at,
            updated_at: e.created_at,
          };
      map.set(e.record_id, { ...worst(prev ?? { sync: 'synced', error: null }, e), event });
    } else if (e.kind === 'edit-tyre-event') {
      const prev = map.get(e.record_id);
      if (!prev) continue;
      map.set(e.record_id, {
        ...worst(prev, e),
        event: { ...prev.event, ...definedOnly(e.body as TyreEventEdit) },
      });
    } else if (e.kind === 'delete-tyre-event') {
      map.delete(e.record_id);
    }
  }
  return [...map.values()].sort((a, b) => compareTyreEvents(a.event, b.event));
}
