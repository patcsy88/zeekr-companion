import { describe, expect, it } from 'vitest';
import vectors from '../../../packages/shared-types/test-vectors/expense-totals.json';
import { CATEGORIES, CATEGORY_LABELS, NOT_INCLUDED } from '../src/lib/expenseText';
import {
  expenseTotals,
  filterExpenses,
  type ExpenseFilter,
  type TotalsInput,
} from '../src/lib/expenseTotals';

interface Case {
  name: string;
  expenses: TotalsInput[];
  filter: ExpenseFilter;
  expected: ReturnType<typeof expenseTotals>;
}

describe('AC-37 / AC-41: shared expense totals vectors (the same file is for the backend)', () => {
  const cases = vectors.cases as unknown as Case[];
  it('has the expected number of vectors', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(expenseTotals(filterExpenses(c.expenses, c.filter))).toEqual(c.expected);
    });
  }
});

describe('AC-34: categories', () => {
  it('has the eleven contract values, each with a readable label', () => {
    expect(CATEGORIES).toEqual([
      'charging',
      'insurance',
      'road_tax',
      'parking',
      'tolls',
      'tyres',
      'accessories',
      'cleaning',
      'fines',
      'warranty',
      'other',
    ]);
    for (const c of CATEGORIES) {
      expect(CATEGORY_LABELS[c]).toMatch(/^[A-Z]/);
      expect(CATEGORY_LABELS[c]).not.toContain('_');
    }
    expect(CATEGORY_LABELS.road_tax).toBe('Road tax (JPJ)');
  });
});

describe('AC-46: scope', () => {
  it('the totals function takes only date, category and amount: a service cost cannot enter it', () => {
    const rows = [{ date: '2026-10-01', category: 'other' as const, amount_minor: 100 }];
    const withExtra = [{ ...rows[0], cost_minor: 999_999 }] as unknown as TotalsInput[];
    expect(expenseTotals(withExtra).total_minor).toBe(100);
    expect(NOT_INCLUDED).toMatch(/Service record costs are not included/);
  });
});
