import { describe, expect, it } from 'vitest';
import vectors from '../../../packages/shared-types/test-vectors/warranty-status.json';
import { statusLabel } from '../src/lib/warrantyText';
import { warrantyStatus } from '../src/lib/warrantyStatus';

interface Case {
  name: string;
  today: string;
  current_odometer_km: number | null;
  coverage: { start_date: string; end_date: string | null; km_limit: number | null };
  expected: { status: string; expired_by: string[]; expiring_soon_by: string[] };
}

describe('AC-51/57: shared warranty vectors (the backend runs the same file)', () => {
  const cases = vectors.cases as Case[];
  it('has the expected number of vectors', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });
  for (const c of cases) {
    it(c.name, () => {
      expect(warrantyStatus(c.coverage, c.current_odometer_km, c.today)).toEqual(c.expected);
    });
  }
});

describe('AC-53: wording', () => {
  it('uses the fixed labels and never says covered', () => {
    const all = [
      statusLabel({ status: 'active', expired_by: [] }),
      statusLabel({ status: 'expiring_soon', expired_by: [] }),
      statusLabel({ status: 'not_started', expired_by: [] }),
      statusLabel({ status: 'expired', expired_by: ['date'] }),
      statusLabel({ status: 'expired', expired_by: ['odometer'] }),
      statusLabel({ status: 'expired', expired_by: ['date', 'odometer'] }),
    ];
    expect(all).toEqual([
      'Active by the dates and km you entered',
      'Expiring soon',
      'Not started',
      'Expired by date',
      'Expired by km',
      'Expired by date and km',
    ]);
    for (const l of all) expect(l).not.toMatch(/covered/i);
  });
});
