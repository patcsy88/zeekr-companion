import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type {
  Expense,
  Reminder,
  ReminderTemplate,
  ServiceRecord,
  Vehicle,
  WarrantyClaim,
  WarrantyCoverage,
  WarrantyTemplate,
} from '../src/api/types';
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
  expenses: Map<string, Expense>;
  expensePosts: unknown[];
  expensePatches: unknown[];
  expenseDeletes: string[];
  /** Status codes to answer the next expense POSTs with, one per call (0 = succeed). */
  expensePostFailures: number[];
  /** Page size the fake list uses regardless of `limit` (to force several pages). */
  expensePageCap: number | null;
  expenseGets: number;
  coverages: Map<string, WarrantyCoverage>;
  claims: Map<string, WarrantyClaim>;
  coveragePosts: WarrantyCoverage[];
  claimPosts: WarrantyClaim[];
  coverageDeletes: string[];
  claimDeletes: string[];
  /** Status codes for the next coverage / claim POSTs, one per call (0 = succeed). */
  coveragePostFailures: number[];
  claimPostFailures: number[];
  warrantyGets: number;
  warrantyTemplateGets: number;
  warrantyTemplates: WarrantyTemplate[];
}

export const WARRANTY_TEMPLATE: WarrantyTemplate = {
  id: 'my-factory-warranty',
  version: 1,
  name: 'Zeekr Malaysia factory warranty terms',
  source: {
    title: 'Zeekr Malaysia Warranty (PDF)',
    url: 'https://assets.zeekrlife.com/assets/my/Warranty.pdf',
    research_ref: 'M8, M9, M10',
    status: 'verified',
    retrieved: '2026-10-22',
  },
  caveat:
    'Terms, scope, exclusions and conditions vary by build date, usage and local rules. Confirm against your own warranty booklet or service centre.',
  baseline_required: true,
  items: [
    { key: 'general', name: 'Vehicle warranty', months: 60, km: 150000, research_ref: 'M8' },
    {
      key: 'powertrain',
      name: 'Electric powertrain warranty',
      months: 96,
      km: 160000,
      research_ref: 'M9',
    },
    {
      key: 'wear_short',
      name: 'Wear-and-tear cover (short)',
      months: 6,
      km: 10000,
      research_ref: 'M10',
    },
    {
      key: 'genuine_parts',
      name: 'Genuine replacement parts',
      months: null,
      km: null,
      research_ref: 'M10',
      enter_manually: true,
    },
  ],
};

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
  expenses: new Map(),
  expensePosts: [],
  expensePatches: [],
  expenseDeletes: [],
  expensePostFailures: [],
  expensePageCap: null,
  expenseGets: 0,
  coverages: new Map(),
  claims: new Map(),
  coveragePosts: [],
  claimPosts: [],
  coverageDeletes: [],
  claimDeletes: [],
  coveragePostFailures: [],
  claimPostFailures: [],
  warrantyGets: 0,
  warrantyTemplateGets: 0,
  warrantyTemplates: [WARRANTY_TEMPLATE],
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
  fake.expenses.clear();
  fake.expensePosts = [];
  fake.expensePatches = [];
  fake.expenseDeletes = [];
  fake.expensePostFailures = [];
  fake.expensePageCap = null;
  fake.expenseGets = 0;
  fake.coverages.clear();
  fake.claims.clear();
  fake.coveragePosts = [];
  fake.claimPosts = [];
  fake.coverageDeletes = [];
  fake.claimDeletes = [];
  fake.coveragePostFailures = [];
  fake.claimPostFailures = [];
  fake.warrantyGets = 0;
  fake.warrantyTemplateGets = 0;
  fake.warrantyTemplates = [WARRANTY_TEMPLATE];
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
    const body = (await request.json()) as { username: string; password: string };
    if (body.username === 'owner' && body.password === 'correct-horse') {
      fake.tokenIssued = 'tok-test';
      return HttpResponse.json({ access_token: 'tok-test', expires_in: 3600 });
    }
    return err(401, 'unauthenticated', 'Invalid credentials.');
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

const CATEGORIES = [
  'charging',
  'insurance',
  'road_tax',
  'parking',
  'tolls',
  'tyres',
  'accessories',
  'cleaning',
  'fines',
  'warranty',
  'other',
];

function expenseIssues(
  body: Partial<Expense>,
  partial: boolean,
): { field: string; issue: string }[] {
  const out: { field: string; issue: string }[] = [];
  if (!partial || body.date !== undefined) {
    if (typeof body.date !== 'string' || body.date > klToday())
      out.push({ field: 'date', issue: 'must not be in the future' });
  }
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(String(body.category)))
      out.push({ field: 'category', issue: 'unknown category' });
  }
  if (!partial || body.amount_minor !== undefined) {
    if (!Number.isInteger(body.amount_minor) || (body.amount_minor ?? 0) < 1)
      out.push({ field: 'amount_minor', issue: 'must be an integer of at least 1' });
  }
  return out;
}

const sameContent = (a: Expense, b: Expense) =>
  a.date === b.date &&
  a.category === b.category &&
  a.amount_minor === b.amount_minor &&
  (a.notes ?? null) === (b.notes ?? null) &&
  (a.energy_wh ?? null) === (b.energy_wh ?? null);

/** Fake of /expenses following the contract: newest first, cursor paging, filters AND-ed. */
export const expenseHandlers = [
  http.get('*/api/v1/expenses', ({ request }) => {
    fake.expenseGets += 1;
    if (fake.down) return err(500, 'internal_error', 'Internal server error.');
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), fake.expensePageCap ?? 100);
    const cat = url.searchParams.get('category');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const all = [...fake.expenses.values()]
      .filter(
        (x) => (!cat || x.category === cat) && (!from || x.date >= from) && (!to || x.date <= to),
      )
      .sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
      );
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const next = start + limit < all.length ? String(start + limit) : null;
    return HttpResponse.json({ items: all.slice(start, start + limit), next_cursor: next });
  }),
  http.post('*/api/v1/expenses', async ({ request }) => {
    const body = (await request.json()) as Expense;
    fake.expensePosts.push(body);
    const fail = fake.expensePostFailures.shift();
    if (fail === 400)
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'amount_minor', issue: 'rejected by test' },
      ]);
    if (fail === 409) return err(409, 'conflict', 'An expense with this id already exists.');
    if (fail !== undefined && fail !== 0)
      return err(fail, 'internal_error', 'Internal server error.');
    const existing = fake.expenses.get(body.id);
    if (existing) {
      if (!sameContent(existing, body)) return err(409, 'conflict', 'Different content.');
      return HttpResponse.json(existing, { status: 200 });
    }
    const issues = expenseIssues(body, false);
    if (issues.length > 0)
      return err(400, 'validation_error', 'Request failed validation.', issues);
    const x: Expense = {
      ...body,
      currency: body.currency || 'MYR',
      notes: body.notes ?? null,
      energy_wh: body.energy_wh ?? null,
      created_at: STAMP,
      updated_at: STAMP,
    };
    fake.expenses.set(x.id, x);
    return HttpResponse.json(x, { status: 201 });
  }),
  http.patch('*/api/v1/expenses/:id', async ({ request, params }) => {
    const x = fake.expenses.get(String(params.id));
    if (!x) return err(404, 'not_found', 'Expense not found.');
    const patch = (await request.json()) as Partial<Expense>;
    fake.expensePatches.push(patch);
    const issues = expenseIssues(patch, true);
    if (issues.length > 0)
      return err(400, 'validation_error', 'Request failed validation.', issues);
    const updated = { ...x, ...patch };
    fake.expenses.set(x.id, updated);
    return HttpResponse.json(updated);
  }),
  http.delete('*/api/v1/expenses/:id', ({ params }) => {
    const id = String(params.id);
    fake.expenseDeletes.push(id);
    if (!fake.expenses.delete(id)) return err(404, 'not_found', 'Expense not found.');
    return new HttpResponse(null, { status: 204 });
  }),
];

const sameCoverage = (a: WarrantyCoverage, b: WarrantyCoverage) =>
  a.name === b.name &&
  a.provider_type === b.provider_type &&
  a.start_date === b.start_date &&
  (a.end_date ?? null) === (b.end_date ?? null) &&
  (a.km_limit ?? null) === (b.km_limit ?? null) &&
  (a.notes ?? null) === (b.notes ?? null);

/** The fake reads the current odometer like the server: newest service record by date. */
function fakeOdometer() {
  const newest = [...fake.records.values()].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return newest
    ? {
        km: newest.odometer,
        source: 'latest_service_record' as const,
        service_record_id: newest.id,
        date: newest.date,
      }
    : null;
}

function withComputed(c: WarrantyCoverage): WarrantyCoverage {
  const claimCount = [...fake.claims.values()].filter((x) => x.coverage_id === c.id).length;
  return { ...c, claim_count: claimCount };
}

function coverageIssues(b: Partial<WarrantyCoverage>): { field: string; issue: string }[] {
  const out: { field: string; issue: string }[] = [];
  if (typeof b.name !== 'string' || b.name.trim() === '')
    out.push({ field: 'name', issue: 'must not be empty' });
  if ((b.end_date ?? null) === null && (b.km_limit ?? null) === null) {
    out.push({ field: 'end_date', issue: 'enter an end date or a km limit' });
    out.push({ field: 'km_limit', issue: 'enter an end date or a km limit' });
  }
  if (b.end_date && b.start_date && b.end_date < b.start_date)
    out.push({ field: 'end_date', issue: 'must not be before start_date' });
  return out;
}

/** Fake of /warranty-*: idempotent POST, cascade delete, claim_count, coverage_id must exist. */
export const warrantyHandlers = [
  http.get('*/api/v1/warranty-coverages', () => {
    fake.warrantyGets += 1;
    if (fake.down) return err(500, 'internal_error', 'Internal server error.');
    return HttpResponse.json({
      items: [...fake.coverages.values()].map(withComputed),
      current_odometer: fakeOdometer(),
    });
  }),
  http.post('*/api/v1/warranty-coverages', async ({ request }) => {
    const body = (await request.json()) as WarrantyCoverage;
    fake.coveragePosts.push(body);
    const fail = fake.coveragePostFailures.shift();
    if (fail === 400)
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'name', issue: 'rejected by test' },
      ]);
    if (fail === 409) return err(409, 'conflict', 'A coverage with this id already exists.');
    if (fail !== undefined && fail !== 0)
      return err(fail, 'internal_error', 'Internal server error.');
    const existing = fake.coverages.get(body.id);
    if (existing) {
      if (!sameCoverage(existing, body)) return err(409, 'conflict', 'Different content.');
      return HttpResponse.json(withComputed(existing), { status: 200 });
    }
    const issues = coverageIssues(body);
    if (issues.length > 0)
      return err(400, 'validation_error', 'Request failed validation.', issues);
    const c: WarrantyCoverage = {
      ...body,
      end_date: body.end_date ?? null,
      km_limit: body.km_limit ?? null,
      notes: body.notes ?? null,
      source_kind: body.source_kind ?? 'owner_entered',
      verification_status: body.verification_status ?? 'unverified',
      source_note: body.source_note ?? null,
      template_ref: body.template_ref ?? null,
      status: 'active',
      expired_by: [],
      expiring_soon_by: [],
      claim_count: 0,
      created_at: STAMP,
      updated_at: STAMP,
    };
    fake.coverages.set(c.id, c);
    return HttpResponse.json(c, { status: 201 });
  }),
  http.patch('*/api/v1/warranty-coverages/:id', async ({ request, params }) => {
    const c = fake.coverages.get(String(params.id));
    if (!c) return err(404, 'not_found', 'Coverage not found.');
    const patch = (await request.json()) as Partial<WarrantyCoverage>;
    const updated = { ...c, ...patch };
    const issues = coverageIssues(updated);
    if (issues.length > 0)
      return err(400, 'validation_error', 'Request failed validation.', issues);
    fake.coverages.set(c.id, updated);
    return HttpResponse.json(withComputed(updated));
  }),
  http.delete('*/api/v1/warranty-coverages/:id', ({ params }) => {
    const id = String(params.id);
    fake.coverageDeletes.push(id);
    if (!fake.coverages.delete(id)) return err(404, 'not_found', 'Coverage not found.');
    for (const [k, v] of fake.claims) if (v.coverage_id === id) fake.claims.delete(k);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/warranty-claims', () => {
    if (fake.down) return err(500, 'internal_error', 'Internal server error.');
    return HttpResponse.json({ items: [...fake.claims.values()] });
  }),
  http.post('*/api/v1/warranty-claims', async ({ request }) => {
    const body = (await request.json()) as WarrantyClaim;
    fake.claimPosts.push(body);
    const fail = fake.claimPostFailures.shift();
    if (fail === 400)
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'description', issue: 'rejected by test' },
      ]);
    if (fail !== undefined && fail !== 0)
      return err(fail, 'internal_error', 'Internal server error.');
    const existing = fake.claims.get(body.id);
    if (existing) return HttpResponse.json(existing, { status: 200 });
    if (!fake.coverages.has(body.coverage_id))
      return err(400, 'validation_error', 'Request failed validation.', [
        { field: 'coverage_id', issue: 'coverage does not exist' },
      ]);
    const x: WarrantyClaim = {
      ...body,
      cost_covered_minor: body.cost_covered_minor ?? null,
      currency: body.currency || 'MYR',
      notes: body.notes ?? null,
      created_at: STAMP,
      updated_at: STAMP,
    };
    fake.claims.set(x.id, x);
    return HttpResponse.json(x, { status: 201 });
  }),
  http.patch('*/api/v1/warranty-claims/:id', async ({ request, params }) => {
    const x = fake.claims.get(String(params.id));
    if (!x) return err(404, 'not_found', 'Claim not found.');
    const updated = { ...x, ...((await request.json()) as object) };
    fake.claims.set(x.id, updated);
    return HttpResponse.json(updated);
  }),
  http.delete('*/api/v1/warranty-claims/:id', ({ params }) => {
    const id = String(params.id);
    fake.claimDeletes.push(id);
    if (!fake.claims.delete(id)) return err(404, 'not_found', 'Claim not found.');
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/v1/warranty-templates', () => {
    fake.warrantyTemplateGets += 1;
    return HttpResponse.json({ items: fake.warrantyTemplates });
  }),
];

export const server = setupServer(
  ...handlers,
  ...reminderHandlers,
  ...expenseHandlers,
  ...warrantyHandlers,
);
