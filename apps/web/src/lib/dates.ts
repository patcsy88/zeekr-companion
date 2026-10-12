/**
 * Dates (YYYY-MM-DD) are calendar dates, not instants. They are displayed in the viewer's locale
 * without timezone conversion. Timestamps from the API are UTC and are shown in local time.
 */

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
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
  "The date defaults to today's date in UTC, which is the date the server checks against. " +
  'Between 00:00 and 08:00 Malaysian time, picking a later local date can be rejected.';

export const UTC_DATE_EXPLANATION =
  'The server checks dates against the current date in UTC. Between 00:00 and 08:00 Malaysian time, ' +
  "today's local date is still ahead of the UTC date, so it is rejected. " +
  'Save again after 08:00 Malaysian time, or choose an earlier date.';
