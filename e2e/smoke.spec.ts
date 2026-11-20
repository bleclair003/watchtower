import { ROUTES, expect, openModule, test } from './fixtures';

test.describe('every module loads cleanly', () => {
  for (const r of ROUTES) {
    test(`${r.title} loads without errors or CSP violations`, async ({ page, problems }) => {
      await openModule(page, r.path, r.title);
      await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
      // Demo builds must always say so.
      await expect(page.getByText(/DEMONSTRATION DATA/)).toBeVisible();
      await page.waitForTimeout(300);
      expect(problems).toEqual([]);
    });

    test(`${r.title} does not scroll sideways`, async ({ page }) => {
      await openModule(page, r.path, r.title);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
