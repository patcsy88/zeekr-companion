import { expect, test, type Page } from '@playwright/test';
import { PRODUCTION_CSP } from '../csp';
import { addRecord, safePastDate, signIn, unique } from './helpers';

// Runs the app under the production CSP (served by vite preview, copied from infra/Caddyfile) and
// fails on any securitypolicyviolation event or console message about CSP.
async function watchCsp(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.exposeFunction('__reportCsp', (m: string) => found.push(m));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      void (window as unknown as { __reportCsp: (m: string) => void }).__reportCsp(
        `${e.violatedDirective} blocked ${e.blockedURI}`,
      );
    });
  });
  page.on('console', (m) => {
    if (/content security policy|refused to (load|execute|apply|connect)/i.test(m.text()))
      found.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    if (/content security policy/i.test(e.message)) found.push(`pageerror: ${e.message}`);
  });
  return found;
}

test('the page is served with the production CSP header', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toBe(PRODUCTION_CSP);
  expect(res?.headers()['x-content-type-options']).toBe('nosniff');
});

test('using the whole app raises no CSP violation', async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('link', { name: 'Vehicle' }).click();
  await expect(page.getByRole('heading', { name: 'Vehicle' })).toBeVisible();
  const description = unique('CSP');
  await page.getByRole('link', { name: 'Service' }).click();
  await addRecord(page, { description, date: safePastDate() });
  await page.getByRole('link', { name: new RegExp(description) }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Notes').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Service history' })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await page.reload(); // the service worker registers and serves the shell
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('the detector itself works: an inline script is blocked and reported', async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto('/');
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__ran = 1';
    document.body.appendChild(s);
  });
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as unknown as { __ran?: number }).__ran),
  ).toBeUndefined();
});
