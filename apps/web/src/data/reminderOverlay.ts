import type { Reminder, ReminderCreate, ReminderEdit } from '../api/types';
import { computeStatus } from '../lib/reminderStatus';
import type { QueueEntry, QueueError } from '../storage/db';
import type { SyncState } from './overlay';

export interface ReminderView {
  reminder: Reminder;
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

function applyEdit(r: Reminder, patch: ReminderEdit): Reminder {
  const out = { ...r };
  if (patch.kind != null) out.kind = patch.kind;
  if (patch.title != null) out.title = patch.title;
  if (patch.due_date !== undefined) out.due_date = patch.due_date;
  if (patch.due_odometer !== undefined) out.due_odometer = patch.due_odometer;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.completed_on !== undefined) out.completed_on = patch.completed_on;
  return out;
}

/** Order: overdue, upcoming, completed; then due date (nulls last), due km (nulls last), id. */
export function compareReminders(a: Reminder, b: Reminder): number {
  const rank = { overdue: 0, upcoming: 1, completed: 2 } as const;
  if (a.status !== b.status) return rank[a.status] - rank[b.status];
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  if (a.due_odometer !== b.due_odometer) {
    if (a.due_odometer === null) return 1;
    if (b.due_odometer === null) return -1;
    return a.due_odometer - b.due_odometer;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Cached server reminders with the unsent queue on top. Status is always recomputed here from
 * the current odometer and the device date (AC-24), so the server value is only a starting point.
 */
export function overlayReminders(
  cached: Reminder[],
  queue: QueueEntry[],
  currentOdometerKm: number | null,
  today: string,
): ReminderView[] {
  const map = new Map<string, ReminderView>();
  for (const r of cached) map.set(r.id, { reminder: r, sync: 'synced', error: null });
  for (const e of queue) {
    if (e.kind === 'create-reminder') {
      const body = e.body as ReminderCreate;
      const prev = map.get(e.record_id);
      const reminder: Reminder = prev
        ? applyEdit(prev.reminder, body)
        : {
            id: body.id,
            kind: body.kind,
            title: body.title,
            due_date: body.due_date ?? null,
            due_odometer: body.due_odometer ?? null,
            notes: body.notes ?? null,
            completed_on: null,
            template_ref: body.template_ref ?? null,
            status: 'upcoming',
            overdue_by: [],
            created_at: e.created_at,
            updated_at: e.created_at,
          };
      map.set(e.record_id, { ...worst(prev ?? { sync: 'synced', error: null }, e), reminder });
    } else if (e.kind === 'edit-reminder') {
      const prev = map.get(e.record_id);
      if (!prev) continue;
      map.set(e.record_id, {
        ...worst(prev, e),
        reminder: applyEdit(prev.reminder, e.body as ReminderEdit),
      });
    } else if (e.kind === 'delete-reminder') {
      map.delete(e.record_id);
    }
  }
  const views = [...map.values()].map((v) => ({
    ...v,
    reminder: { ...v.reminder, ...computeStatus(v.reminder, currentOdometerKm, today) },
  }));
  return views.sort((a, b) => compareReminders(a.reminder, b.reminder));
}
