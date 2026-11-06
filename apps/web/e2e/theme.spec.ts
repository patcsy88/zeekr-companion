import { expect, test, type Page } from '@playwright/test';

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('appearance: Dark and Light override the phone setting and survive a reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const picker = page.getByLabel('Appearance');
  await expect(picker).toHaveValue('system');
  const lightBg = await background(page);

  await picker.selectOption('dark');
  await expect.poll(() => background(page)).not.toBe(lightBg);
  const darkBg = await background(page);
  await page.reload();
  await expect(page.getByLabel('Appearance')).toHaveValue('dark');
  expect(await background(page)).toBe(darkBg);

  // The phone is now dark, but Light was chosen: the page stays light.
  await page.getByLabel('Appearance').selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).toBe(lightBg);

  // Auto follows the phone again, and storage holds only the choice.
  await page.getByLabel('Appearance').selectOption('system');
  await expect.poll(() => background(page)).toBe(darkBg);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).toBe('{}');
});
