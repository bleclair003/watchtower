import AxeBuilder from '@axe-core/playwright';
import { ROUTES, expect, openModule, test } from './fixtures';

/**
 * Automated WCAG 2.1 A/AA checks on every module. Automated checks catch only part of the problems;
 * docs/SECURITY_AND_ACCESSIBILITY.md lists what was reviewed by hand.
 * The map canvas is excluded: the feed and tables carry the same data in accessible form.
 */
for (const r of ROUTES) {
  test(`${r.title} has no WCAG A/AA violations`, async ({ page }) => {
    await openModule(page, r.path, r.title);
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('.maplibregl-canvas')
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')} — ${v.help}`,
    );
    expect(summary).toEqual([]);
  });
}
