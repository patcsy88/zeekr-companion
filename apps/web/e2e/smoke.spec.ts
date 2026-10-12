import { expect, test } from '@playwright/test';
import { addRecord, signIn, unique } from './helpers';

// Rough Safari-engine smoke test only. WebKit in Playwright is not iOS Safari and does not
// prove standalone PWA behaviour.
test('WebKit: sign in, create a record, see it listed', async ({ page }) => {
  const description = unique('WK');
  await page.goto('/');
  await signIn(page);
  await addRecord(page, { description });
  await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveCount(0);
});
