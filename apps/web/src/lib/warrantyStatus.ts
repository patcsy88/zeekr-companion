/**
 * The single pure function for warranty status (AC-51). The backend has the same rule in
 * services/api (warranty status service). Both are tested against
 * packages/shared-types/test-vectors/warranty-status.json.
 */
import { daysBetween } from './reminderStatus';

export type WarrantyStatusName = 'not_started' | 'active' | 'expiring_soon' | 'expired';
export type LimitKind = 'date' | 'odometer';

export interface WarrantyStatusInput {
  start_date: string;
  end_date: string | null;
  km_limit: number | null;
}

export interface WarrantyStatusResult {
  status: WarrantyStatusName;
  expired_by: LimitKind[];
  expiring_soon_by: LimitKind[];
}

export const EXPIRING_SOON_DAYS = 90;
export const EXPIRING_SOON_KM = 5000;

/** `today` is the Asia/Kuala_Lumpur date. `currentOdometerKm` null means unknown (km not evaluated). */
export function warrantyStatus(
  c: WarrantyStatusInput,
  currentOdometerKm: number | null,
  today: string,
): WarrantyStatusResult {
  const expired_by: LimitKind[] = [];
  if (c.end_date !== null && today > c.end_date) expired_by.push('date');
  if (c.km_limit !== null && currentOdometerKm !== null && currentOdometerKm > c.km_limit)
    expired_by.push('odometer');
  if (expired_by.length > 0) return { status: 'expired', expired_by, expiring_soon_by: [] };
  if (today < c.start_date) return { status: 'not_started', expired_by: [], expiring_soon_by: [] };
  const expiring_soon_by: LimitKind[] = [];
  if (c.end_date !== null && daysBetween(today, c.end_date) <= EXPIRING_SOON_DAYS)
    expiring_soon_by.push('date');
  if (
    c.km_limit !== null &&
    currentOdometerKm !== null &&
    c.km_limit - currentOdometerKm <= EXPIRING_SOON_KM
  )
    expiring_soon_by.push('odometer');
  return expiring_soon_by.length > 0
    ? { status: 'expiring_soon', expired_by: [], expiring_soon_by }
    : { status: 'active', expired_by: [], expiring_soon_by: [] };
}
