import { expect, test, type Page } from '@playwright/test';

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('appearance: Dark and Light override the phone setting and survive a reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const picker = page.getByRole('button', { name: /^Appearance:/ });
  await expect(picker).toHaveAccessibleName('Appearance: Auto');
  const lightBg = await background(page);

  await picker.click(); // Light
  await picker.click(); // Dark
  await expect(picker).toHaveAccessibleName('Appearance: Dark');
  await expect.poll(() => background(page)).not.toBe(lightBg);
  const darkBg = await background(page);
  await page.reload();
  await expect(picker).toHaveAccessibleName('Appearance: Dark');
  expect(await background(page)).toBe(darkBg);

  // The phone is now dark, but Light was chosen: the page stays light.
  await picker.click(); // Auto
  await picker.click(); // Light
  await expect(picker).toHaveAccessibleName('Appearance: Light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).toBe(lightBg);

  // Auto follows the phone again, and storage holds only the choice.
  await picker.click(); // Dark
  await picker.click(); // Auto
  await expect(picker).toHaveAccessibleName('Appearance: Auto');
  await expect.poll(() => background(page)).toBe(darkBg);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).toBe('{}');
});
