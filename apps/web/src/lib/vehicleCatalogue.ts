/**
 * Malaysian Zeekr 7X variants for the vehicle profile form (FR-1, owner decision 2026-11-08).
 * Web only: the server still stores `variant` and `tyre_spec` as plain text.
 *
 * All rows are `unverified` (press and tyre catalogue), see research M43 in
 * docs/research/vehicle-integrations.md. The door-jamb placard is the authority for tyres.
 * The Black Nova default size was not found in a source; 265/45 R20 is the owner's choice.
 */
export interface VariantEntry {
  name: string;
  years: number[];
  drive: 'AWD' | 'RWD';
  /** The first size is the default. Michelin Malaysia lists all three for the 7X (M33). */
  tyres: string[];
}

const R19 = '255/50 R19';
const R20 = '265/45 R20';
const R21 = '265/40 R21';

export const VARIANTS: readonly VariantEntry[] = [
  { name: 'RWD Standard Range', years: [2025, 2026], drive: 'RWD', tyres: [R19, R20, R21] },
  { name: 'RWD Long Range', years: [2025, 2026], drive: 'RWD', tyres: [R19, R20, R21] },
  { name: 'AWD Performance', years: [2025, 2026], drive: 'AWD', tyres: [R20, R19, R21] },
  { name: 'Black Nova', years: [2026], drive: 'AWD', tyres: [R20, R19, R21] },
];

export const ALL_TYRES: readonly string[] = [R19, R20, R21];

export const DRIVES = ['AWD', 'RWD'] as const;

export function findVariant(name: string): VariantEntry | undefined {
  return VARIANTS.find((v) => v.name === name);
}

/** The stored text: the model year is appended to the variant, e.g. "AWD Performance (2025)". */
export function variantText(name: string, year: number | null): string {
  return year === null ? name : `${name} (${String(year)})`;
}

/**
 * Splits a stored variant back into a catalogue name and year. Anything that does not match a
 * catalogue entry (an older free-text value) comes back as `null`, so the form can keep it.
 */
export function parseVariant(stored: string): { name: string; year: number | null } | null {
  const m = /^(.*) \((\d{4})\)$/.exec(stored);
  const name = m?.[1] ?? stored;
  const year = m ? Number(m[2]) : null;
  const v = findVariant(name);
  if (!v) return null;
  if (year !== null && !v.years.includes(year)) return null;
  return { name, year };
}
