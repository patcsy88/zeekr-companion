import type { ExpenseCategory } from '../api/types';

export const CATEGORIES: ExpenseCategory[] = [
  'charging',
  'insurance',
  'road_tax',
  'parking',
  'tolls',
  'tyres',
  'accessories',
  'cleaning',
  'fines',
  'warranty',
  'other',
];

/** "Road tax (JPJ)" is a context label only (AC-34). */
export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  charging: 'Charging',
  insurance: 'Insurance',
  road_tax: 'Road tax (JPJ)',
  parking: 'Parking',
  tolls: 'Tolls',
  tyres: 'Tyres',
  accessories: 'Accessories',
  cleaning: 'Cleaning',
  fines: 'Fines',
  warranty: 'Warranty',
  other: 'Other',
};

export const NOT_INCLUDED =
  'Service record costs are not included. Expenses are separate from service records, so nothing is counted twice unless you enter the same cost in both places.';

export const COMPUTED_ON_DEVICE =
  'Totals are computed on this device from the expenses saved here, including changes not yet sent, so they are also right offline.';

export function isCategory(v: string | null): v is ExpenseCategory {
  return v !== null && (CATEGORIES as string[]).includes(v);
}
