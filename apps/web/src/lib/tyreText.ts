import type { TyreKind, TyreWheel } from '../api/types';

export const TYRE_KINDS: TyreKind[] = ['replace', 'rotate', 'repair', 'alignment', 'balancing'];

export const KIND_LABELS: Record<TyreKind, string> = {
  replace: 'Replace',
  rotate: 'Rotate',
  repair: 'Repair',
  alignment: 'Alignment',
  balancing: 'Balancing',
};

/** The fixed order the server stores and returns (AC-76). Names match the live card. */
export const WHEELS: TyreWheel[] = [
  'driver_front',
  'passenger_front',
  'driver_rear',
  'passenger_rear',
];

export const WHEEL_LABELS: Record<TyreWheel, string> = {
  driver_front: 'Driver front',
  passenger_front: 'Passenger front',
  driver_rear: 'Driver rear',
  passenger_rear: 'Passenger rear',
};

/** "All four", or the wheels in the fixed order. */
export function wheelsText(wheels: TyreWheel[]): string {
  if (WHEELS.every((w) => wheels.includes(w))) return 'All four';
  return WHEELS.filter((w) => wheels.includes(w))
    .map((w) => WHEEL_LABELS[w])
    .join(', ');
}

export const NOT_IN_EXPENSES =
  'Tyre costs are not included in Expenses. If you want a cost in your expense totals, add it there as a Tyres expense too.';

export const ROTATION_TITLE = 'Rotate tyres';

/** The vehicle tyre specification prefills the size only when it fits the size field (T6). */
export const MAX_SIZE = 50;
