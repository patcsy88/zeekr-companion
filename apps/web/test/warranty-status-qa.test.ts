import { afterEach, describe, expect, test, vi } from 'vitest';
import { addDays, addMonths, isIsoDate, klToday } from '../src/lib/dates';
import { warrantyStatus } from '../src/lib/warrantyStatus';
import { statusLabel } from '../src/lib/warrantyText';

const base = { start_date: '2026-01-01', end_date: '2026-12-31', km_limit: 100000 };

afterEach(() => vi.useRealTimers());

describe('warrantyStatus (AC-51)', () => {
  test('end date equal to today is not expired; the day after is', () => {
    expect(warrantyStatus(base, null, '2026-12-31').status).toBe('expiring_soon');
    const r = warrantyStatus(base, null, '2027-01-01');
    expect(r.status).toBe('expired');
    expect(r.expired_by).toEqual(['date']);
  });

  test('start date equal to today is started; the day before is not_started', () => {
    expect(warrantyStatus({ ...base, end_date: '2030-01-01' }, null, '2026-01-01').status).toBe(
      'active',
    );
    expect(warrantyStatus(base, null, '2025-12-31').status).toBe('not_started');
  });

  test('90 day boundary', () => {
    const c = { start_date: '2026-01-01', end_date: '2026-06-30', km_limit: null };
    expect(warrantyStatus(c, null, addDays('2026-06-30', -90)).status).toBe('expiring_soon');
    expect(warrantyStatus(c, null, addDays('2026-06-30', -91)).status).toBe('active');
  });

  test('5000 km boundary and equality with the limit', () => {
    const c = { start_date: '2026-01-01', end_date: null, km_limit: 60000 };
    expect(warrantyStatus(c, 55000, '2026-02-01').status).toBe('expiring_soon');
    expect(warrantyStatus(c, 54999, '2026-02-01').status).toBe('active');
    expect(warrantyStatus(c, 60000, '2026-02-01').status).toBe('expiring_soon');
    const over = warrantyStatus(c, 60001, '2026-02-01');
    expect(over.status).toBe('expired');
    expect(over.expired_by).toEqual(['odometer']);
  });

  test('unknown odometer: km is not evaluated', () => {
    const c = { start_date: '2026-01-01', end_date: null, km_limit: 10 };
    expect(warrantyStatus(c, null, '2026-02-01').status).toBe('active');
  });

  test('expired by both reports both', () => {
    const r = warrantyStatus(base, 100001, '2027-02-01');
    expect(r.status).toBe('expired');
    expect(r.expired_by.sort()).toEqual(['date', 'odometer']);
    expect(statusLabel({ status: 'expired', expired_by: r.expired_by })).toBe(
      'Expired by date and km',
    );
  });

  test('expired beats not_started', () => {
    const c = { start_date: '2030-01-01', end_date: '2026-01-01', km_limit: null };
    expect(warrantyStatus(c, null, '2026-06-01').status).toBe('expired');
  });

  test('no end date and no km limit never expires', () => {
    const c = { start_date: '2026-01-01', end_date: null, km_limit: null };
    expect(warrantyStatus(c, 999999, '2099-01-01').status).toBe('active');
  });
});

describe('status labels (AC-53)', () => {
  test('exact wording and no forbidden words', () => {
    const labels = [
      statusLabel({ status: 'active', expired_by: [] }),
      statusLabel({ status: 'expiring_soon', expired_by: [] }),
      statusLabel({ status: 'not_started', expired_by: [] }),
      statusLabel({ status: 'expired', expired_by: ['date'] }),
      statusLabel({ status: 'expired', expired_by: ['odometer'] }),
      statusLabel({ status: 'expired', expired_by: ['date', 'odometer'] }),
    ];
    expect(labels).toEqual([
      'Active by the dates and km you entered',
      'Expiring soon',
      'Not started',
      'Expired by date',
      'Expired by km',
      'Expired by date and km',
    ]);
    for (const l of labels) expect(l).not.toMatch(/covered|guarantee/i);
  });
});

describe('date math', () => {
  test.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-01-15', 60, '2031-01-15'],
    ['2026-01-15', 96, '2034-01-15'],
    ['2026-01-31', 13, '2027-02-28'],
  ])('addMonths(%s, %i) = %s', (d, m, want) => {
    expect(addMonths(d, m)).toBe(want);
  });

  test('addDays crosses month, year and leap day', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  test('isIsoDate rejects impossible and malformed dates', () => {
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '2026-1-1',
      '',
      ' 2026-01-01',
      '2026-01-01 ',
      '2025-02-29',
    ])
      expect(isIsoDate(bad)).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  test('klToday uses Kuala Lumpur, not UTC', () => {
    expect(klToday(new Date('2026-03-01T16:30:00Z'))).toBe('2026-03-02');
    expect(klToday(new Date('2026-03-01T15:59:59Z'))).toBe('2026-03-01');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T17:00:00Z'));
    expect(klToday()).toBe('2027-01-01');
  });
});
