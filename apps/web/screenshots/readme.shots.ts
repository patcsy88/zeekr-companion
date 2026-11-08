import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every value below is made up for the screenshots. Nothing comes from a real car or account.
const OUT = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const NOW = new Date('2026-11-09T10:30:00+08:00');
const STAMP = '2026-11-01T02:00:00Z';
const READ_AT = '2026-11-09T02:25:00Z';

const vehicle = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  model: '7X',
  variant: 'AWD Performance (2025)',
  drive: 'AWD',
  steering: 'RHD',
  registration: null,
  vin: null,
  purchase_date: '2025-03-15',
  purchase_price_minor: 0,
  currency: 'MYR',
  tyre_spec: '265/45 R20',
};

const record = (n: number, date: string, odometer: number, description: string, cost: number) => ({
  id: `b0000000-0000-4000-8000-00000000000${String(n)}`,
  date,
  odometer,
  provider: 'Sample service centre',
  description,
  cost_minor: cost,
  currency: 'MYR',
  notes: null,
  created_at: STAMP,
  updated_at: STAMP,
});
const records = [
  record(3, '2026-09-20', 18450, '20,000 km service: cabin filter, brake fluid check', 48000),
  record(2, '2026-04-02', 10120, 'Tyre rotation and alignment', 18000),
  record(1, '2025-09-18', 5030, 'First free service', 0),
];

const reminder = (n: number, over: Record<string, unknown>) => ({
  id: `a0000000-0000-4000-8000-00000000000${String(n)}`,
  kind: 'service',
  title: 'Reminder',
  due_date: null,
  due_odometer: null,
  notes: null,
  completed_on: null,
  template_ref: null,
  status: 'upcoming',
  overdue_by: [],
  created_at: STAMP,
  updated_at: STAMP,
  ...over,
});
const reminders = [
  reminder(1, {
    kind: 'road_tax_renewal',
    title: 'Road tax renewal',
    due_date: '2026-11-05',
    status: 'overdue',
    overdue_by: ['date'],
  }),
  reminder(2, { title: '30,000 km service', due_date: '2027-03-20', due_odometer: 30000 }),
  reminder(3, { kind: 'insurance_renewal', title: 'Insurance renewal', due_date: '2027-03-14' }),
  reminder(4, { title: 'Tyre rotation', due_odometer: 20000 }),
];

const tyres = (kpa: number) => ({
  driver_front: kpa,
  passenger_front: kpa + 3,
  driver_rear: kpa - 2,
  passenger_rear: kpa + 1,
});
const liveCard = {
  status: 'ok',
  interval_minutes: 5,
  served_from: 'cache',
  observed_at: READ_AT,
  received_at: READ_AT,
  readings: {
    odometer_km: 18972,
    battery_percent: 76,
    range_km: 412,
    plugged_in: false,
    charging: false,
    tyres_kpa: tyres(250),
    service_distance_km: 11028,
    service_days: 131,
    battery_12v_volts: 12.6,
    tyres_celsius: { driver_front: 31, passenger_front: 32, driver_rear: 30, passenger_rear: 31 },
    indicators: {
      pre_climate_active: false,
      fragrance_active: false,
      overheat_protection_active: false,
      vtm_ts_active: false,
      engine_enable_running: false,
      sentry_active: false,
    },
  },
};

const geofenceAlert = {
  id: 'c0000000-0000-4000-8000-000000000001',
  condition: 'sentry_off_outside_geofence',
  status: 'proposed',
  inputs: { reading_age_minutes: 4 },
  source_refs: [],
  explanation: null,
  explanation_status: 'disabled',
  urgency: null,
  suggestion: null,
  provenance: { rule_version: 1, prompt_version: null, model_id: null },
  created_at: '2026-11-09T02:20:00Z',
  updated_at: '2026-11-09T02:20:00Z',
  decided_at: null,
};

const autoLog = [
  {
    id: 'd0000000-0000-4000-8000-000000000001',
    created_at: '2026-11-02T06:40:00Z',
    desired: 'on',
    result: 'sent',
    skip_reason: null,
    source: 'auto',
    state_after: 'on',
  },
];

const geofence = {
  settings: { radius_km: 5, interval_minutes: 5, stale_minutes: 30, usage_mode_codes: [0] },
  sources: {
    radius_km: 'saved',
    interval_minutes: 'saved',
    stale_minutes: 'saved',
    usage_mode_codes: 'saved',
  },
  limits: {
    radius_km_max: 100,
    interval_minutes_min: 5,
    interval_minutes_max: 1440,
    stale_minutes_min: 1,
    stale_minutes_max: 30,
    max_codes: 2,
    usage_mode_options: [
      { code: 0, label: 'Deep Sleep', verified: false },
      { code: 1, label: 'Parked', verified: false },
    ],
  },
  enabled: true,
  home_set: true,
};

const odometer = {
  km: 18972,
  source: 'live_reading',
  service_record_id: null,
  date: '2026-11-09',
};

function answer(path: string): unknown {
  if (path === '/auth/token') return { access_token: 'sample-token', expires_in: 3600 };
  if (path === '/vehicle') return vehicle;
  if (path.startsWith('/service-records')) return { items: records, next_cursor: null };
  if (path.startsWith('/reminders')) return { items: reminders, current_odometer: odometer };
  if (path === '/reminder-templates') return { items: [] };
  if (path.startsWith('/expenses')) return { items: [], next_cursor: null };
  if (path.startsWith('/tyre-events'))
    return { items: [], next_cursor: null, current_odometer: odometer };
  if (path === '/warranty-coverages') return { items: [], current_odometer: odometer };
  if (path === '/warranty-claims' || path === '/warranty-templates') return { items: [] };
  if (path === '/live-vehicle') return liveCard;
  if (path.startsWith('/live-vehicle/history'))
    return { items: [], interval_minutes: 5, retention_months: 12 };
  if (path.startsWith('/advisory/proposals')) return { items: [geofenceAlert] };
  if (path === '/vehicle/sentry/state') return { state: 'off', at: READ_AT };
  if (path === '/vehicle/sentry/auto')
    return {
      enabled: true,
      quiet_minutes: 60,
      host_allowed: true,
      can_enable: true,
      limits: { quiet_minutes: { min: 5, max: 1440 } },
    };
  if (path.startsWith('/vehicle/sentry/log')) return { items: autoLog, retention_months: 12 };
  if (path === '/geofence/settings') return geofence;
  return null;
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/health', (route: Route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '') + url.search;
    if (path === '/vehicle/sentry/events') {
      // A silent event stream: an empty body that the app treats as idle.
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': idle\n\n' });
    }
    const body = answer(path.split('?')[0] === '/reminders' ? '/reminders' : path);
    if (body === null)
      return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
    return route.fulfill({ json: body });
  });
}

const SCREENS = [
  { name: 'vehicle', path: '/vehicle', ready: 'live-readings' },
  { name: 'service-history', path: '/', ready: null },
  { name: 'reminders', path: '/reminders', ready: null },
  { name: 'sentry', path: '/sentry', ready: 'geofence-alert' },
  { name: 'geofence', path: '/geofence', ready: 'geo-status' },
] as const;

for (const theme of ['light', 'dark'] as const) {
  test(`README screens, ${theme}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.clock.setFixedTime(NOW);
    await mockApi(page);
    await page.addInitScript((t) => {
      localStorage.setItem('zc-theme', t);
    }, theme);
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.getByLabel('Username').fill('owner');
    await page.getByLabel('Password').fill('sample-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Service records, newest first' })).toBeVisible();

    for (const screen of SCREENS) {
      // Client-side navigation keeps the in-memory sign-in (the token is never stored).
      await page.evaluate((p) => {
        window.history.pushState(null, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, screen.path);
      if (screen.ready) await expect(page.getByTestId(screen.ready).first()).toBeVisible();
      await page.waitForTimeout(400); // let skeletons and fonts settle
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: `${OUT}${screen.name}-${theme}.png` });
    }
  });
}
