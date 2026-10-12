import type { ServiceRecord, ServiceRecordCreate, ServiceRecordPatch, Vehicle } from '../api/types';
import type { QueueEntry, QueueError } from '../storage/db';

export type SyncState = 'synced' | 'pending' | 'sending' | 'failed';

export interface RecordView {
  record: ServiceRecord;
  sync: SyncState;
  error: QueueError | null;
}

export interface VehicleView {
  vehicle: Vehicle;
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

export function compareRecords(a: ServiceRecord, b: ServiceRecord): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The contract's PATCH type allows null for every field, but only provider and notes are really
 * nullable. The client never sends null for the others (see RecordEdit), and this drops any null
 * or undefined for them so a merge can never put null into a required field.
 */
function definedOnly(patch: ServiceRecordPatch | ServiceRecordCreate): Partial<ServiceRecord> {
  const out: Partial<ServiceRecord> = {};
  if (patch.date != null) out.date = patch.date;
  if (patch.odometer != null) out.odometer = patch.odometer;
  if (patch.description != null) out.description = patch.description;
  if (patch.cost_minor != null) out.cost_minor = patch.cost_minor;
  if (patch.currency != null) out.currency = patch.currency;
  if (patch.provider !== undefined) out.provider = patch.provider;
  if (patch.notes !== undefined) out.notes = patch.notes;
  return out;
}

/** Cached server records with the unsent queue applied on top, newest first. */
export function overlayRecords(cached: ServiceRecord[], queue: QueueEntry[]): RecordView[] {
  const map = new Map<string, RecordView>();
  for (const r of cached) map.set(r.id, { record: r, sync: 'synced', error: null });
  for (const e of queue) {
    if (e.kind === 'create-record') {
      const body = e.body as ServiceRecordCreate;
      const prev = map.get(e.record_id);
      const record: ServiceRecord = prev
        ? { ...prev.record, ...definedOnly(body) }
        : {
            ...body,
            provider: body.provider ?? null,
            notes: body.notes ?? null,
            currency: body.currency ?? 'MYR',
            created_at: e.created_at,
            updated_at: e.created_at,
          };
      map.set(e.record_id, { ...worst(prev ?? { sync: 'synced', error: null }, e), record });
    } else if (e.kind === 'edit-record') {
      const prev = map.get(e.record_id);
      if (!prev) continue;
      map.set(e.record_id, {
        ...worst(prev, e),
        record: { ...prev.record, ...definedOnly(e.body as ServiceRecordPatch) },
      });
    } else if (e.kind === 'delete-record') {
      map.delete(e.record_id);
    }
  }
  return [...map.values()].sort((a, b) => compareRecords(a.record, b.record));
}

export function overlayVehicle(cached: Vehicle | null, queue: QueueEntry[]): VehicleView | null {
  let view: VehicleView | null = cached ? { vehicle: cached, sync: 'synced', error: null } : null;
  for (const e of queue) {
    if (e.kind !== 'put-vehicle') continue;
    const vehicle = e.body as Vehicle;
    view = { ...worst(view ?? { sync: 'synced', error: null }, e), vehicle };
  }
  return view;
}
