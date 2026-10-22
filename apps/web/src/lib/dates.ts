/**
 * Dates (YYYY-MM-DD) are calendar dates, not instants. They are displayed in the viewer's locale
 * without timezone conversion. Timestamps from the API are UTC and are shown in local time.
 */

const KL_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in Asia/Kuala_Lumpur (UTC+8, no DST): the date the server checks against. */
export function klToday(now: Date = new Date()): string {
  const parts = Object.fromEntries(KL_FORMAT.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, no timezone). */
export function addDays(iso: string, days: number): string {
  const m = DATE_RE.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Adds calendar months, clamping the day to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const m = DATE_RE.exec(iso);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + months;
  const day = Number(m[3]);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function formatDate(iso: string): string {
  const m = DATE_RE.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Shown under the date field of a service record. See RecordForm. */
export const DEFAULT_DATE_HINT =
  "The date defaults to today's date in Malaysia (Asia/Kuala_Lumpur), the date the server checks against. " +
  'Dates in the future are not accepted.';
