/** Pure helpers for the live vehicle card and its history (ADR-009). No network, no storage. */

export const GAP_FACTOR = 3; // a gap is more than 3 x the interval between two readings

const KL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A UTC timestamp shown in Asia/Kuala_Lumpur time. */
export function formatKl(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${KL_TIME.format(d)} (KL)`;
}

export const NO_READING = 'no reading';

export function km(value: number | null): string {
  return value === null ? NO_READING : `${value.toLocaleString('en-GB')} km`;
}

export function percent(value: number | null): string {
  return value === null ? NO_READING : `${value.toFixed(1)}%`;
}

export function kpa(value: number | null): string {
  return value === null ? NO_READING : `${value} kPa`;
}

export function days(value: number | null): string {
  return value === null ? NO_READING : `${value} ${Math.abs(value) === 1 ? 'day' : 'days'}`;
}

export function yesNo(value: boolean | null): string {
  return value === null ? NO_READING : value ? 'Yes' : 'No';
}

/** A length of time as "2 h 5 min", "3 days 4 h" or "under a minute". */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const d = Math.floor(hours / 24);
  return `${d} ${d === 1 ? 'day' : 'days'} ${hours % 24} h`;
}

export function isGap(laterIso: string, earlierIso: string, intervalMinutes: number): boolean {
  const span = new Date(laterIso).getTime() - new Date(earlierIso).getTime();
  return span > GAP_FACTOR * intervalMinutes * 60_000;
}

export interface Point {
  t: number;
  v: number;
}

/** Splits points (any order) into runs that are in time order with no gap inside a run. */
export function splitAtGaps(points: Point[], intervalMinutes: number): Point[][] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const limit = GAP_FACTOR * intervalMinutes * 60_000;
  const runs: Point[][] = [];
  for (const p of sorted) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && p.t - last.t <= limit) run.push(p);
    else runs.push([p]);
  }
  return runs;
}
