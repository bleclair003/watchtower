import { test as base, expect, type Page } from '@playwright/test';

/** Every module route, with the document title it sets. */
export const ROUTES = [
  { path: '/', title: 'GOC' },
  { path: '/sources', title: 'SOURCES' },
  { path: '/diagnostics', title: 'DIAGNOSTICS' },
  { path: '/settings', title: 'SETTINGS' },
  { path: '/indicators', title: 'INDICATORS' },
  { path: '/alerts', title: 'ALERTS' },
  { path: '/dossiers', title: 'DOSSIERS' },
  { path: '/sitrep', title: 'SITREP' },
  { path: '/replay', title: 'REPLAY' },
  { path: '/signal-lab', title: 'SIGNAL LAB' },
] as const;

/**
 * Collects page errors, console errors and CSP violations. Map tiles come from OpenFreeMap; when the
 * test machine is offline those requests fail, so network-level failures to that host are ignored.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (/openfreemap\.org/.test(text) && /Failed to fetch|ERR_|NetworkError/.test(text)) return;
      problems.push(`console: ${text}`);
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    await use(problems);
  },
});

export { expect };

export async function openModule(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page).toHaveTitle(`WATCHTOWER // ${title}`);
  await expect(page.getByText('LOADING MODULE…')).toHaveCount(0);
  await expect(page.getByText('MODULE FAILURE')).toHaveCount(0);
}
