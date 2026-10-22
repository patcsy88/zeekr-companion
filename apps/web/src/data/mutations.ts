import type {
  ReminderCreate,
  ReminderEdit,
  ServiceRecordCreate,
  ServiceRecordPatch,
  Vehicle,
} from '../api/types';
import { getSession } from '../auth/session';
import { isOnline } from '../lib/connectivity';
import { flush } from '../sync/engine';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueEdit,
  enqueuePutVehicle,
  enqueueReminderCreate,
  enqueueReminderDelete,
  enqueueReminderEdit,
} from '../storage/queue';

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

export async function saveNewReminder(body: ReminderCreate): Promise<void> {
  await enqueueReminderCreate(body);
  await afterEnqueue();
}

export async function saveReminderEdit(id: string, patch: ReminderEdit): Promise<void> {
  await enqueueReminderEdit(id, patch);
  await afterEnqueue();
}

export async function removeReminder(id: string): Promise<void> {
  await enqueueReminderDelete(id);
  await afterEnqueue();
}

/**
 * Template accept: one ordinary create per selected item, queued together and then sent. Items
 * fail independently in the queue; nothing here creates a reminder the owner did not select.
 */
export async function saveReminderBatch(items: ReminderCreate[]): Promise<void> {
  for (const body of items) await enqueueReminderCreate(body);
  await afterEnqueue();
}
