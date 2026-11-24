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
  await expect(page.getByText(/Bases: DoD, US/)).toBeVisible();
  await bases.click();
  await expect(bases).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Bases: DoD, US/)).toHaveCount(0);
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

test('sanctioned vessels layer: simulated in demo mode and can be hidden', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const btn = page.getByRole('button', { name: 'SANCTIONED', exact: true });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Sanctioned vessels \(48 h\) · SIMULATED/)).toBeVisible();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Sanctioned vessels \(48 h\)/)).toHaveCount(0);
});

test('satellite imagery: off by default, product and date selectable, credited', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const select = page.getByRole('combobox', { name: 'Satellite imagery' });
  await expect(select).toHaveValue('off');
  await expect(page.getByLabel('Imagery date')).toHaveCount(0);
  await select.selectOption('viirs');
  await expect(page.getByLabel('Imagery date')).toBeVisible();
  await expect(page.getByText(/True colour · VIIRS NOAA-20 · \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Map legend' }).getByText(/NASA EOSDIS GIBS/)).toBeVisible();
  await select.selectOption('night-2016');
  await expect(page.getByLabel('Imagery date')).toHaveCount(0); // fixed-date baseline
  await expect(page.getByText(/Black Marble 2016 · 2016-01-01/)).toBeVisible();
  await select.selectOption('off');
});

test('chokepoint layer: toggle is on by default and can be hidden', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const straits = page.getByRole('button', { name: 'STRAITS', exact: true });
  await expect(straits).toHaveAttribute('aria-pressed', 'true');
  await straits.click();
  await expect(straits).toHaveAttribute('aria-pressed', 'false');
});

test('US Navy fleet layer: simulated in demo mode, dated, and can be hidden', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const fleet = page.getByRole('button', { name: 'FLEET', exact: true });
  await expect(fleet).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/US Navy \(USNI\) · SIMULATED/)).toBeVisible();
  await expect(page.getByText(/approximate areas/)).toBeVisible();
  await fleet.click();
  await expect(fleet).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/US Navy \(USNI\)/)).toHaveCount(0);
});

test('military installations: filter by operating country', async ({ page }) => {
  await openModule(page, '/', 'GOC');
  const select = page.getByRole('combobox', { name: 'Show bases operated by' });
  await expect(select).toBeVisible();
  await expect(select.locator('option[value="RU"]')).toHaveCount(1);
  await select.selectOption('RU');
  await expect(page.getByText('Operated by Russia only')).toBeVisible();
  // DoD sites are all US-operated, so a Russia filter shows none of them.
  await expect(page.getByText(/Bases: DoD, US/).locator('..')).toContainText('0');
  await select.selectOption('ALL');
  await expect(page.getByText(/Operated by .* only/)).toHaveCount(0);
});

test('meters: region grid opens a detail with parts and limits; region page has a meter strip', async ({ page, problems }) => {
  await openModule(page, '/meters', 'METERS');
  await expect(page.getByText(/None is a probability of conflict/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Meters and monitors' }).getByText('SIMULATED')).toBeVisible();
  const ladder = page.getByRole('row', { name: /MIDEAST/ }).getByRole('button').first();
  await ladder.click();
  await expect(page).toHaveURL(/m=escalation\.middle-east/);
  const detail = page.getByRole('article', { name: 'MIDEAST escalation ladder' });
  await expect(detail.getByText('4 Consequences')).toBeVisible();
  await expect(detail.getByText(/Rungs describe the kind of activity/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Days since' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Coming up/ }).getByText(/Classified payload/)).toBeVisible();

  await openModule(page, '/regions/middle-east', 'MIDEAST');
  const strip = page.getByRole('list', { name: 'Region meters' });
  await strip.getByRole('button', { name: /Escalation ladder/ }).click();
  await expect(page.getByRole('article', { name: 'MIDEAST escalation ladder' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('alert scorecard: simulated in demo mode, with shares, a noisy rule and the missed log', async ({ page, problems }) => {
  await page.goto('/alerts');
  await page.getByRole('button', { name: 'SCORECARD' }).click();
  await expect(page.getByText(/\[SIMULATED\] Demo numbers/)).toBeVisible();
  await expect(page.getByText('15 of 19 alerts')).toBeVisible();
  await expect(page.getByText('NOISY', { exact: true })).toBeVisible();
  await expect(page.getByText(/1 missed · 1 late/)).toBeVisible();
  await expect(page.getByText(/runs in the last 7 days/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('map tools: a link restores region and ruler, search finds a base and updates the link', async ({ page, problems }) => {
  await page.goto('/?at=26.5,56.3,5&region=middle-east&ruler=55.1,25.2;57.4,26.6');
  await expect(page.getByText('THEATRE // MIDDLE EAST', { exact: false })).toBeVisible();
  await expect(page.getByText(/278 km · 150 nm · bearing 055° \(NE\)/)).toBeVisible();
  const search = page.getByRole('combobox', { name: /find on map/i });
  await search.fill('ramstein');
  await expect(page.getByRole('listbox', { name: 'Map search results' }).getByRole('option').first()).toContainText('Ramstein');
  await search.press('Enter');
  await expect(page).toHaveURL(/sel=base:/);
  await expect(page).toHaveURL(/ruler=55\.1,25\.2;57\.4,26\.6/);
  await page.getByRole('button', { name: 'RULER' }).click();
  await expect(page.getByText(/Click again to start a new measurement/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/Click again to start a new measurement/)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('GPS interference layer: simulated squares, legend, and a card with nearby NGA warnings', async ({ page, problems }) => {
  await page.goto('/?at=55,21,4.5&layers=gaj&sel=gnss:54|19');
  const card = page.getByRole('region', { name: /GPS interference square/ });
  await expect(card).toContainText('34% degraded: 41 of 120 aircraft sightings');
  await expect(card).toContainText('HYDROLANT 9003/26');
  await expect(card).toContainText('SIMULATED');
  await expect(page).toHaveURL(/sel=gnss:54\|19/);
  await card.getByRole('button', { name: 'Close GPS interference details' }).click();
  await expect(page).not.toHaveURL(/sel=gnss/);
  await page.getByRole('button', { name: 'GPS', exact: true }).click();
  await expect(page).toHaveURL(/layers=ga(&|$)/);
  expect(problems).toEqual([]);
});

test('CYBER page: simulated route hijack, large leak, and DDoS levels with a surge', async ({ page, problems }) => {
  await page.goto('/cyber');
  await expect(page.getByText(/AS64512 \[SIMULATED\] Example Transit \(RU\) announced 2 blocks/)).toBeVisible();
  await expect(page.getByText(/leaked 340 blocks from 12 networks to 4 peers/)).toBeVisible();
  await expect(page.getByText('SURGE 100%')).toBeVisible();
  // The same-country hijack is routine: hidden until asked for.
  await expect(page.getByText(/Example Local ISP/)).toHaveCount(0);
  // The CISA panel above has its own routine button; the routing panel's is the last one.
  await page.getByRole('button', { name: 'show 1 routine' }).last().click();
  await expect(page.getByText(/Example Local ISP/)).toBeVisible();
  await expect(page.getByText(/No data: KP, ER/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('undersea and disputed layers: search a cable, open its card, and a disputed area from a link', async ({ page, problems }) => {
  await page.goto('/?at=59.5,24,5&layers=gaud');
  const search = page.getByRole('combobox', { name: /find on map/i });
  await search.fill('c-lion');
  await expect(page.getByRole('listbox', { name: 'Map search results' }).getByRole('option').first()).toContainText('C-Lion 1');
  await search.press('Enter');
  const card = page.getByRole('region', { name: 'Undersea line: C-Lion 1' });
  await expect(card).toContainText('Telecom cable');
  await expect(card).toContainText('ODbL');
  await expect(page).toHaveURL(/sel=cable:osm:way\/\d+/);
  await search.fill('golan');
  await search.press('Enter');
  const area = page.getByRole('region', { name: 'Disputed area: Golan Heights' });
  await expect(area).toContainText(/Admin\. [Bb]y Israel/);
  await expect(area).toContainText('not WATCHTOWER');
  expect(problems).toEqual([]);
});

test('watch areas: draw a circle, name and save it, see its card and its page', async ({ page, problems }) => {
  await page.goto('/?at=59.5,24.5,7&layers=gam');
  const map = page.locator('[aria-label="World map of plotted events"]');
  await expect(map).toBeVisible();
  await page.waitForTimeout(1500); // map style and layers load
  await page.getByRole('button', { name: 'AREA', exact: true }).click();
  const box = (await map.boundingBox())!;
  const cx = box.x + box.width * 0.6;
  const cy = box.y + box.height * 0.55;
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 60, cy);
  const panel = page.getByRole('dialog', { name: 'Draw a watch area' });
  await expect(panel).toContainText(/circle, [\d.]+ km radius/);
  await panel.getByLabel('NAME').fill('Test zone');
  await panel.getByRole('button', { name: 'SAVE (THIS BROWSER)' }).click();
  const card = page.getByRole('region', { name: 'Watch area: Test zone' });
  await expect(card).toContainText('RECORDS INSIDE');
  await expect(page).toHaveURL(/sel=warea:area-/);
  await card.getByRole('link', { name: 'Open area page' }).click();
  await expect(page.getByText('Watch area // Test zone', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'All watch areas' }).click();
  await expect(page.getByRole('link', { name: 'Test zone' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('watch areas: draw a polygon corner by corner, finish, and save', async ({ page, problems }) => {
  await page.goto('/?at=59.5,24.5,7&layers=gam');
  const map = page.locator('[aria-label="World map of plotted events"]');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'AREA', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Draw a watch area' });
  await panel.getByRole('button', { name: 'POLYGON' }).click();
  const box = (await map.boundingBox())!;
  const at = (fx: number, fy: number) => page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await at(0.55, 0.45);
  await at(0.75, 0.45);
  await at(0.75, 0.65);
  await expect(panel).toContainText('3 corners');
  await at(0.6, 0.7);
  await panel.getByRole('button', { name: 'FINISH' }).click();
  await expect(panel).toContainText(/polygon, 4 points/);
  await panel.getByLabel('NAME').fill('Test polygon');
  await panel.getByRole('button', { name: 'SAVE (THIS BROWSER)' }).click();
  await expect(page.getByRole('region', { name: 'Watch area: Test polygon' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('ships and lanes: simulated tankers with 24-hour tracks, a ship card from search, lanes legend', async ({ page, problems }) => {
  await page.goto('/?at=58,24,4&layers=gatl');
  const search = page.getByRole('combobox', { name: /find on map/i });
  await search.fill('primorsk');
  await expect(page.getByRole('listbox', { name: 'Map search results' }).getByRole('option').first()).toContainText('TANKER / CARGO');
  await search.press('Enter');
  const card = page.getByRole('region', { name: /^Tanker: \[SIMULATED\] TEST TANKER/ });
  await expect(card).toContainText('AIS type 84');
  await expect(card).toContainText('PRIMORSK');
  await expect(card).toContainText(/4 positions from/);
  await expect(page).toHaveURL(/sel=ship:999000001/);
  // The legend may already be open on a wide screen.
  const lanesLine = page.getByText('Shipping lanes (major, middle, minor)');
  if (!(await lanesLine.isVisible())) await page.getByRole('button', { name: /legend/i }).first().click();
  await expect(lanesLine).toBeVisible();
  await expect(page.getByText(/1,840 ship types remembered/)).toBeVisible();
  await expect(page.getByText('Went dark (last known position)')).toBeVisible();
  await expect(page.getByText(/572 positions last run/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('Taiwan Strait region page: daily PLA activity panel (simulated)', async ({ page, problems }) => {
  await page.goto('/regions/taiwan-strait');
  const latest = page.getByLabel('Latest day');
  await expect(latest).toContainText('SURGE');
  await expect(latest).toContainText('71');
  await expect(latest).toContainText('crossed the median line');
  await expect(page.getByText(/compilation: Skyfaring’s PLA Tracker/)).toBeVisible();
  await expect(page.getByText('SIMULATED').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('Alert rule builder: convergence presets fill the rule (simulated)', async ({ page, problems }) => {
  await page.goto('/alerts');
  const newRule = page.getByRole('button', { name: /new rule/i }).first();
  if (await newRule.count()) await newRule.click();
  await page.getByRole('button', { name: 'NEW STRONG CONVERGENCE' }).click();
  await expect(page.getByPlaceholder('e.g. Red Sea maritime official reports')).toHaveValue('New STRONG signal convergence');
  await expect(page.getByLabel('Field').nth(1)).toHaveValue('metadata.level');
  expect(problems).toEqual([]);
});

test('Signal convergence: region panel lists hotspots and opens the map card (simulated)', async ({ page, problems }) => {
  await page.goto('/regions/eastern-europe');
  const list = page.getByRole('list', { name: 'Convergence hotspots' });
  await expect(list).toContainText('STRONG');
  await expect(list).toContainText('Ship went dark');
  await expect(list).toContainText('NGA navigational warnings');
  await list.getByRole('link', { name: 'Show on the map' }).first().click();
  const card = page.getByRole('region', { name: /Signal convergence near/ });
  await expect(card).toContainText('3 independent feeds');
  await expect(card).toContainText('not evidence that they are linked');
  await expect(card).toContainText('SIMULATED');
  await expect(page).toHaveURL(/sel=conv/);
  await card.getByRole('button', { name: 'Close convergence details' }).click();
  await expect(page).not.toHaveURL(/sel=conv/);
  // The Middle East hotspot is a WATCH: an aircraft orbit and a fire cluster, two feeds.
  await page.goto('/regions/middle-east');
  await expect(page.getByRole('list', { name: 'Convergence hotspots' })).toContainText('WATCH');
  // Country convergence (v0.80.0): signals without a position, by country.
  const countries = page.getByRole('list', { name: 'Country convergence' });
  await expect(countries).toContainText('United Arab Emirates');
  await expect(countries).toContainText('IODA internet measurements');
  await countries.getByText('Signals (7)').click();
  await expect(countries).toContainText('Route leak by an invented network');
  expect(problems).toEqual([]);
});

test('Eastern Europe region page: tanker traffic levels in the Gulf of Finland (simulated)', async ({ page, problems }) => {
  await page.goto('/regions/eastern-europe');
  const panel = page.getByRole('region', { name: 'Tanker levels by zone' });
  await expect(panel).toContainText('Primorsk and Vyborg approaches');
  await expect(panel).toContainText('DROP -4.6');
  await expect(panel).toContainText('building (4/7 days)');
  expect(problems).toEqual([]);
});
