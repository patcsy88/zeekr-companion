import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, klDate, signIn, unique, waitForServiceWorker } from './helpers';

interface ServerExpense {
  id: string;
  date: string;
  category: string;
  amount_minor: number;
  notes: string | null;
}

/** Read straight from the API in a fresh, unrelated browser context (a "second profile"). */
async function serverExpenses(browser: Browser, baseURL: string): Promise<ServerExpense[]> {
  const ctx = await browser.newContext({ baseURL });
  try {
    const tok = await ctx.request.post('/api/v1/auth/token', { data: { password: PASSWORD } });
    expect(tok.status()).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const res = await ctx.request.get('/api/v1/expenses?limit=100', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { items: ServerExpense[] }).items;
  } finally {
    await ctx.close();
  }
}

async function addExpense(
  page: Page,
  o: { amount: string; notes: string; category?: string; date?: string },
) {
  await page.getByRole('link', { name: 'Expenses' }).click();
  await page.getByRole('link', { name: 'Add expense' }).click();
  await expect(page.getByRole('heading', { name: 'Add expense' })).toBeVisible();
  if (o.date) await page.getByLabel('Date').fill(o.date);
  if (o.category) await page.getByLabel('Category', { exact: true }).selectOption(o.category);
  await page.getByLabel('Amount (MYR)').fill(o.amount);
  await page.getByLabel('Notes').fill(o.notes);
  await page.getByRole('button', { name: 'Save' }).click();
}

test('AC-30/38/43/35: an expense is stored on the server, visible from a second profile, survives reload', async ({
  page,
  browser,
  baseURL,
}) => {
  const notes = unique('EXP');
  await page.goto('/');
  await signIn(page);
  await addExpense(page, { amount: 'RM 1,234.50', notes, category: 'insurance' });
  const row = page.getByRole('link', { name: new RegExp(notes) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Insurance');
  await expect(row).toContainText('RM 1,234.50');
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await signIn(page);
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('link', { name: new RegExp(notes) })).toBeVisible();
  const items = (await serverExpenses(browser, baseURL ?? 'http://localhost:4173')).filter(
    (x) => x.notes === notes,
  );
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ amount_minor: 123450, category: 'insurance' });
});

test('AC-36/37: list filters, quick filters and the summary page text', async ({ page }) => {
  const old = unique('OLD');
  const fresh = unique('FRESH');
  await page.goto('/');
  await signIn(page);
  await addExpense(page, { amount: '10', notes: old, category: 'tolls', date: '2025-03-15' });
  await addExpense(page, { amount: '25.50', notes: fresh, category: 'parking', date: klDate(0) });
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });

  await expect(page.getByRole('link', { name: new RegExp(old) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(fresh) })).toBeVisible();

  await page.getByRole('button', { name: 'This year' }).click();
  await expect(page.getByTestId('active-filters')).toContainText('From');
  await expect(page.getByRole('link', { name: new RegExp(fresh) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(old) })).toHaveCount(0);
  await page.getByRole('button', { name: 'This month' }).click();
  await expect(page.getByRole('link', { name: new RegExp(fresh) })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await page.getByLabel('Category', { exact: true }).first().selectOption('tolls');
  await expect(page.getByRole('link', { name: new RegExp(old) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(fresh) })).toHaveCount(0);
  await expect(page.getByTestId('active-filters')).toContainText('Category: Tolls');
  await expect(page.getByRole('list', { name: 'Totals by category' })).toContainText('Tolls');
  await expect(page.getByRole('list', { name: 'Totals by month' })).toContainText('2025-03');
  await expect(page.getByTestId('totals')).toContainText('Service record costs are not included');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByTestId('partial-warning')).toHaveCount(0);
});

test('AC-32/33: edit shows the saved values, saves changes, and delete needs confirmation', async ({
  page,
  browser,
  baseURL,
}) => {
  const notes = unique('EDIT');
  await page.goto('/');
  await signIn(page);
  await addExpense(page, { amount: '40', notes, category: 'cleaning', date: klDate(-3) });
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('link', { name: new RegExp(notes) }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Amount (MYR)')).toHaveValue('40.00');
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('cleaning');
  await expect(page.getByLabel('Date')).toHaveValue(klDate(-3));
  await page.getByLabel('Amount (MYR)').fill('41.25');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('RM 41.25')).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  const base = baseURL ?? 'http://localhost:4173';
  expect((await serverExpenses(browser, base)).find((x) => x.notes === notes)?.amount_minor).toBe(
    4125,
  );

  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete this expense?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await serverExpenses(browser, base)).some((x) => x.notes === notes)).toBe(true);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('link', { name: new RegExp(notes) })).toHaveCount(0);
  expect((await serverExpenses(browser, base)).some((x) => x.notes === notes)).toBe(false);
});

test('AC-44: a script-like note is shown literally and runs nothing', async ({ page }) => {
  const notes = '<img src=x onerror=alert(1)>';
  let dialog = false;
  page.on('dialog', (d) => {
    dialog = true;
    void d.dismiss();
  });
  await page.goto('/');
  await signIn(page);
  await addExpense(page, { amount: '1', notes, category: 'other' });
  await expect(page.getByText(notes, { exact: true }).first()).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole('link', { name: notes }).click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/);
  await expect(page.getByText(notes, { exact: true })).toBeVisible();
  expect(dialog).toBe(false);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
});

test('AC-39/40: offline create is pending, survives reload, and is sent exactly once', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const notes = unique('OFFEXP');
  await page.goto('/');
  await signIn(page);
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('link', { name: 'Add expense' })).toBeVisible();
  await waitForServiceWorker(page);
  await signIn(page);
  await page.getByRole('link', { name: 'Expenses' }).click();
  await context.setOffline(true);
  await addExpense(page, { amount: '33.30', notes, category: 'charging' });
  await expect(page.getByRole('link', { name: new RegExp(notes) })).toBeVisible();
  await expect(page.getByTestId('sync-pending')).toBeVisible();
  await expect(page.getByTestId('totals-offline-note')).toBeVisible();

  // The pending expense survives a reload while still offline.
  await page.reload();
  await page.getByRole('link', { name: 'Expenses' }).click();
  await expect(page.getByRole('link', { name: new RegExp(notes) })).toBeVisible();
  await expect(page.getByTestId('sync-pending')).toBeVisible();
  const base = baseURL ?? 'http://localhost:4173';

  await context.setOffline(false);
  await signIn(page).catch(() => undefined);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  const items = (await serverExpenses(browser, base)).filter((x) => x.notes === notes);
  expect(items).toHaveLength(1);
  expect(items[0]?.amount_minor).toBe(3330);
});
