/**
 * The single pure function for expense totals (AC-37, AC-41). The server computes the same
 * summary in SQL; both are checked against packages/shared-types/test-vectors/expense-totals.json.
 * Integer arithmetic only. Safe: 5,000 rows x 10^12 sen stays below Number.MAX_SAFE_INTEGER.
 */
import type { ExpenseCategory } from '../api/types';

export interface TotalsInput {
  date: string;
  category: ExpenseCategory;
  amount_minor: number;
}

export interface ExpenseFilter {
  category?: ExpenseCategory | null;
  /** Inclusive YYYY-MM-DD. */
  from?: string | null;
  /** Inclusive YYYY-MM-DD. */
  to?: string | null;
}

export interface ExpenseTotals {
  total_minor: number;
  count: number;
  by_category: { category: ExpenseCategory; total_minor: number; count: number }[];
  by_month: { month: string; total_minor: number; count: number }[];
}

/** Filters combine with AND. Dates compare as strings, which is correct for YYYY-MM-DD. */
export function filterExpenses<T extends TotalsInput>(rows: T[], f: ExpenseFilter): T[] {
  return rows.filter(
    (r) =>
      (!f.category || r.category === f.category) &&
      (!f.from || r.date >= f.from) &&
      (!f.to || r.date <= f.to),
  );
}

export function expenseTotals(rows: TotalsInput[]): ExpenseTotals {
  const cats = new Map<ExpenseCategory, { total_minor: number; count: number }>();
  const months = new Map<string, { total_minor: number; count: number }>();
  let total = 0;
  for (const r of rows) {
    total += r.amount_minor;
    const c = cats.get(r.category) ?? { total_minor: 0, count: 0 };
    cats.set(r.category, { total_minor: c.total_minor + r.amount_minor, count: c.count + 1 });
    const month = r.date.slice(0, 7); // no time zone conversion
    const m = months.get(month) ?? { total_minor: 0, count: 0 };
    months.set(month, { total_minor: m.total_minor + r.amount_minor, count: m.count + 1 });
  }
  return {
    total_minor: total,
    count: rows.length,
    by_category: [...cats.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) =>
        a.total_minor !== b.total_minor
          ? b.total_minor - a.total_minor
          : a.category < b.category
            ? -1
            : a.category > b.category
              ? 1
              : 0,
      ),
    by_month: [...months.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)),
  };
}
