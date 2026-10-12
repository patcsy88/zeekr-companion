import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ServiceRecord, Vehicle } from '../src/api/types';

/** In-memory fake of the contract. Disposable data only. */
export interface FakeApi {
  records: Map<string, ServiceRecord>;
  posts: unknown[];
  deletes: string[];
  rejectDate: boolean;
  down: boolean;
  tokenIssued: string | null;
  vehicle: Vehicle | null;
  /** Enforce the contract's UTC 'date not in the future' rule using the (possibly faked) clock. */
  utcDateRule: boolean;
}

export const fake: FakeApi = {
  records: new Map(),
  posts: [],
  deletes: [],
  rejectDate: false,
  down: false,
  tokenIssued: null,
  vehicle: null,
  utcDateRule: false,
};

export function resetFake(): void {
  fake.records.clear();
  fake.posts = [];
  fake.deletes = [];
  fake.rejectDate = false;
  fake.down = false;
  fake.tokenIssued = null;
  fake.vehicle = null;
  fake.utcDateRule = false;
}

export const err = (
  status: number,
  code: string,
  message: string,
  details: unknown[] = [],
  headers?: Record<string, string>,
) => HttpResponse.json({ error: { code, message, details } }, { status, headers });

export const handlers = [
  http.post('*/api/v1/auth/token', async ({ request }) => {
    const body = (await request.json()) as { password: string };
    if (body.password === 'correct-horse') {
      fake.tokenIssued = 'tok-test';
      return HttpResponse.json({ access_token: 'tok-test', expires_in: 3600 });
    }
    return err(401, 'unauthenticated', 'Invalid password.');
  }),
  http.get('*/api/v1/vehicle', () =>
    fake.vehicle
      ? HttpResponse.json(fake.vehicle)
      : err(404, 'not_found', 'No vehicle profile has been created yet.'),
  ),
  http.put('*/api/v1/vehicle', async ({ request }) => {
    const body = (await request.json()) as Vehicle;
    if (fake.vehicle && body.id !== fake.vehicle.id)
      return err(409, 'conflict', 'The vehicle profile already exists with a different id.');
    fake.vehicle = body;
    return HttpResponse.json(body);
  }),
  http.get('*/health', () => HttpResponse.json({ status: 'ok' })),
  http.get('*/api/v1/service-records', ({ request }) => {
    if (fake.down) return err(500, 'internal_error', 'Internal server error.');
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const cursor = url.searchParams.get('cursor');
    const all = [...fake.records.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    const start = cursor ? Number(cursor) : 0;
    const items = all.slice(start, start + limit);
    const next = start + limit < all.length ? String(start + limit) : null;
    return HttpResponse.json({ items, next_cursor: next });
  }),
  http.post('*/api/v1/service-records', async ({ request }) => {
    const body = (await request.json()) as ServiceRecord;
    fake.posts.push(body); // every attempt is recorded, even a refused one
    if (fake.down) return err(500, 'internal_error', 'Internal server error.');
    if (fake.utcDateRule && body.date > new Date().toISOString().slice(0, 10))
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'date', issue: 'must not be in the future' },
      ]);
    if (fake.rejectDate)
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'date', issue: 'must not be in the future' },
      ]);
    const existing = fake.records.get(body.id);
    if (existing) return HttpResponse.json(existing, { status: 200 });
    const rec: ServiceRecord = {
      ...body,
      currency: body.currency || 'MYR',
      created_at: '2026-10-11T10:00:00Z',
      updated_at: '2026-10-11T10:00:00Z',
    };
    fake.records.set(rec.id, rec);
    return HttpResponse.json(rec, { status: 201 });
  }),
  http.patch('*/api/v1/service-records/:id', async ({ request, params }) => {
    const rec = fake.records.get(String(params.id));
    if (!rec) return err(404, 'not_found', 'Service record not found.');
    const updated = { ...rec, ...((await request.json()) as object) };
    fake.records.set(rec.id, updated);
    return HttpResponse.json(updated);
  }),
  http.delete('*/api/v1/service-records/:id', ({ params }) => {
    const id = String(params.id);
    fake.deletes.push(id);
    if (!fake.records.delete(id)) return err(404, 'not_found', 'Service record not found.');
    return new HttpResponse(null, { status: 204 });
  }),
];

export const server = setupServer(...handlers);
