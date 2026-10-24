import { expect, test, type Browser, type Page } from '@playwright/test';
import { PASSWORD, USERNAME, klDate, signIn, unique, waitForServiceWorker } from './helpers';

interface ServerReminder {
  id: string;
  title: string;
  notes: string | null;
  template_ref: string | null;
  status: string;
  completed_on: string | null;
}

/** Read straight from the API in a fresh, unrelated browser context (a "second profile"). */
async function serverReminders(browser: Browser, baseURL: string): Promise<ServerReminder[]> {
  const ctx = await browser.newContext({ baseURL });
  try {
    const tok = await ctx.request.post('/api/v1/auth/token', {
      data: { username: USERNAME, password: PASSWORD },
    });
    expect(tok.status()).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const res = await ctx.request.get('/api/v1/reminders?include_completed=true', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { items: ServerReminder[] }).items;
  } finally {
    await ctx.close();
  }
}

async function addReminder(page: Page, o: { title: string; date?: string; km?: string }) {
  await page.getByRole('link', { name: 'Reminders' }).click();
  await page.getByRole('link', { name: 'Add reminder' }).click();
  await page.getByLabel('Title').fill(o.title);
  if (o.date) await page.getByLabel('Due date').fill(o.date);
  if (o.km) await page.getByLabel('Due odometer (km)').fill(o.km);
  await page.getByRole('button', { name: 'Save' }).click();
}

test('AC-10/27: a reminder is stored on the server, visible from a second profile, survives reload', async ({
  page,
  browser,
  baseURL,
}) => {
  const title = unique('REM');
  await page.goto('/');
  await signIn(page);
  await addReminder(page, { title, date: klDate(10) });
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await signIn(page);
  await page.getByRole('link', { name: 'Reminders' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  const items = await serverReminders(browser, baseURL ?? 'http://localhost:4173');
  expect(items.filter((r) => r.title === title)).toHaveLength(1);
});

test('AC-28: a script-like title is shown literally and runs nothing', async ({ page }) => {
  const title = '<img src=x onerror=alert(1)>';
  let dialog = false;
  page.on('dialog', (d) => {
    dialog = true;
    void d.dismiss();
  });
  await page.goto('/');
  await signIn(page);
  await addReminder(page, { title, date: klDate(20) });
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.getByText(title, { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  expect(dialog).toBe(false);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
});

test('AC-17/18/19: overdue and upcoming groups, complete moves it to Completed, reopen brings it back', async ({
  page,
}) => {
  const late = unique('LATE');
  const soon = unique('SOON');
  await page.goto('/');
  await signIn(page);
  await addReminder(page, { title: late, date: klDate(-5) });
  await addReminder(page, { title: soon, date: klDate(40) });
  await page.getByRole('link', { name: 'Reminders' }).click();
  await expect(page.getByRole('list', { name: 'Overdue reminders' }).getByText(late)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Upcoming reminders' }).getByText(soon),
  ).toBeVisible();
  await page.getByText(late, { exact: true }).click();
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('list', { name: 'Overdue reminders' })).toHaveCount(0);
  await page.getByLabel(/^Completed \(/).check();
  await expect(
    page.getByRole('list', { name: 'Completed reminders' }).getByText(late),
  ).toBeVisible();
  await page.getByText(late, { exact: true }).click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('list', { name: 'Overdue reminders' }).getByText(late)).toBeVisible();
});

test('AC-20/21/22: template review creates nothing on cancel, and one reminder per accepted item', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/');
  await signIn(page);
  const base = baseURL ?? 'http://localhost:4173';
  const before = (await serverReminders(browser, base)).filter((r) => r.template_ref !== null);
  await page.getByRole('link', { name: 'Reminders' }).click();
  await page.getByRole('link', { name: 'Suggested service schedule' }).click();
  await expect(page.getByTestId('template-source')).toContainText('M12');
  await expect(page.getByTestId('template-caveat')).toContainText('Confirm against your own');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  expect(
    (await serverReminders(browser, base)).filter((r) => r.template_ref !== null),
  ).toHaveLength(before.length);

  await page.getByRole('link', { name: 'Suggested service schedule' }).click();
  await page.getByLabel(/Baseline date/).fill(klDate(-30));
  // Only the next checkpoint is preselected.
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);
  const title = unique('TPL');
  await page
    .locator('input[type="checkbox"]:checked')
    .locator('xpath=ancestor::li')
    .getByLabel('Title')
    .fill(title);
  await page.getByRole('button', { name: 'Create selected reminders' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  const after = await serverReminders(browser, base);
  const made = after.filter((r) => r.title === title);
  expect(made).toHaveLength(1);
  expect(made[0]?.template_ref).toMatch(/^awd-performance-service:1:\d+$/);
  expect(after.filter((r) => r.template_ref !== null)).toHaveLength(before.length + 1);
});

test('AC-24/25: offline create is pending, survives reload, and is sent exactly once', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const title = unique('OFFREM');
  await page.goto('/');
  await signIn(page);
  await page.getByRole('link', { name: 'Reminders' }).click();
  await expect(page.getByRole('link', { name: 'Add reminder' })).toBeVisible();
  await waitForServiceWorker(page);
  await signIn(page);
  await context.setOffline(true);
  await addReminder(page, { title, date: klDate(15) });
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByTestId('sync-pending')).toBeVisible();
  await expect(page.getByTestId('status-computed-offline')).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('pending-count')).toHaveCount(0, { timeout: 15_000 });
  const items = await serverReminders(browser, baseURL ?? 'http://localhost:4173');
  expect(items.filter((r) => r.title === title)).toHaveLength(1);
});
