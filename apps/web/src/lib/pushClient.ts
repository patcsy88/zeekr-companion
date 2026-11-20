/**
 * Browser side of push (ADR-014). Every call that asks the phone for something runs from a button
 * tap (iOS requires it). The address and keys go to our own API only and are never shown or logged.
 */
import { request } from '../api/client';
import type { PushDevices } from '../api/types';

export type PushSupport = 'supported' | 'unsupported';

export function pushSupport(): PushSupport {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    ? 'supported'
    : 'unsupported';
}

export function permission(): NotificationPermission {
  return Notification.permission;
}

/** The public key arrives as URL-safe base64; the browser wants the raw bytes. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  return (await registration()).pushManager.getSubscription();
}

export type TurnOn = 'on' | 'denied' | 'failed';

/** Asks for permission, subscribes this phone, and saves it on the server. */
export async function turnOn(publicKey: string): Promise<{ result: TurnOn; devices?: number }> {
  const asked = await Notification.requestPermission();
  if (asked !== 'granted') return { result: 'denied' };
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return { result: 'failed' };
  const r = await request<PushDevices>({
    method: 'POST',
    path: '/push/subscriptions',
    body: { endpoint: json.endpoint, keys: { p256dh, auth } },
  });
  return { result: 'on', devices: r.data.devices };
}

/** Removes this phone from the server first, then from the browser. */
export async function turnOff(): Promise<number | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const r = await request<PushDevices>({
    method: 'DELETE',
    path: '/push/subscriptions',
    body: { endpoint: sub.endpoint },
  });
  await sub.unsubscribe();
  return r.data.devices;
}
