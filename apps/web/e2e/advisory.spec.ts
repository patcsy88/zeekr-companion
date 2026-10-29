import { expect, test } from '@playwright/test';
import { PASSWORD, USERNAME, klDate, signIn, unique } from './helpers';

test('ADR-008: run the checks, accept a suggestion into a reminder, and the server records both', async ({
  page,
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext({ baseURL: baseURL ?? '' });
  const tok = await ctx.request.post('/api/v1/auth/token', {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(tok.status()).toBe(200);
  const { access_token } = (await tok.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const name = unique('ADVCOV');

  // Disposable data: a steady 100 km/day, and a warranty whose km limit comes first.
  for (const [offset, km] of [
    [-61, 4000],
    [0, 10000],
  ] as const) {
    const r = await ctx.request.post('/api/v1/service-records', {
      headers,
      data: {
        id: crypto.randomUUID(),
        date: klDate(offset),
        odometer: km,
        description: unique('ADVREC'),
        cost_minor: 100,
        currency: 'MYR',
      },
    });
    expect(r.status()).toBe(201);
  }
  const covId = crypto.randomUUID();
  const cov = await ctx.request.post('/api/v1/warranty-coverages', {
    headers,
    data: {
      id: covId,
      name,
      provider_type: 'factory',
      start_date: klDate(-60),
      end_date: klDate(300),
      km_limit: 11000,
    },
  });
  expect(cov.status()).toBe(201);

  await page.goto('/');
  await signIn(page);
  await page.getByRole('link', { name: 'Advisory', exact: true }).click();
  await page.getByRole('button', { name: 'Run checks now' }).click();
  await expect(page.getByTestId('advisory-run')).toBeVisible();
  await expect(page.getByTestId('advisory-status')).toContainText('Model: off');
  const card = page
    .getByTestId('proposal')
    .filter({ hasText: 'Warranty km limit may be reached' })
    .first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('the model is switched off');

  await card.getByRole('button', { name: /Accept/ }).click();
  await expect(page.getByRole('heading', { name: 'Add reminder' })).toBeVisible();
  await expect(page.getByLabel(/Title/)).not.toHaveValue('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Advisory' })).toBeVisible();

  await expect
    .poll(async () => {
      const r = await ctx.request.get('/api/v1/advisory/proposals?status=accepted', { headers });
      return ((await r.json()) as { items: unknown[] }).items.length;
    })
    .toBeGreaterThan(0);
  const rem = await ctx.request.get('/api/v1/reminders', { headers });
  expect(((await rem.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);

  // Nothing was sent to a model: no call is recorded.
  const calls = await ctx.request.get('/api/v1/advisory/model-calls', { headers });
  expect(((await calls.json()) as { items: unknown[] }).items).toEqual([]);
  await ctx.close();
});
