import type { Reminder, ReminderKind } from '../api/types';
import { formatDate } from './dates';
import { daysBetween } from './reminderStatus';

export const KIND_LABELS: Record<ReminderKind, string> = {
  service: 'Service',
  insurance_renewal: 'Insurance renewal',
  road_tax_renewal: 'Road tax renewal',
};

/** Context label only. The app does not contact JPJ and states no fees, rates or periods. */
export const KIND_CONTEXT: Partial<Record<ReminderKind, string>> = {
  road_tax_renewal: 'Road tax (JPJ)',
};

export const KINDS: ReminderKind[] = ['service', 'insurance_renewal', 'road_tax_renewal'];

export const IN_APP_ONLY =
  'Reminders appear in this app only. There is no push, email or other notification.';

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "Due 12 Nov 2026 (in 21 days)" style text for the date part of a reminder. */
export function dateText(
  r: Pick<Reminder, 'due_date' | 'completed_on'>,
  today: string,
): string | null {
  if (r.due_date === null) return null;
  const base = `Due ${formatDate(r.due_date)}`;
  if (r.completed_on !== null) return base;
  const days = daysBetween(today, r.due_date);
  if (days === 0) return `${base} (today)`;
  if (days > 0) return `${base} (in ${plural(days, 'day', 'days')})`;
  return `${base} (${plural(-days, 'day', 'days')} overdue)`;
}

/** "Due at 20,000 km (1,200 km left)"; "odometer unknown" when there is no current odometer. */
export function kmText(
  r: Pick<Reminder, 'due_odometer' | 'completed_on'>,
  currentKm: number | null,
): string | null {
  if (r.due_odometer === null) return null;
  const base = `Due at ${r.due_odometer.toLocaleString()} km`;
  if (r.completed_on !== null) return base;
  if (currentKm === null) return `${base} (odometer unknown)`;
  const left = r.due_odometer - currentKm;
  if (left === 0) return `${base} (reached)`;
  if (left > 0) return `${base} (${left.toLocaleString()} km left)`;
  return `${base} (${(-left).toLocaleString()} km overdue)`;
}
