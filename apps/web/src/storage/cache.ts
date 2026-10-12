import { getDb } from './db';

export interface Cached<T> {
  value: T;
  fetched_at: string;
}

export async function getCache<T>(key: string): Promise<Cached<T> | undefined> {
  const row = await (await getDb()).get('cache', key);
  return row ? { value: row.value as T, fetched_at: row.fetched_at } : undefined;
}

export async function setCache(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('cache', { key, value, fetched_at: new Date().toISOString() });
}

export async function deleteCache(key: string): Promise<void> {
  await (await getDb()).delete('cache', key);
}

export async function clearCache(): Promise<void> {
  await (await getDb()).clear('cache');
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await (await getDb()).get('meta', key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta', { key, value });
}
