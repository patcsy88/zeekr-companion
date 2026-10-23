import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, klDate, signIn, unique, waitForServiceWorker } from './helpers';

interface ServerCoverage {
  id: string;
  name: string;
  provider_type: string;
  source_kind: string;
  verification_status: string;
  template_ref: string | null;
  claim_count: number;
}
interface ServerClaim {
  id: string;
  coverage_id: string;
  description: string;
}

/** Read straight from the API in a fresh, unrelated browser context (a "second profile"). */
async function serverWarranty(
  browser: Browser,
  baseURL: string,
): Promise<{ coverages: ServerCoverage[]; claims: ServerClaim[] }> {
  const ctx = await browser.newContext({ baseURL });
  try {
    const tok = await ctx.request.post('/api/v1/auth/token', { data: { password: PASSWORD } });
    expect(tok.status()).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const headers = { Authorization: `Bearer ${access_token}` };
    const cov = await ctx.request.get('/api/v1/warranty-coverages', { headers });
    expect(cov.status()).toBe(200);
    const clm = await ctx.request.get('/api/v1/warranty-claims', { headers });
    expect(clm.status()).toBe(200);
    return {
      coverages: ((await cov.json()) as { items: ServerCoverage[] }).items,
      claims: ((await clm.json()) as { items: ServerClaim[] }).items,
    };
  } finally {
    await ctx.close();
  }
}

async function addCoverage(page: Page, o: { name: string; km?: string }) {
  await page.getByRole('link', { name: 'Warranty', exact: true }).click();
  await page.getByRole('link', { name: 'Add coverage' }).click();
  await page.getByLabel('Name').fill(o.name);
  await page.getByLabel('Start date').fill(klDate(-30));
  await page.getByLabel('End date').fill(klDate(300));
  if (o.km) await page.getByLabel('Km limit').fill(o.km);
  await page.getByRole('button', { name: 'Save' }).click();
}

async function addClaim(page: Page, coverageName: string, description: string) {
  await page.getByRole('link', { name: new RegExp(coverageName) }).click();
  await page.getByRole('link', { name: 'Add claim' }).click();
  await page.getByLabel('Odometer (km)').fill('1500');
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
}

test('AC-48/57: a coverage and a claim are stored on the server and visible from a second profile', async ({
  page,
  browser,
  baseURL,
}) => {
  const name = unique('COV');
  const desc = unique('CLAIM');
  await page.goto('/');
  await signIn(page);
  await addCoverage(page, { name, km: '150000' });
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByTestId('terms-line')).toContainText('warranty documents');
  await addClaim(page, name, desc);
  await expect(page.getByText(desc)).toBeVisible();
  const base = baseURL ?? 'http://localhost:4173';
  // Wait on the server itself: the pending badge is absent in the instant after saving, so waiting
  // for it to disappear can pass before the claim has been sent.
  await expect
    .poll(
      async () => (await serverWarranty(browser, base)).claims.some((c) => c.description === desc),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.reload();
  await signIn(page);
  await page.getByRole('link', { name: 'Warranty', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();

  const s = await serverWarranty(browser, base);
  const made = s.coverages.filter((c) => c.name === name);
  expect(made).toHaveLength(1);
  expect(made[0]?.source_kind).toBe('owner_entered');
  expect(
    s.claims.filter((c) => c.description === desc && c.coverage_id === made[0]?.id),
  ).toHaveLength(1);
});

test('AC-66: a script-like name is shown literally and runs nothing', async ({ page }) => {
  const name = '<img src=x onerror=alert(1)>';
  let dialog = false;
  page.on('dialog', (d) => {
    dialog = true;
    void d.dismiss();
  });
  await page.goto('/');
  await signIn(page);
  await addCoverage(page, { name });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  expect(dialog).toBe(false);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete coverage' }).click();
});

test('AC-54/55/56: opening and cancelling the template creates nothing; accepting one item creates one, proposed', async ({
  page,
  browser,
  baseURL,
}) => {
  const base = baseURL ?? 'http://localhost:4173';
  await page.goto('/');
  await signIn(page);
  const before = (await serverWarranty(browser, base)).coverages.length;
  await page.getByRole('link', { name: 'Warranty', exact: true }).click();
  await page.getByRole('link', { name: 'Suggested factory warranty terms' }).click();
  await expect(page.getByTestId('template-source')).toContainText('M8');
  await expect(page.getByTestId('template-caveat')).toContainText('Confirm against');
  await expect(page.getByTestId('tpl-manual-genuine_parts')).toContainText('Enter manually');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  expect((await serverWarranty(browser, base)).coverages).toHaveLength(before);

  await page.getByRole('link', { name: 'Suggested factory warranty terms' }).click();
  await page.getByLabel(/Baseline start date/).fill(klDate(-10));
  const name = unique('TPL');
  const first = page
    .getByRole('list', { name: 'Suggested coverages' })
    .getByRole('listitem')
    .first();
  await first.getByRole('checkbox').check();
  await first.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create selected coverages' }).click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect
    .poll(async () => (await serverWarranty(browser, base)).coverages.length, {
      timeout: 15_000,
    })
    .toBe(before + 1);

  const after = (await serverWarranty(browser, base)).coverages;
  expect(after).toHaveLength(before + 1);
  const made = after.filter((c) => c.name === name);
  expect(made).toHaveLength(1);
  expect(made[0]).toMatchObject({
    provider_type: 'factory',
    source_kind: 'template',
    verification_status: 'proposed',
  });
  expect(made[0]?.template_ref).toMatch(/^my-factory-warranty:/);
  await expect(
    page.getByRole('link', { name: new RegExp(name) }).getByText(/Proposed/),
  ).toBeVisible();
});

test('AC-61/62: offline coverage then claim are pending, then sent exactly once on reconnect', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const name = unique('OFFCOV');
  const desc = unique('OFFCLAIM');
  await page.goto('/');
  await signIn(page);
  await page.getByRole('link', { name: 'Warranty', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Add coverage' })).toBeVisible();
  await waitForServiceWorker(page);
  await signIn(page);
  await context.setOffline(true);
  await addCoverage(page, { name });
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByTestId('sync-pending')).toBeVisible();
  await expect(page.getByTestId('status-computed-offline')).toBeVisible();
  await addClaim(page, name, desc);
  await expect(page.getByText(desc)).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  const base = baseURL ?? 'http://localhost:4173';
  await expect
    .poll(
      async () => (await serverWarranty(browser, base)).claims.some((c) => c.description === desc),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });

  const s = await serverWarranty(browser, base);
  const made = s.coverages.filter((c) => c.name === name);
  expect(made).toHaveLength(1);
  expect(
    s.claims.filter((c) => c.description === desc && c.coverage_id === made[0]?.id),
  ).toHaveLength(1);
});
