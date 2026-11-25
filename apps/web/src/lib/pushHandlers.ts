/**
 * Push handling for the service worker (ADR-014). Kept apart from sw.ts so jsdom can test it.
 * The payload comes from our own API: a fixed text and the page to open. Nothing else is trusted:
 * the page must be one of our own routes, so a notification can never open another site.
 */

const TITLE = 'Zeekr Companion';
const DEFAULT_URL = '/sentry';
const ALLOWED_URLS = new Set(['/sentry', '/geofence', '/vehicle']);

export interface PushView {
  title: string;
  body: string;
  url: string;
}

export function parsePush(raw: string | null): PushView {
  let body = 'Car alert.';
  let url = DEFAULT_URL;
  if (raw) {
    try {
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        const b = (data as Record<string, unknown>).body;
        const u = (data as Record<string, unknown>).url;
        if (typeof b === 'string' && b.length > 0) body = b.slice(0, 200);
        if (typeof u === 'string' && ALLOWED_URLS.has(u)) url = u;
      }
    } catch {
      // Not JSON: keep the fixed defaults.
    }
  }
  return { title: TITLE, body, url };
}

export interface WindowLike {
  url: string;
  focus: () => Promise<unknown>;
  navigate?: (url: string) => Promise<unknown>;
}

export interface WorkerScopeLike {
  registration: {
    showNotification: (
      title: string,
      options: { body: string; data: { url: string } },
    ) => Promise<void>;
  };
  clients: {
    matchAll: (opts: { type: 'window'; includeUncontrolled: boolean }) => Promise<WindowLike[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
}

export function showPush(scope: WorkerScopeLike, raw: string | null): Promise<void> {
  const view = parsePush(raw);
  return scope.registration.showNotification(view.title, {
    body: view.body,
    data: { url: view.url },
  });
}

/** Tap: focus an open window of the app and send it to the page, else open the page. */
export async function openFromNotification(
  scope: WorkerScopeLike,
  data: unknown,
  origin: string,
): Promise<void> {
  const raw =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>).url : undefined;
  const url = typeof raw === 'string' && ALLOWED_URLS.has(raw) ? raw : DEFAULT_URL;
  const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const mine = windows.find((w) => w.url.startsWith(origin));
  if (mine) {
    if (mine.navigate) await mine.navigate(url);
    await mine.focus();
    return;
  }
  await scope.clients.openWindow(url);
}
