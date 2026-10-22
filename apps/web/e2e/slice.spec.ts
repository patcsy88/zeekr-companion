import { expect, test } from '@playwright/test';
import {
  addRecord,
  serverRecords,
  signIn,
  unique,
  klDate,
  klTomorrow,
  waitForServiceWorker,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('sign in with a wrong password is refused, correct password works', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong password');
  await signIn(page);
});

test('token and password are not in web storage', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  const dump = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(dump).not.toContain(process.env.E2E_PASSWORD ?? 'x');
  expect(dump).not.toMatch(/eyJ|access_token|bearer/i);
});

test('vehicle profile: create, view, edit (FR-1)', async ({ page }) => {
  await page.goto('/vehicle');
  await signIn(page);
  await page.getByRole('link', { name: /Create vehicle profile|Create or edit anyway/ }).click();
  await page.getByLabel('Variant').fill('Test variant');
  await page.getByLabel('VIN').fill('TESTVIN1234567890'); // 17 characters, not a real VIN
  await page.getByLabel('Purchase price (MYR)').fill('250000.00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Vehicle' })).toBeVisible();
  await expect(page.getByText('RM 250,000.00')).toBeVisible();
  await expect(page.getByText('Test variant')).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Variant').fill('Edited variant');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Edited variant')).toBeVisible();
});

test('AC-6: record survives reload and is on the server (second profile)', async ({
  page,
  browser,
  baseURL,
}) => {
  const description = unique('AC6');
  await page.goto('/');
  await signIn(page);
  await addRecord(page, { description });
  await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);

  // Full reload: token is memory-only, so sign in again, then the record is listed.
  await page.reload();
  await signIn(page);
  await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();

  // Different browser profile reads it from the API: stored on the server.
  const items = await serverRecords(browser, baseURL ?? 'http://localhost:4173');
  const found = items.filter((r) => r.description === description);
  expect(found).toHaveLength(1);
  expect(found[0]?.cost_minor).toBe(12050); // MYR 120.50 sent as integer sen
});

test('AC-7: cold start offline shows cached vehicle and records with an offline indicator', async ({
  page,
  context,
}) => {
  const description = unique('AC7');
  await page.goto('/');
  await signIn(page);
  await addRecord(page, { description });
  await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload(); // cold start of the shell from the service worker, no network, not signed in
  await expect(page.getByTestId('offline-indicator')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
  await page.getByRole('link', { name: 'Vehicle' }).click();
  await expect(page.getByText('Edited variant')).toBeVisible();
  await context.setOffline(false);
});

test('service worker never caches /api responses', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  await waitForServiceWorker(page);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const r of await c.keys()) urls.push(new URL(r.url).pathname);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((u) => u.startsWith('/api'))).toEqual([]);
});

test('AC-9: offline create is pending, then sent exactly once on reconnect', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const description = unique('AC9');
  await page.goto('/');
  await signIn(page);
  await expect(page.getByTestId('offline-indicator')).toHaveCount(0);

  await context.setOffline(true);
  await addRecord(page, { description });
  await expect(page.getByTestId('offline-indicator')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: description });
  await expect(row.getByTestId('sync-pending')).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveText('1 waiting to sync');

  // Edit while still offline: coalesced into the same single POST.
  await row.getByRole('link').click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Cost (MYR)').fill('99.99');
  await page.getByRole('button', { name: 'Save changes' }).click();

  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/service-records')) posts.push(r.url());
  });

  await context.setOffline(false);
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  const items = await serverRecords(browser, baseURL ?? 'http://localhost:4173');
  const found = items.filter((r) => r.description === description);
  expect(found).toHaveLength(1);
  expect(found[0]?.cost_minor).toBe(9999);
  expect(posts).toHaveLength(1); // exactly one POST after reconnect, carrying the edited content
});

test('edit and delete with confirmation (FR-4)', async ({ page, browser, baseURL }) => {
  const description = unique('DEL');
  await page.goto('/');
  await signIn(page);
  await addRecord(page, { description });
  await page.getByRole('link', { name: new RegExp(description) }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: description })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Service history' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(description) })).toHaveCount(0);
  const items = await serverRecords(browser, baseURL ?? 'http://localhost:4173');
  expect(items.filter((r) => r.description === description)).toHaveLength(0);
});

test('a date the server rejects as "future" is explained next to the field', async ({ page }) => {
  const description = unique('FUT');
  await page.goto('/');
  await signIn(page);
  await addRecord(page, { description, date: klTomorrow() });
  // Saved locally, then refused by the server: shown as failed with the explanation.
  const row = page.getByRole('listitem').filter({ hasText: description });
  await expect(row.getByTestId('sync-failed')).toBeVisible();
  await row.getByRole('link').click();
  await expect(page.getByText('must not be in the future')).toBeVisible();
  await expect(page.getByText(/Between 00:00 and 08:00/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Discard my change' }).click();
});

test.describe('default date at 03:00 Malaysian time (owner decision 2026-10-22)', () => {
  test.use({ timezoneId: 'Asia/Kuala_Lumpur' });

  test('the untouched default date is the Malaysian date and the real API accepts it', async ({
    page,
    browser,
    baseURL,
  }) => {
    // Browser clock: 03:00 Malaysian time today, which is still the previous day in UTC. The old
    // UTC rule refused this date; the Malaysian rule accepts it.
    const myToday = klDate();
    await page.clock.setFixedTime(new Date(`${myToday}T03:00:00+08:00`));
    const description = unique('DEFDATE');
    await page.goto('/');
    await signIn(page);
    await page.getByRole('link', { name: 'Add service' }).click();
    await expect(page.getByLabel('Date')).toHaveValue(myToday);
    await page.getByLabel('Odometer (km)').fill('4321');
    await page.getByLabel('Description').fill(description);
    await page.getByLabel('Cost (MYR)').fill('10.00');
    await page.getByRole('button', { name: 'Save' }).click();
    const row = page.getByRole('listitem').filter({ hasText: description });
    await expect(row).toBeVisible();
    await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('failed-count')).toHaveCount(0);
    await expect(row.getByTestId('sync-failed')).toHaveCount(0);
    const items = await serverRecords(browser, baseURL ?? 'http://localhost:4173');
    expect(items.filter((r) => r.description === description)).toHaveLength(1);
  });
});

test('cursor paging loads older records', async ({ page, browser, baseURL }) => {
  // Seed 22 records straight through the API so the first page (20) has a next cursor.
  const ctx = await browser.newContext({ baseURL });
  const tok = await ctx.request.post('/api/v1/auth/token', {
    data: { password: process.env.E2E_PASSWORD },
  });
  const { access_token } = (await tok.json()) as { access_token: string };
  const tag = unique('PG');
  for (let i = 0; i < 22; i++) {
    const id = crypto.randomUUID();
    const r = await ctx.request.post('/api/v1/service-records', {
      headers: { Authorization: `Bearer ${access_token}` },
      data: {
        id,
        date: '2020-01-01',
        odometer: i,
        description: `${tag} #${String(i).padStart(2, '0')}`,
        cost_minor: 1,
        provider: null,
        notes: null,
      },
    });
    expect(r.status()).toBe(201);
  }
  await ctx.close();
  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Load older records' })).toBeVisible();
  await page.getByRole('button', { name: 'Load older records' }).click();
  await expect(page.getByRole('link', { name: new RegExp(`${tag} #00`) })).toBeVisible();
});
