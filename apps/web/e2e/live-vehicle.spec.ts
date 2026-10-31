import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// The e2e stack runs with the live provider off (the default), so no Zeekr call is possible.
test('ADR-009: the card says live readings are off, the history is empty, nothing is cached', async ({
  page,
}) => {
  await page.goto('/');
  await signIn(page);

  await page.getByRole('link', { name: 'Vehicle', exact: true }).click();
  await expect(page.getByTestId('live-off')).toHaveText('Live readings are off.');
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);

  await page.evaluate(() => {
    window.history.pushState({}, '', '/vehicle/live');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('live-history-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete all/ })).toHaveCount(0);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls;
  });
  expect(cached.filter((u) => u.includes('/live-vehicle') || u.includes('/api/'))).toEqual([]);
});
