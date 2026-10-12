import { expect, test, type Page } from '@playwright/test';
import { addRecord, signIn, unique } from './helpers';

test.describe.configure({ mode: 'serial' });

async function deleteFromDetail(page: Page, description: string) {
  await page.getByRole('link', { name: new RegExp(description) }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Service history' })).toBeVisible();
}

test('D1: add, open, delete is gone from the list, 8 times in a row', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  for (let i = 0; i < 8; i++) {
    const description = unique(`D1-${String(i)}`);
    await addRecord(page, { description });
    await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
    await deleteFromDetail(page, description);
    // Give any late refresh time to (wrongly) bring it back, then assert it is still gone.
    await page.waitForTimeout(250);
    await expect(page.getByRole('link', { name: new RegExp(description) })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);
});

test('D1: slow DELETE response with a list refresh in flight', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  for (let i = 0; i < 4; i++) {
    const description = unique(`D1S-${String(i)}`);
    await addRecord(page, { description });
    await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
    // The DELETE reaches the server at once but its answer is held back 700 ms, and a list
    // request that was sent before the delete is answered after it.
    await page.route('**/api/v1/service-records/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 700));
      return route.fulfill({ response: res });
    });
    let first = true;
    await page.route('**/api/v1/service-records?*', async (route) => {
      if (!first) return route.fallback();
      first = false;
      const res = await route.fetch(); // snapshot taken now, still containing the record
      await new Promise((r) => setTimeout(r, 1200));
      return route.fulfill({ response: res });
    });
    await page.getByRole('button', { name: 'Sync now' }).click(); // starts a list refresh
    await deleteFromDetail(page, description);
    await page.waitForTimeout(1800);
    await expect(page.getByRole('link', { name: new RegExp(description) })).toHaveCount(0);
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('D2: browser online but the proxy answers 502 -> "Server unreachable"', async ({ page }) => {
  await page.route('**/health', (r) =>
    r.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }),
  );
  await page.route('**/api/**', (r) =>
    r.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }),
  );
  await page.goto('/');
  await expect(page.getByTestId('offline-indicator')).toHaveText('Server unreachable');
  await page.getByLabel('Password').fill('anything');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('The server is unavailable');
  await expect(page.getByTestId('offline-indicator')).toBeVisible();
});

for (const status of [503, 504]) {
  test(`D2: a ${String(status)} from the proxy is not "reachable" and a queued write says so`, async ({
    page,
  }) => {
    await page.goto('/');
    await signIn(page);
    await expect(page.getByTestId('offline-indicator')).toHaveCount(0);
    await page.route('**/api/**', (r) =>
      r.fulfill({ status, contentType: 'text/html', body: '<h1>Gateway</h1>' }),
    );
    const description = unique(`D2-${String(status)}`);
    await addRecord(page, { description });
    await expect(page.getByTestId('offline-indicator')).toBeVisible();
    await expect(page.getByTestId('pending-count')).toHaveText('1 waiting to sync');
    await expect(page.getByText(/saved on this device and will sync later/)).toBeVisible();
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('offline-indicator')).toHaveCount(0);
  });
}

test('D2: connections dropped by the server (API stopped) count as unreachable', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page);
  await page.route('**/api/**', (r) => r.abort('connectionrefused'));
  await page.route('**/health', (r) => r.abort('connectionrefused'));
  await addRecord(page, { description: unique('D2-down') });
  await expect(page.getByTestId('offline-indicator')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
});

test('W3: a crafted record URL shows not found and makes no record API call', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  const calls: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    // Only API calls count; the page navigation itself is not one. Start-up GETs of the list or
    // /vehicle are expected: what must not happen is a request for a single record or a traversal.
    if (u.includes('/api/') && /\/service-records\/|\.\.|%2e|%2f/i.test(u)) calls.push(u);
  });
  for (const path of [
    '/records/..%2Fvehicle',
    '/records/not-a-uuid',
    '/records/%2e%2e%2fvehicle',
  ]) {
    await page.goto(path);
    await expect(page.getByText(/not found/i)).toBeVisible();
  }
  expect(calls).toEqual([]);
});

test('W2: sign out and clear local data asks first and clears everything', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  await page.route('**/api/**', (r) => r.abort('connectionrefused'));
  const description = unique('W2');
  await addRecord(page, { description });
  await page.getByRole('button', { name: 'Sign out and clear local data' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('1 change has not reached the server');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out and clear local data' }).click();
  await page.getByRole('button', { name: 'Clear local data and sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(description) })).toHaveCount(0);
  const dbs = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const r = indexedDB.open('zeekr-companion');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error ?? new Error('could not open the database'));
    });
    const count = (s: string) =>
      new Promise<number>((ok) => {
        const q = db.transaction(s).objectStore(s).count();
        q.onsuccess = () => ok(q.result);
      });
    const out = {
      cache: await count('cache'),
      queue: await count('queue'),
      meta: await count('meta'),
    };
    db.close();
    return out;
  });
  expect(dbs).toEqual({ cache: 0, queue: 0, meta: 0 });
});
