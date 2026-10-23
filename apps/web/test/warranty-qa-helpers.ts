import type { WarrantyClaim, WarrantyCoverage } from '../src/api/types';
import { klToday } from '../src/lib/dates';
import { server } from './server';

export const STAMP = '2026-10-01T00:00:00Z';
export const cid = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const lid = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const rid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function plusDays(n: number, from: string = klToday()): string {
  const [y, m, d] = from.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

export function cov(id: string, over: Partial<WarrantyCoverage> = {}): WarrantyCoverage {
  return {
    id,
    name: 'Fictional coverage',
    provider_type: 'factory',
    start_date: '2025-01-01',
    end_date: plusDays(400),
    km_limit: null,
    notes: null,
    source_kind: 'owner_entered',
    verification_status: 'unverified',
    source_note: null,
    template_ref: null,
    status: 'active',
    expired_by: [],
    expiring_soon_by: [],
    claim_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}

export function claim(
  id: string,
  coverageId: string,
  over: Partial<WarrantyClaim> = {},
): WarrantyClaim {
  return {
    id,
    coverage_id: coverageId,
    date: '2026-09-01',
    odometer: 1000,
    description: 'Fictional claim',
    status: 'submitted',
    cost_covered_minor: null,
    currency: 'MYR',
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  };
}

export interface Traced {
  method: string;
  path: string;
  host: string;
  /** Parsed JSON body once it has been read (writes only). */
  body: unknown;
}

/** Records every request the app makes (all methods), so tests can spy on every POST. */
export function startTrace(): Traced[] {
  const out: Traced[] = [];
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    const t: Traced = { method: request.method, path: u.pathname, host: u.host, body: undefined };
    out.push(t);
    if (request.method !== 'GET') {
      void request
        .clone()
        .text()
        .then((x) => {
          try {
            t.body = x ? (JSON.parse(x) as unknown) : null;
          } catch {
            t.body = x;
          }
        });
    }
  });
  return out;
}

export function stopTrace(): void {
  server.events.removeAllListeners();
}

export const writesOf = (t: Traced[], method: string, pathPart: string) =>
  t.filter((x) => x.method === method && x.path.includes(pathPart));
