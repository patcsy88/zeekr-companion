/**
 * Optional error reporting to Sentry (ADR-007). Off unless VITE_SENTRY_DSN was set at build time.
 * Records, amounts, the username and tokens must never leave the phone, so events are rebuilt from
 * an allow-list: exception type, stack frames (file, function, line) and the URL path only.
 */
import * as Sentry from '@sentry/browser';

type Json = Record<string, unknown>;

const KEEP_FRAME_KEYS = ['filename', 'function', 'lineno', 'colno', 'in_app'] as const;

function pathOnly(url: unknown): string {
  if (typeof url !== 'string') return '';
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return '';
  }
}

export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const src = event as unknown as Json;
  const clean: Json = {};
  for (const k of ['event_id', 'timestamp', 'level', 'platform', 'release', 'environment']) {
    if (k in src) clean[k] = src[k];
  }
  const req = src.request as Json | undefined;
  if (req) clean.request = { url: pathOnly(req.url) };
  const values = (src.exception as { values?: Json[] } | undefined)?.values ?? [];
  if (values.length > 0) {
    clean.exception = {
      values: values.map((v) => {
        const out: Json = { type: v.type };
        const frames = ((v.stacktrace as { frames?: Json[] } | undefined)?.frames ?? []).map(
          (f) => {
            const kept: Json = {};
            for (const k of KEEP_FRAME_KEYS) if (k in f) kept[k] = f[k];
            // Drop the query string and fragment that a bundled file URL could carry.
            if (typeof kept.filename === 'string') kept.filename = pathOnly(kept.filename);
            return kept;
          },
        );
        if (frames.length > 0) out.stacktrace = { frames };
        return out;
      }),
    };
  }
  return clean as unknown as Sentry.ErrorEvent;
}

export function initSentry(dsn: string | undefined, release?: string): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    release,
    environment: 'production',
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return true;
}
