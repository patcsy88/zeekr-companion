import type { Expense, ExpenseCreate, ExpenseEdit } from '../api/types';
import type { QueueEntry, QueueError } from '../storage/db';
import type { SyncState } from './overlay';

export interface ExpenseView {
  expense: Expense;
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

/** Newest first: date, then created_at, then id, all descending (AC-35). */
export function compareExpenses(a: Expense, b: Expense): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Drops null or undefined for the required fields so a merge can never null them. */
function definedOnly(patch: ExpenseEdit | ExpenseCreate): Partial<Expense> {
  const out: Partial<Expense> = {};
  if (patch.date != null) out.date = patch.date;
  if (patch.category != null) out.category = patch.category;
  if (patch.amount_minor != null) out.amount_minor = patch.amount_minor;
  if ('currency' in patch && patch.currency != null) out.currency = patch.currency;
  if (patch.notes !== undefined) out.notes = patch.notes;
  if (patch.energy_wh !== undefined) out.energy_wh = patch.energy_wh;
  return out;
}

/** Cached server expenses with the unsent queue applied on top, newest first. */
export function overlayExpenses(cached: Expense[], queue: QueueEntry[]): ExpenseView[] {
  const map = new Map<string, ExpenseView>();
  for (const x of cached) map.set(x.id, { expense: x, sync: 'synced', error: null });
  for (const e of queue) {
    if (e.kind === 'create-expense') {
      const body = e.body as ExpenseCreate;
      const prev = map.get(e.record_id);
      const expense: Expense = prev
        ? { ...prev.expense, ...definedOnly(body) }
        : {
            id: body.id,
            date: body.date,
            category: body.category,
            amount_minor: body.amount_minor,
            currency: body.currency ?? 'MYR',
            notes: body.notes ?? null,
            energy_wh: body.energy_wh ?? null,
            created_at: e.created_at,
            updated_at: e.created_at,
          };
      map.set(e.record_id, { ...worst(prev ?? { sync: 'synced', error: null }, e), expense });
    } else if (e.kind === 'edit-expense') {
      const prev = map.get(e.record_id);
      if (!prev) continue;
      map.set(e.record_id, {
        ...worst(prev, e),
        expense: { ...prev.expense, ...definedOnly(e.body as ExpenseEdit) },
      });
    } else if (e.kind === 'delete-expense') {
      map.delete(e.record_id);
    }
  }
  return [...map.values()].sort((a, b) => compareExpenses(a.expense, b.expense));
}
