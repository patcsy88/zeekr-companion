import type { ServiceRecordCreate, ServiceRecordPatch, Vehicle } from '../api/types';
import { getSession } from '../auth/session';
import { isOnline } from '../lib/connectivity';
import { flush } from '../sync/engine';
import { enqueueCreate, enqueueDelete, enqueueEdit, enqueuePutVehicle } from '../storage/queue';

/**
 * All writes go through the queue first (write-ahead), then a flush is attempted. That gives one
 * code path for online and offline, and an interrupted request is simply resent with the same id.
 */
async function afterEnqueue(): Promise<void> {
  if (isOnline() && getSession().signedIn) await flush(true);
}

export async function saveNewRecord(body: ServiceRecordCreate): Promise<void> {
  await enqueueCreate(body);
  await afterEnqueue();
}

export async function saveRecordEdit(id: string, patch: ServiceRecordPatch): Promise<void> {
  await enqueueEdit(id, patch);
  await afterEnqueue();
}

export async function removeRecord(id: string): Promise<void> {
  await enqueueDelete(id);
  await afterEnqueue();
}

export async function saveVehicle(vehicle: Vehicle): Promise<void> {
  await enqueuePutVehicle(vehicle);
  await afterEnqueue();
}
