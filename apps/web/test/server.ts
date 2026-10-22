import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Reminder, ReminderTemplate, ServiceRecord, Vehicle } from '../src/api/types';
import { klToday } from '../src/lib/dates';

/** In-memory fake of the contract. Disposable data only. */
export interface FakeApi {
  records: Map<string, ServiceRecord>;
  posts: unknown[];
  deletes: string[];
  rejectDate: boolean;
  down: boolean;
  tokenIssued: string | null;
  vehicle: Vehicle | null;
  /** Enforce the contract's 'date not in the future' rule (Asia/Kuala_Lumpur date) using the (possibly faked) clock. */
  klDateRule: boolean;
  reminders: Map<string, Reminder>;
  reminderPosts: unknown[];
  reminderPatches: unknown[];
  reminderDeletes: string[];
  /** Status codes to answer the next reminder POSTs with, one per call. */
  reminderPostFailures: number[];
  reminderGets: number;
  templateGets: number;
  templates: ReminderTemplate[];
}

export const TEMPLATE: ReminderTemplate = {
  id: 'awd-performance-service',
  version: 1,
  name: 'AWD Performance service schedule',
  kind: 'service',
  source: {
    title: 'Zeekr Malaysia Service Maintenance Schedule and Pricing (PDF)',
    url: 'https://assets.zeekrlife.com/assets/my/Service_Maintenance_Schedule_And_Pricing.pdf',
    research_ref: 'M12',
    status: 'verified',
    retrieved: '2026-10-22',
  },
  caveat:
    'Requirements vary by model, build date, operating conditions and local rules. Confirm against your own booklet or service centre.',
  interval: { km: 20000, months: 12, rule: 'whichever comes first' },
  baseline_required: true,
  checkpoints: [1, 2, 3, 4].map((n) => ({
    number: n,
    km: n * 20000,
    months: n * 12,
    work_items: n % 2 === 0 ? ['Maintenance inspection', 'Cabin air filter replacement'] : [],
    work_items_stated: n % 2 === 0,
  })),
};

export const fake: FakeApi = {
  records: new Map(),
  posts: [],
  deletes: [],
  rejectDate: false,
  down: false,
  tokenIssued: null,
  vehicle: null,
  klDateRule: false,
  reminders: new Map(),
  reminderPosts: [],
  reminderPatches: [],
  reminderDeletes: [],
  reminderPostFailures: [],
  reminderGets: 0,
  templateGets: 0,
  templates: [TEMPLATE],
};

export function resetFake(): void {
  fake.records.clear();
  fake.posts = [];
  fake.deletes = [];
  fake.rejectDate = false;
  fake.down = false;
  fake.tokenIssued = null;
  fake.vehicle = null;
  fake.klDateRule = false;
  fake.reminders.clear();
  fake.reminderPosts = [];
  fake.reminderPatches = [];
  fake.reminderDeletes = [];
  fake.reminderPostFailures = [];
  fake.reminderGets = 0;
  fake.templateGets = 0;
  fake.templates = [TEMPLATE];
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
    if (fake.klDateRule && body.date > klToday())
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

const STAMP = '2026-10-11T10:00:00Z';

export const reminderHandlers = [
  http.get('*/api/v1/reminders', () => {
    fake.reminderGets += 1;
    const newest = [...fake.records.values()].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return HttpResponse.json({
      items: [...fake.reminders.values()],
      current_odometer: newest
        ? {
            km: newest.odometer,
            source: 'latest_service_record',
            service_record_id: newest.id,
            date: newest.date,
          }
        : null,
    });
  }),
  http.post('*/api/v1/reminders', async ({ request }) => {
    const body = (await request.json()) as Reminder;
    fake.reminderPosts.push(body);
    const fail = fake.reminderPostFailures.shift();
    if (fail === 400)
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'title', issue: 'rejected by test' },
      ]);
    if (fail !== undefined && fail !== 0)
      return err(fail, 'internal_error', 'Internal server error.');
    const existing = fake.reminders.get(body.id);
    if (existing) return HttpResponse.json(existing, { status: 200 });
    const rem: Reminder = {
      ...body,
      due_date: body.due_date ?? null,
      due_odometer: body.due_odometer ?? null,
      notes: body.notes ?? null,
      template_ref: body.template_ref ?? null,
      completed_on: null,
      status: 'upcoming',
      overdue_by: [],
      created_at: STAMP,
      updated_at: STAMP,
    };
    fake.reminders.set(rem.id, rem);
    return HttpResponse.json(rem, { status: 201 });
  }),
  http.patch('*/api/v1/reminders/:id', async ({ request, params }) => {
    const rem = fake.reminders.get(String(params.id));
    if (!rem) return err(404, 'not_found', 'Reminder not found.');
    const patch = (await request.json()) as object;
    fake.reminderPatches.push(patch);
    const updated = { ...rem, ...patch };
    fake.reminders.set(rem.id, updated);
    return HttpResponse.json(updated);
  }),
  http.delete('*/api/v1/reminders/:id', ({ params }) => {
    const id = String(params.id);
    fake.reminderDeletes.push(id);
    if (!fake.reminders.delete(id)) return err(404, 'not_found', 'Reminder not found.');
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/reminder-templates', () => {
    fake.templateGets += 1;
    return HttpResponse.json({ items: fake.templates });
  }),
];

export const server = setupServer(...handlers, ...reminderHandlers);
