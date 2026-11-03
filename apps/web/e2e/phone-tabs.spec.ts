import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// iPhone-width screens: every tab must be on screen, because the bar is fixed and cannot scroll.
for (const width of [320, 375, 390, 430]) {
  test(`all six tabs fit inside a ${width}px wide screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await signIn(page);
    const links = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
    await expect(links).toHaveCount(6);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
}
