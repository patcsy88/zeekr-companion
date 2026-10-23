import { describe, expect, test } from 'vitest';
import { outsideCoverageDates, validateClaim } from '../src/components/ClaimForm';
import { validateCoverage } from '../src/components/CoverageForm';

const okCov = {
  name: 'Battery cover',
  start_date: '2026-01-01',
  end_date: '2030-01-01',
  km_limit: '160000',
  notes: '',
  source_note: '',
};
const okClaim = {
  date: '2026-03-01',
  odometer: '1200',
  description: 'Door seal',
  cost: '',
  notes: '',
};
const TODAY = '2026-06-15';

describe('validateCoverage (AC-49)', () => {
  test('valid baseline has no errors', () => {
    expect(validateCoverage(okCov)).toEqual({});
  });

  test('name blank, whitespace, 200 and 201 characters', () => {
    expect(validateCoverage({ ...okCov, name: '' }).name).toBeDefined();
    expect(validateCoverage({ ...okCov, name: '   ' }).name).toBeDefined();
    expect(validateCoverage({ ...okCov, name: 'a'.repeat(200) }).name).toBeUndefined();
    expect(validateCoverage({ ...okCov, name: 'a'.repeat(201) }).name).toBeDefined();
    expect(validateCoverage({ ...okCov, name: ' ' + 'a'.repeat(200) + ' ' }).name).toBeUndefined();
  });

  test('start date required, valid and in range', () => {
    for (const s of ['', '2026-02-30', '1999-12-31', '2201-01-01', 'abc'])
      expect(validateCoverage({ ...okCov, start_date: s }).start_date).toBeDefined();
    expect(validateCoverage({ ...okCov, start_date: '2000-01-01' }).start_date).toBeUndefined();
    expect(
      validateCoverage({ ...okCov, start_date: '2200-12-31', end_date: '2200-12-31' }),
    ).toEqual({});
  });

  test('end before start is refused; equal is accepted', () => {
    expect(validateCoverage({ ...okCov, end_date: '2025-12-31' }).end_date).toBeDefined();
    expect(validateCoverage({ ...okCov, end_date: '2026-01-01' }).end_date).toBeUndefined();
  });

  test('neither end date nor km limit is refused; either alone is fine', () => {
    expect(validateCoverage({ ...okCov, end_date: '', km_limit: '' }).limit).toBeDefined();
    expect(validateCoverage({ ...okCov, end_date: '' })).toEqual({});
    expect(validateCoverage({ ...okCov, km_limit: '' })).toEqual({});
    expect(validateCoverage({ ...okCov, km_limit: '   ', end_date: '' }).limit).toBeDefined();
  });

  test.each(['0', '10000001', '1.5', '1e3', '-1', '+5', '１２', 'abc', '123456789', '1,000'])(
    'km limit %s is refused',
    (km) => {
      expect(validateCoverage({ ...okCov, km_limit: km }).km_limit).toBeDefined();
    },
  );

  test.each(['1', '10000000', ' 500 ', '000123'])('km limit %s is accepted', (km) => {
    expect(validateCoverage({ ...okCov, km_limit: km }).km_limit).toBeUndefined();
  });

  test('end date out of range', () => {
    expect(validateCoverage({ ...okCov, end_date: '2201-01-01' }).end_date).toBeDefined();
    expect(validateCoverage({ ...okCov, end_date: '2026-13-01' }).end_date).toBeDefined();
  });

  test('notes 5000 / 5001 and source_note 200 / 201', () => {
    expect(validateCoverage({ ...okCov, notes: 'n'.repeat(5000) }).notes).toBeUndefined();
    expect(validateCoverage({ ...okCov, notes: 'n'.repeat(5001) }).notes).toBeDefined();
    expect(
      validateCoverage({ ...okCov, source_note: 's'.repeat(200) }).source_note,
    ).toBeUndefined();
    expect(validateCoverage({ ...okCov, source_note: 's'.repeat(201) }).source_note).toBeDefined();
  });

  test.fails(
    'QA-WW4: a string longer than 200 UTF-16 units but within 200 characters is wrongly refused',
    () => {
      // 150 emoji = 150 characters (valid on the server) but 300 UTF-16 units.
      expect(
        validateCoverage({ ...okCov, source_note: '🚗'.repeat(150) }).source_note,
      ).toBeUndefined();
    },
  );

  test.fails('QA-WW5: a NUL character in text is not refused on the device', () => {
    // Contract: no NUL characters in any string. The server answers 400, so offline the write would
    // be queued and then blocked instead of being refused at the form.
    const r = validateCoverage({ ...okCov, name: 'bad\u0000name', notes: 'x\u0000y' });
    expect(r.name).toBeDefined();
    expect(r.notes).toBeDefined();
  });
});

describe('validateClaim (AC-57)', () => {
  test('valid baseline', () => {
    const { costMinor, ...rest } = validateClaim(okClaim, TODAY);
    expect(rest).toEqual({});
    expect(costMinor).toBeNull();
  });

  test('date: required, invalid, before 2000, today ok, tomorrow refused', () => {
    for (const d of ['', '2026-02-30', '1999-12-31', 'x'])
      expect(validateClaim({ ...okClaim, date: d }, TODAY).date).toBeDefined();
    expect(validateClaim({ ...okClaim, date: '2000-01-01' }, TODAY).date).toBeUndefined();
    expect(validateClaim({ ...okClaim, date: TODAY }, TODAY).date).toBeUndefined();
    expect(validateClaim({ ...okClaim, date: '2026-06-16' }, TODAY).date).toBeDefined();
  });

  test.each(['', '-1', '1.5', '1e3', '10000001', '123456789', 'abc', ' '])(
    'odometer %j is refused',
    (o) => {
      expect(validateClaim({ ...okClaim, odometer: o }, TODAY).odometer).toBeDefined();
    },
  );

  test.each(['0', '10000000', ' 42 '])('odometer %j is accepted', (o) => {
    expect(validateClaim({ ...okClaim, odometer: o }, TODAY).odometer).toBeUndefined();
  });

  test('description 0 / 1 / 500 / 501 and whitespace only', () => {
    expect(validateClaim({ ...okClaim, description: '' }, TODAY).description).toBeDefined();
    expect(validateClaim({ ...okClaim, description: '   ' }, TODAY).description).toBeDefined();
    expect(validateClaim({ ...okClaim, description: 'a' }, TODAY).description).toBeUndefined();
    expect(
      validateClaim({ ...okClaim, description: 'a'.repeat(500) }, TODAY).description,
    ).toBeUndefined();
    expect(
      validateClaim({ ...okClaim, description: 'a'.repeat(501) }, TODAY).description,
    ).toBeDefined();
  });

  test('cost parser', () => {
    const c = (cost: string) => validateClaim({ ...okClaim, cost }, TODAY);
    expect(c('').costMinor).toBeNull();
    expect(c('   ').costMinor).toBeNull();
    expect(c('0').costMinor).toBe(0);
    expect(c('12.5').costMinor).toBe(1250);
    expect(c('1,234.50').costMinor).toBe(123450);
    expect(c('RM 12').costMinor).toBe(1200);
    expect(c('007.05').costMinor).toBe(705);
    expect(c('10000000000').costMinor).toBe(1_000_000_000_000);
    for (const bad of ['0,100', '1,23', '-5', '1.234', '1e3', 'abc', '12.', '.5', '10000000001'])
      expect(c(bad).cost, bad).toBeDefined();
    expect(c('99999999999999999999').cost).toBeDefined();
  });

  test('notes 5000 / 5001', () => {
    expect(validateClaim({ ...okClaim, notes: 'n'.repeat(5000) }, TODAY).notes).toBeUndefined();
    expect(validateClaim({ ...okClaim, notes: 'n'.repeat(5001) }, TODAY).notes).toBeDefined();
  });

  test.fails('QA-WW5b: a NUL character in a claim description is not refused on the device', () => {
    expect(validateClaim({ ...okClaim, description: 'a\u0000b' }, TODAY).description).toBeDefined();
  });
});

describe('outsideCoverageDates is a hint predicate only', () => {
  const c = { start_date: '2026-01-01', end_date: '2026-12-31' };
  test('before, inside, after, boundaries and open end', () => {
    expect(outsideCoverageDates('2025-12-31', c)).toBe(true);
    expect(outsideCoverageDates('2026-01-01', c)).toBe(false);
    expect(outsideCoverageDates('2026-12-31', c)).toBe(false);
    expect(outsideCoverageDates('2027-01-01', c)).toBe(true);
    expect(outsideCoverageDates('2099-01-01', { ...c, end_date: null })).toBe(false);
    expect(outsideCoverageDates('garbage', c)).toBe(false);
  });
});
