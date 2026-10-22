import { describe, expect, it } from 'vitest';
import vectors from '../../../packages/shared-types/test-vectors/reminder-status.json';
import { addMonths, klToday } from '../src/lib/dates';
import { computeStatus, isDueSoon } from '../src/lib/reminderStatus';

interface Case {
  name: string;
  today: string;
  current_odometer_km: number | null;
  reminder: { due_date: string | null; due_odometer: number | null; completed_on: string | null };
  expected: { status: string; overdue_by: string[] };
}

describe('AC-17: shared overdue vectors (the backend runs the same file)', () => {
  const cases = vectors.cases as Case[];
  it('has the expected number of vectors', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(computeStatus(c.reminder, c.current_odometer_km, c.today)).toEqual(c.expected);
    });
  }
});

describe('due soon is display only (30 days or 1,000 km)', () => {
  const open = { due_date: null, due_odometer: null, completed_on: null };
  it('by date', () => {
    expect(isDueSoon({ ...open, due_date: '2026-11-21' }, null, '2026-10-22')).toBe(true);
    expect(isDueSoon({ ...open, due_date: '2026-11-22' }, null, '2026-10-22')).toBe(false);
  });
  it('by km', () => {
    expect(isDueSoon({ ...open, due_odometer: 21000 }, 20000, '2026-10-22')).toBe(true);
    expect(isDueSoon({ ...open, due_odometer: 21001 }, 20000, '2026-10-22')).toBe(false);
    expect(isDueSoon({ ...open, due_odometer: 21000 }, null, '2026-10-22')).toBe(false);
  });
  it('never for completed or overdue-by-date items', () => {
    expect(
      isDueSoon(
        { ...open, due_date: '2026-10-25', completed_on: '2026-10-22' },
        null,
        '2026-10-22',
      ),
    ).toBe(false);
    expect(isDueSoon({ ...open, due_date: '2026-10-01' }, null, '2026-10-22')).toBe(false);
  });
});

describe('date helpers', () => {
  it('klToday uses the Malaysian date', () => {
    expect(klToday(new Date('2026-10-21T16:30:00Z'))).toBe('2026-10-22');
    expect(klToday(new Date('2026-10-21T15:59:00Z'))).toBe('2026-10-21');
  });
  it('addMonths clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-10-22', 12)).toBe('2028-10-22');
    expect(addMonths('2026-10-22', 96)).toBe('2034-10-22');
  });
});
