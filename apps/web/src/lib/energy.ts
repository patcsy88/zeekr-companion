/** Energy is entered in kWh and sent as integer watt-hours. Never use floating point for it. */

export const MAX_ENERGY_WH = 1_000_000; // contract: 1 to 1,000,000 Wh (1,000 kWh)

export type EnergyParse = { ok: true; wh: number | null } | { ok: false; error: string };

/** Blank means "not recorded" (null). Otherwise up to 3 decimals, 0.001 to 1000 kWh. */
export function parseKwhToWh(input: string): EnergyParse {
  const s = input.trim();
  if (s === '') return { ok: true, wh: null };
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return { ok: false, error: 'Enter kWh with at most 3 decimals, for example 42.5.' };
  const whole = (m[1] ?? '').replace(/^0+(?=\d)/, '');
  if (whole.length > 4) return { ok: false, error: 'That energy is too large.' };
  const wh = Number(whole) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  if (wh < 1) return { ok: false, error: 'The energy must be more than 0 kWh, or left blank.' };
  if (wh > MAX_ENERGY_WH) return { ok: false, error: 'The energy can be at most 1000 kWh.' };
  return { ok: true, wh };
}

/** Plain editable form ("42.5", no trailing zeros). */
export function whToInput(wh: number): string {
  const whole = Math.floor(wh / 1000);
  const frac = String(wh % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return frac === '' ? String(whole) : `${whole}.${frac}`;
}

/** Display form: "42.5 kWh". */
export function formatKwh(wh: number): string {
  return `${whToInput(wh)} kWh`;
}
