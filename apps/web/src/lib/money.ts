/** Money is entered in MYR and sent as integer sen. Never use floating point for the conversion. */

export const MAX_MINOR = 1_000_000_000_000; // contract: <= 10^12 sen

export type MoneyParse = { ok: true; minor: number } | { ok: false; error: string };

export function parseMyrToSen(input: string): MoneyParse {
  const s = input.trim().replace(/^RM\s*/i, '');
  if (s === '') return { ok: false, error: 'Enter an amount in MYR, for example 120.50.' };
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m)
    return {
      ok: false,
      error: 'Enter an amount in MYR with at most 2 decimals, for example 120.50.',
    };
  const whole = (m[1] ?? '').replace(/,/g, '');
  const frac = (m[2] ?? '').padEnd(2, '0');
  if (whole.length > 13) return { ok: false, error: 'That amount is too large.' };
  const minor = Number(whole) * 100 + Number(frac);
  if (minor > MAX_MINOR) return { ok: false, error: 'That amount is too large.' };
  return { ok: true, minor };
}

/** Plain editable form ("1234.50", no grouping). */
export function senToInput(minor: number): string {
  const whole = Math.floor(minor / 100);
  const frac = String(minor % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

/** Display form: "RM 1,234.50". */
export function formatMyr(minor: number): string {
  const whole = Math.floor(minor / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `RM ${whole}.${String(minor % 100).padStart(2, '0')}`;
}
