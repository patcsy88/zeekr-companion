import { reportReachable } from '../lib/connectivity';

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Asks the proxy's /health (no token needed) whether the API is really behind it. Only
 * {"status":"ok"} counts. A proxy error page, HTML, or a network failure means unreachable.
 */
export async function probeApi(): Promise<boolean> {
  let ok = false;
  try {
    const res = await fetch('/health', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      ok = typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
    }
  } catch {
    ok = false;
  }
  reportReachable(ok);
  return ok;
}
