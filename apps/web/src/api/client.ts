import { expire, getToken } from '../auth/session';
import { reportReachable } from '../lib/connectivity';
import { isUuid } from '../lib/uuid';
import type { ApiErrorBody, FieldIssue } from './types';

const BASE = '/api/v1'; // relative: same origin, no CORS (ADR-002)
const TIMEOUT_MS = 15_000;

/** The API answered with an error status and the contract's error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldIssue[];
  readonly retryAfterSeconds: number | null;
  constructor(
    status: number,
    code: string,
    message: string,
    details: FieldIssue[] = [],
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * No usable answer from the API: the request failed, timed out, or something other than the API
 * answered (a proxy 502/503/504, an HTML page, plain text). Treated as "server unreachable".
 */
export class NetworkError extends Error {
  constructor(message = 'The server could not be reached.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** A request the client itself refused to make (a path outside the contract). Nothing was sent. */
export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** The login endpoint is the only call made without a token. */
  auth?: boolean;
}

export interface ApiResult<T> {
  status: number;
  data: T;
}

const QUERY_RE = /^[A-Za-z0-9_.~%=&-]*$/;

/**
 * Only the contract's paths are allowed: /auth/token, /vehicle, /service-records, /reminders,
 * /reminder-templates, /expenses, /warranty-coverages, /warranty-claims, /warranty-templates and the {uuid} forms of the three collections, lists with a plain query string. Anything else (traversal, encoded
 * slashes, other hosts) is refused before fetch is called.
 */
export function assertContractPath(path: string): void {
  const [pathname = '', query, ...extra] = path.split('?');
  const parts = pathname.split('/');
  if (parts[1] === 'advisory') {
    // Advisory (ADR-008): online only. Queries are allowed on the two lists.
    const sub = parts[2];
    const advisoryOk =
      extra.length === 0 &&
      parts[0] === '' &&
      ((parts.length === 3 && (sub === 'checks' || sub === 'status') && query === undefined) ||
        (parts.length === 3 &&
          (sub === 'proposals' || sub === 'model-calls') &&
          (query === undefined || QUERY_RE.test(query))) ||
        (parts.length === 4 && sub === 'proposals' && isUuid(parts[3]) && query === undefined));
    if (!advisoryOk) throw new ClientError('Refused a request outside the API contract.');
    return;
  }
  const ok =
    extra.length === 0 &&
    parts[0] === '' &&
    ((parts.length === 2 &&
      (parts[1] === 'vehicle' ||
        parts[1] === 'auth' ||
        parts[1] === 'service-records' ||
        parts[1] === 'reminders' ||
        parts[1] === 'expenses' ||
        parts[1] === 'warranty-coverages' ||
        parts[1] === 'warranty-claims' ||
        parts[1] === 'warranty-templates' ||
        parts[1] === 'reminder-templates')) ||
      (parts.length === 3 && parts[1] === 'auth' && parts[2] === 'token') ||
      (parts.length === 3 &&
        (parts[1] === 'service-records' ||
          parts[1] === 'reminders' ||
          parts[1] === 'expenses' ||
          parts[1] === 'warranty-coverages' ||
          parts[1] === 'warranty-claims') &&
        isUuid(parts[2])));
  const fullOk =
    ok &&
    (parts[1] !== 'auth' || parts[2] === 'token') &&
    (query === undefined ||
      ((parts[1] === 'service-records' || parts[1] === 'reminders' || parts[1] === 'expenses') &&
        parts.length === 2 &&
        QUERY_RE.test(query)));
  if (!fullOk) throw new ClientError('Refused a request outside the API contract.');
}

export function assertUuid(id: string): string {
  if (!isUuid(id)) throw new ClientError('Not a valid id.');
  return id;
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false;
  const e = v.error;
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof e.code === 'string' &&
    'message' in e &&
    typeof e.message === 'string'
  );
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}

/** Something that is not the API answered: report the server as unreachable. */
function notFromApi(): never {
  reportReachable(false);
  throw new NetworkError();
}

export async function request<T = undefined>(opts: RequestOptions): Promise<ApiResult<T>> {
  assertContractPath(opts.path);
  const authed = opts.auth !== false;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authed) {
    const token = getToken();
    if (token === null) {
      // No token: do not make a request that is certain to fail.
      throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
    }
    headers.Authorization = `Bearer ${token}`;
  }
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${opts.path}`, {
      method: opts.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return notFromApi();
  }

  let parsed: unknown;
  let jsonOk = false;
  if (res.status !== 204) {
    try {
      parsed = await res.json();
      jsonOk = true;
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    // An error counts as the API's only if it has the contract's error shape. A proxy 502/503/504
    // (plain text or HTML), or any other body, means the API was not reached.
    if (!isErrorBody(parsed)) return notFromApi();
    reportReachable(true);
    if (res.status === 401 && authed) expire();
    const { code, message, details } = parsed.error;
    throw new ApiError(
      res.status,
      code,
      message,
      Array.isArray(details) ? details : [],
      parseRetryAfter(res.headers.get('Retry-After')),
    );
  }
  // A success counts only if it is a 204 or JSON (an HTML fallback page is not the API).
  if (res.status !== 204 && !jsonOk) return notFromApi();
  reportReachable(true);
  return { status: res.status, data: parsed as T };
}
