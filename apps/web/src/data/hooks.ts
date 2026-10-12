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
export function useQueueCounts(): { pending: number; failed: number } {
  return useLocal(countQueue, 'counts') ?? { pending: 0, failed: 0 };
}
export function useLastSynced(): string | null {
  return useLocal(async () => (await getMeta<string>('last_synced_at')) ?? null, 'last') ?? null;
}
