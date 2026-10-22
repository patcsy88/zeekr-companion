import { getReminderTemplates, listReminders } from '../api/endpoints';
import type { CurrentOdometer, Reminder, ReminderTemplate } from '../api/types';
import { bumpEpoch, notifyData } from '../lib/events';
import { klToday } from '../lib/dates';
import { getCache, setCache } from '../storage/cache';
import { listQueue } from '../storage/queue';
import { overlayReminders, type ReminderView } from './reminderOverlay';
import { readRecords, refreshGuarded, withCacheLock, markSynced } from './repository';

const REMINDERS_KEY = 'reminders';
const TEMPLATES_KEY = 'reminder-templates';

interface ReminderCache {
  items: Reminder[];
  current_odometer: CurrentOdometer | null;
}

export interface OdometerBasis {
  km: number;
  /** Date of the service record the odometer comes from. */
  date: string | null;
  /** True when the number comes from a record that is saved only on this device so far. */
  unsent: boolean;
}

export interface RemindersSnapshot {
  /** False until the list has been fetched at least once on this device. */
  loaded: boolean;
  views: ReminderView[];
  basis: OdometerBasis | null;
  today: string;
  fetchedAt: string | null;
}

/**
 * The current odometer is the odometer of the newest service record. The device uses its own
 * records (cache plus unsent queue) when it has them, and the server's value otherwise.
 */
async function deriveBasis(cached: ReminderCache | undefined): Promise<OdometerBasis | null> {
  const records = await readRecords();
  const newest = records.views[0];
  if (newest) {
    return {
      km: newest.record.odometer,
      date: newest.record.date,
      unsent: newest.sync !== 'synced',
    };
  }
  if (records.loaded) return null;
  const co = cached?.current_odometer;
  return co ? { km: co.km, date: co.date, unsent: false } : null;
}

export async function readReminders(): Promise<RemindersSnapshot> {
  const [cached, queue] = await Promise.all([getCache<ReminderCache>(REMINDERS_KEY), listQueue()]);
  const basis = await deriveBasis(cached?.value);
  const today = klToday();
  return {
    loaded: cached !== undefined,
    views: overlayReminders(cached?.value.items ?? [], queue, basis?.km ?? null, today),
    basis,
    today,
    fetchedAt: cached?.fetched_at ?? null,
  };
}

export async function readReminder(
  id: string,
): Promise<{ view: ReminderView | null; basis: OdometerBasis | null; today: string }> {
  const snap = await readReminders();
  return {
    view: snap.views.find((v) => v.reminder.id === id) ?? null,
    basis: snap.basis,
    today: snap.today,
  };
}

export async function refreshReminders(): Promise<void> {
  await refreshGuarded(
    () => listReminders(),
    (page) =>
      setCache(REMINDERS_KEY, {
        items: page.items,
        current_odometer: page.current_odometer ?? null,
      } satisfies ReminderCache),
  );
  await markSynced();
  notifyData();
}

export async function readTemplates(): Promise<{ loaded: boolean; items: ReminderTemplate[] }> {
  const cached = await getCache<{ items: ReminderTemplate[] }>(TEMPLATES_KEY);
  return { loaded: cached !== undefined, items: cached?.value.items ?? [] };
}

/** The template is static server data: fetched at most when the device is online, then cached. */
export async function refreshTemplates(): Promise<void> {
  const list = await getReminderTemplates();
  await withCacheLock(async () => {
    await setCache(TEMPLATES_KEY, { items: list.items });
    bumpEpoch();
  });
  notifyData();
}

async function upsertUnlocked(reminder: Reminder): Promise<void> {
  const cached = await getCache<ReminderCache>(REMINDERS_KEY);
  const items = (cached?.value.items ?? []).filter((r) => r.id !== reminder.id);
  items.push(reminder);
  await setCache(REMINDERS_KEY, {
    items,
    current_odometer: cached?.value.current_odometer ?? null,
  } satisfies ReminderCache);
}

export function upsertReminderInCache(reminder: Reminder): Promise<void> {
  return withCacheLock(async () => {
    await upsertUnlocked(reminder);
    bumpEpoch();
  });
}

export function removeReminderFromCache(id: string): Promise<void> {
  return withCacheLock(async () => {
    const cached = await getCache<ReminderCache>(REMINDERS_KEY);
    if (cached) {
      await setCache(REMINDERS_KEY, {
        items: cached.value.items.filter((r) => r.id !== id),
        current_odometer: cached.value.current_odometer,
      } satisfies ReminderCache);
    }
    bumpEpoch();
  });
}
