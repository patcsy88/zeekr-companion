import { expect, test, type Browser } from '@playwright/test';
import { PASSWORD, USERNAME, signIn, unique, waitForServiceWorker } from './helpers';

interface ServerTyreEvent {
  id: string;
  kind: string;
  wheels: string[];
  odometer: number;
  notes: string | null;
}

/** Read straight from the API in a fresh, unrelated browser context (a "second profile"). */
async function serverTyreEvents(browser: Browser, baseURL: string): Promise<ServerTyreEvent[]> {
  const ctx = await browser.newContext({ baseURL });
  try {
    const tok = await ctx.request.post('/api/v1/auth/token', {
      data: { username: USERNAME, password: PASSWORD },
    });
    expect(tok.status()).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const res = await ctx.request.get('/api/v1/tyre-events?limit=100', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { items: ServerTyreEvent[] }).items;
  } finally {
    await ctx.close();
  }
}

test('AC-81: an offline tyre event is pending, survives reload, and is sent exactly once', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const notes = unique('OFFTYRE');
  await page.goto('/vehicle/tyres');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Tyres', exact: true })).toBeVisible();
  await waitForServiceWorker(page);
  await signIn(page);
  await expect(page.getByTestId('not-in-expenses')).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('link', { name: 'Add tyre event' }).click();
  await expect(page.getByRole('heading', { name: 'Add tyre event' })).toBeVisible();
  await page.getByLabel('Type').selectOption('rotate');
  await page.getByLabel('Odometer (km)').fill('4321');
  await page.getByLabel('Notes').fill(notes);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/vehicle\/tyres$/);
  const row = page.getByRole('link', { name: new RegExp(notes) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Rotate · All four');
  await expect(page.getByTestId('sync-pending')).toBeVisible();

  // Still offline, the pending event survives a reload. Signed out, it is kept but hidden.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(notes) })).toHaveCount(0);

  await context.setOffline(false);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Tyres', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(notes) })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  const items = (await serverTyreEvents(browser, baseURL ?? 'http://localhost:4173')).filter(
    (x) => x.notes === notes,
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ kind: 'rotate', odometer: 4321 });
  expect(items[0]?.wheels).toHaveLength(4);
});
