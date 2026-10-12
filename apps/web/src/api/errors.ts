import { ApiError, ClientError, NetworkError } from './client';

export interface DescribeOptions {
  /** True only where the change really is stored on this device (queued writes). */
  saved?: boolean;
}

const SAVED = 'Your changes are saved on this device and will sync later.';

/** Human text for a failed request. Never shows raw proxy or server text. */
export function describeError(e: unknown, opts: DescribeOptions = {}): string {
  if (e instanceof NetworkError) {
    return opts.saved
      ? `The server is unavailable. ${SAVED}`
      : 'The server is unavailable. Try again in a moment.';
  }
  if (e instanceof ApiError) {
    if (e.status === 429) return rateLimitMessage(e.retryAfterSeconds);
    if (e.status === 401) return 'The password was not accepted.';
    if (e.status >= 500) {
      return opts.saved
        ? `The server had a problem. ${SAVED}`
        : 'The server had a problem. Try again in a moment.';
    }
    return e.message;
  }
  if (e instanceof ClientError) return 'Something went wrong.';
  return 'Something went wrong.';
}

export function rateLimitMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) return 'Too many attempts. Try again later.';
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}
