import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = process.env.E2E_PASSWORD ?? '';
export const API_PORT = Number(process.env.E2E_API_PORT ?? 18765);

/** A date that is valid on the server's UTC rule at any time of day. */
export function safePastDate(): string {
  const d = new Date(Date.now() - 2 * 86_400_000);
  return d.toISOString().slice(0, 10);
}
export function utcTomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out, keep local data' })).toBeVisible();
}

export async function addRecord(
  page: Page,
  opts: { description: string; date?: string; odometer?: string; cost?: string },
): Promise<void> {
  await page.getByRole('link', { name: 'Add service' }).click();
  await page.getByLabel('Date').fill(opts.date ?? safePastDate());
  await page.getByLabel('Odometer (km)').fill(opts.odometer ?? '12345');
  await page.getByLabel('Description').fill(opts.description);
  await page.getByLabel('Cost (MYR)').fill(opts.cost ?? '120.50');
  await page.getByRole('button', { name: 'Save' }).click();
}

/** Read straight from the API in a fresh, unrelated browser context (a "second profile"). */
export async function serverRecords(
  browser: Browser,
  baseURL: string,
): Promise<{ id: string; description: string; cost_minor: number }[]> {
  const ctx = await browser.newContext({ baseURL });
  try {
    const tok = await ctx.request.post('/api/v1/auth/token', { data: { password: PASSWORD } });
    expect(tok.status()).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const res = await ctx.request.get('/api/v1/service-records?limit=100', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(200);
    return (
      (await res.json()) as { items: { id: string; description: string; cost_minor: number }[] }
    ).items;
  } finally {
    await ctx.close();
  }
}

export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A controlling worker is needed for the offline reload: reload once so the page is controlled.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}
