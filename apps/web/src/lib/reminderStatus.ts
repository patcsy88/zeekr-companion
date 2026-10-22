/**
 * The single pure function for reminder status (AC-17). The backend has the same rule in
 * services/api/app/services/reminder_status.py. Both are tested against
 * packages/shared-types/test-vectors/reminder-status.json.
 */
export type ReminderStatusValue = 'upcoming' | 'overdue' | 'completed';
export type OverdueBy = 'date' | 'odometer';

export interface StatusInput {
  due_date: string | null;
  due_odometer: number | null;
  completed_on: string | null;
}

export interface StatusResult {
  status: ReminderStatusValue;
  overdue_by: OverdueBy[];
}

/** `today` is the Asia/Kuala_Lumpur date. `currentOdometerKm` null means unknown. */
export function computeStatus(
  reminder: StatusInput,
  currentOdometerKm: number | null,
  today: string,
): StatusResult {
  if (reminder.completed_on !== null) return { status: 'completed', overdue_by: [] };
  const overdue_by: OverdueBy[] = [];
  // ISO dates compare correctly as strings.
  if (reminder.due_date !== null && today > reminder.due_date) overdue_by.push('date');
  if (
    reminder.due_odometer !== null &&
    currentOdometerKm !== null &&
    currentOdometerKm > reminder.due_odometer
  )
    overdue_by.push('odometer');
  return overdue_by.length > 0
    ? { status: 'overdue', overdue_by }
    : { status: 'upcoming', overdue_by };
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  const ms =
    Date.UTC(b[0] ?? 0, (b[1] ?? 1) - 1, b[2] ?? 1) -
    Date.UTC(a[0] ?? 0, (a[1] ?? 1) - 1, a[2] ?? 1);
  return Math.round(ms / 86_400_000);
}

export const DUE_SOON_DAYS = 30;
export const DUE_SOON_KM = 1000;

/** Display only ("due soon" is 30 days or 1,000 km). It never changes the status. */
export function isDueSoon(
  reminder: StatusInput,
  currentOdometerKm: number | null,
  today: string,
): boolean {
  if (reminder.completed_on !== null) return false;
  const byDate =
    reminder.due_date !== null &&
    daysBetween(today, reminder.due_date) >= 0 &&
    daysBetween(today, reminder.due_date) <= DUE_SOON_DAYS;
  const byKm =
    reminder.due_odometer !== null &&
    currentOdometerKm !== null &&
    reminder.due_odometer - currentOdometerKm >= 0 &&
    reminder.due_odometer - currentOdometerKm <= DUE_SOON_KM;
  return byDate || byKm;
}
