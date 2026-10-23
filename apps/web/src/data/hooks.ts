import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession } from '../auth/session';
import { getConnectivity, subscribeConnectivity } from '../lib/connectivity';
import { subscribeData } from '../lib/events';
import { getMeta } from '../storage/cache';
import { countQueue } from '../storage/queue';
import { getSyncStatus, subscribeSync } from '../sync/engine';
import {
  readRecord,
  readRecords,
  readVehicle,
  type RecordsSnapshot,
  type VehicleSnapshot,
} from './repository';
import type { RecordView } from './overlay';
import type { ReminderView } from './reminderOverlay';
import type { ExpenseView } from './expenseOverlay';
import { readExpense, readExpenses, type ExpensesSnapshot } from './expenses';
import {
  readReminder,
  readReminders,
  readTemplates,
  type OdometerBasis,
  type RemindersSnapshot,
} from './reminders';
import type { ReminderTemplate, WarrantyTemplate } from '../api/types';
import { readWarranty, readWarrantyTemplates, type WarrantySnapshot } from './warranty';

export const useSession = () => useSyncExternalStore(subscribeSession, getSession);
export const useConnectivity = () => useSyncExternalStore(subscribeConnectivity, getConnectivity);
export const useSyncStatus = () => useSyncExternalStore(subscribeSync, getSyncStatus);

/** Re-reads from IndexedDB whenever cache or queue change. `undefined` while the first read runs. */
function useLocal<T>(read: () => Promise<T>, key: string): T | undefined {
  const [value, setValue] = useState<T>();
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  useEffect(() => {
    let live = true;
    const load = () => {
      void readRef.current().then((v) => {
        if (live) setValue(v);
      });
    };
    load();
    const unsub = subscribeData(load);
    return () => {
      live = false;
      unsub();
    };
  }, [key]);
  return value;
}

export function useRecords(): RecordsSnapshot | undefined {
  return useLocal(readRecords, 'records');
}
export function useRecord(id: string): { view: RecordView | null } | undefined {
  const v = useLocal(async () => ({ view: await readRecord(id) }), `record:${id}`);
  return v;
}
export function useVehicle(): VehicleSnapshot | undefined {
  return useLocal(readVehicle, 'vehicle');
}
export function useQueueCounts(): { pending: number; failed: number; blocked: number } {
  return useLocal(countQueue, 'counts') ?? { pending: 0, failed: 0, blocked: 0 };
}
export function useLastSynced(): string | null {
  return useLocal(async () => (await getMeta<string>('last_synced_at')) ?? null, 'last') ?? null;
}

export function useExpenses(): ExpensesSnapshot | undefined {
  return useLocal(readExpenses, 'expenses');
}
export function useExpense(id: string): { view: ExpenseView | null } | undefined {
  return useLocal(() => readExpense(id), `expense:${id}`);
}

export function useReminders(): RemindersSnapshot | undefined {
  return useLocal(readReminders, 'reminders');
}
export function useReminder(
  id: string,
): { view: ReminderView | null; basis: OdometerBasis | null; today: string } | undefined {
  return useLocal(() => readReminder(id), `reminder:${id}`);
}
export function useTemplates(): { loaded: boolean; items: ReminderTemplate[] } | undefined {
  return useLocal(readTemplates, 'templates');
}

export function useWarranty(): WarrantySnapshot | undefined {
  return useLocal(readWarranty, 'warranty');
}
export function useWarrantyTemplates(): { loaded: boolean; items: WarrantyTemplate[] } | undefined {
  return useLocal(readWarrantyTemplates, 'warranty-templates');
}
