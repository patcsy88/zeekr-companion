import { listExpenses } from '../api/endpoints';
import type { Expense } from '../api/types';
import { bumpEpoch, dataEpoch, notifyData } from '../lib/events';
import { getCache, setCache } from '../storage/cache';
import { listQueue } from '../storage/queue';
import { compareExpenses, overlayExpenses, type ExpenseView } from './expenseOverlay';
import { markSynced, refreshGuarded, withCacheLock } from './repository';

const KEY = 'expenses';
/** The contract's maximum page size. */
export const EXPENSE_PAGE_SIZE = 100;
/** 5,000 expenses at most (AC-45), so 50 pages is a full fetch. */
const MAX_PAGES = 50;

interface ExpenseCache {
  items: Expense[];
  next_cursor: string | null;
}

export interface ExpensesSnapshot {
  /** False until the list has been fetched at least once on this device. */
  loaded: boolean;
  views: ExpenseView[];
  /** True when the server has more expenses than this device holds (AC-41). */
  partial: boolean;
  nextCursor: string | null;
  fetchedAt: string | null;
}

export async function readExpenses(): Promise<ExpensesSnapshot> {
  const [cached, queue] = await Promise.all([getCache<ExpenseCache>(KEY), listQueue()]);
  return {
    loaded: cached !== undefined,
    views: overlayExpenses(cached?.value.items ?? [], queue),
    partial: (cached?.value.next_cursor ?? null) !== null,
    nextCursor: cached?.value.next_cursor ?? null,
    fetchedAt: cached?.fetched_at ?? null,
  };
}

export async function readExpense(id: string): Promise<{ view: ExpenseView | null }> {
  const snap = await readExpenses();
  return { view: snap.views.find((v) => v.expense.id === id) ?? null };
}

/** Pages are fetched one after the other until the server has no more (or the page cap is hit). */
async function fetchAll(): Promise<ExpenseCache> {
  const seen = new Map<string, Expense>();
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await listExpenses(EXPENSE_PAGE_SIZE, cursor);
    for (const x of page.items) seen.set(x.id, x);
    cursor = page.next_cursor;
    if (cursor === null) break;
  }
  return { items: [...seen.values()].sort(compareExpenses), next_cursor: cursor };
}

export async function refreshExpenses(): Promise<void> {
  await refreshGuarded(fetchAll, (value) => setCache(KEY, value satisfies ExpenseCache));
  await markSynced();
  notifyData();
}

export async function loadMoreExpenses(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = dataEpoch();
    const cached = await getCache<ExpenseCache>(KEY);
    const cursor = cached?.value.next_cursor ?? null;
    if (!cached || cursor === null) return;
    const page = await listExpenses(EXPENSE_PAGE_SIZE, cursor);
    const done = await withCacheLock(async () => {
      if (dataEpoch() !== started) return false;
      const seen = new Set(cached.value.items.map((x) => x.id));
      const items = [...cached.value.items, ...page.items.filter((x) => !seen.has(x.id))];
      await setCache(KEY, { items, next_cursor: page.next_cursor } satisfies ExpenseCache);
      bumpEpoch();
      return true;
    });
    if (done) {
      notifyData();
      return;
    }
  }
}

/**
 * Without a cached list there is nothing to update, and writing a one-item list would claim the
 * cache is complete. The next refresh fills it.
 */
export function upsertExpenseInCache(expense: Expense): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<ExpenseCache>(KEY);
    if (cached) {
      const items = cached.value.items.filter((x) => x.id !== expense.id);
      items.push(expense);
      items.sort(compareExpenses);
      await setCache(KEY, { items, next_cursor: cached.value.next_cursor } satisfies ExpenseCache);
    }
    bumpEpoch();
  });
}

export function removeExpenseFromCache(id: string): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<ExpenseCache>(KEY);
    if (cached) {
      await setCache(KEY, {
        items: cached.value.items.filter((x) => x.id !== id),
        next_cursor: cached.value.next_cursor,
      } satisfies ExpenseCache);
    }
    bumpEpoch();
  });
}
