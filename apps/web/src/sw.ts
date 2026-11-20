/**
 * The service worker (ADR-014 turned the generated one into this file). It keeps what the generated
 * one did: the app shell is precached and nothing under /api is ever cached. Updates stay
 * user-confirmed (no skipWaiting, no clientsClaim). It adds two handlers: show a push, and open the
 * Sentry tab when the notification is tapped. Typed with small local shapes so the DOM types stay.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { openFromNotification, showPush, type WorkerScopeLike } from './lib/pushHandlers';

interface WorkerEvent {
  waitUntil: (p: Promise<unknown>) => void;
}
interface PushEventLike extends WorkerEvent {
  data: { text: () => string } | null;
}
interface ClickEventLike extends WorkerEvent {
  notification: { close: () => void; data: unknown };
}
interface MessageEventLike {
  data: { type?: string } | null;
}
declare global {
  interface Window {
    __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
  }
}

interface Scope extends WorkerScopeLike {
  location: { origin: string };
  skipWaiting: () => Promise<void>;
  addEventListener: (type: string, listener: (event: never) => void) => void;
}

const scope = self as unknown as Scope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/health/],
  }),
);

scope.addEventListener('message', (event: MessageEventLike) => {
  if (event.data?.type === 'SKIP_WAITING') void scope.skipWaiting();
});

scope.addEventListener('push', (event: PushEventLike) => {
  event.waitUntil(showPush(scope, event.data ? event.data.text() : null));
});

scope.addEventListener('notificationclick', (event: ClickEventLike) => {
  event.notification.close();
  event.waitUntil(openFromNotification(scope, event.notification.data, scope.location.origin));
});
