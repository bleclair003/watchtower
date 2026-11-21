import { expect, openModule, test } from './fixtures';

test('navigation bar reaches a module and marks it current', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await nav.getByRole('link', { name: 'SIGNAL LAB' }).click();
  await expect(page).toHaveURL(/\/signal-lab$/);
  await expect(nav.getByRole('link', { name: 'SIGNAL LAB' })).toHaveAttribute('aria-current', 'page');
});

test('command console: "/" focuses it and commands navigate', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  await page.locator('body').press('/');
  const input = page.getByRole('combobox', { name: 'Command or search' });
  await expect(input).toBeFocused();
  await input.fill('sitrep');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/sitrep$/);
  await expect(page).toHaveTitle('WATCHTOWER // SITREP');
});

test('unknown route shows a recoverable not-found screen', async ({ page }) => {
  await page.goto('/no-such-module');
  await expect(page.getByText('ROUTE NOT RECOGNIZED')).toBeVisible();
  await page.getByRole('link', { name: '[RETURN TO GOC]' }).click();
  await expect(page).toHaveTitle('WATCHTOWER // GOC');
});

test('SITREP generates all sections plus limitations from demo data', async ({ page, problems }) => {
  await openModule(page, '/sitrep', 'SITREP');
  await page.getByRole('button', { name: '7D' }).click();
  await page.getByRole('button', { name: 'GENERATE' }).click();
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await expect(page.getByText(new RegExp(`^${n}\\. `)).first()).toBeVisible();
  await expect(page.getByText('Limitations', { exact: true })).toBeVisible();
  await expect(page.getByText(/dashboard data \(demo mode, no archive\)/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('external source links open safely in a new tab', async ({ page }) => {
  await openModule(page, '/sources', 'SOURCES');
  const links = page.locator('a[target="_blank"]');
  expect(await links.count()).toBeGreaterThan(0);
  for (const rel of await links.evaluateAll((as) => as.map((a) => a.getAttribute('rel') ?? ''))) {
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  }
  for (const protocol of await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).protocol))) {
    expect(['https:', 'http:']).toContain(protocol);
  }
});

test('security headers are served', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('keyboard: first Tab reaches the skip link, which moves focus to the content', async ({ page }) => {
  await openModule(page, '/sources', 'SOURCES');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('feed can switch between grouped stories and all items', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const toggle = page.getByRole('button', { name: /^STORIES (ON|OFF)$/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveText('STORIES OFF');
});

test('military installations layer: toggle and data file with its licence', async ({ page, request }) => {
  const res = await request.get('/data/installations-us.json');
  expect(res.ok()).toBe(true);
  const data = await res.json();
  expect(data.count).toBeGreaterThan(800);
  expect(data.licence).toMatch(/CC BY 4\.0/);
  await openModule(page, '/', 'GOC');
  const bases = page.getByRole('button', { name: 'BASES' });
  await expect(bases).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Installations \(DoD, US\)/)).toBeVisible();
  await bases.click();
  await expect(bases).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Installations \(DoD, US\)/)).toHaveCount(0);
  // Hiding the layer also hides the operator filter.
  await expect(page.getByRole('combobox', { name: 'Show bases operated by' })).toHaveCount(0);
});

test('military aircraft layer: simulated in demo mode, labelled, and can be hidden', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const air = page.getByRole('button', { name: 'AIR', exact: true });
  await expect(air).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Aircraft \(ADS-B\) · SIMULATED/)).toBeVisible();
  await air.click();
  await expect(air).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Aircraft \(ADS-B\)/)).toHaveCount(0);
});

test('military installations: filter by operating country', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const select = page.getByRole('combobox', { name: 'Show bases operated by' });
  await expect(select).toBeVisible();
  await expect(select.locator('option[value="RU"]')).toHaveCount(1);
  await select.selectOption('RU');
  await expect(page.getByText('Operated by Russia only')).toBeVisible();
  // DoD sites are all US-operated, so a Russia filter shows none of them.
  await expect(page.getByText(/Installations \(DoD, US\)/).locator('..')).toContainText('0');
  await select.selectOption('ALL');
  await expect(page.getByText(/Operated by .* only/)).toHaveCount(0);
});
