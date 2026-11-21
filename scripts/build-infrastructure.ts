/**
 * Builds public/data/infrastructure.json: critical infrastructure in the watch-region countries.
 *
 *   node scripts/build-infrastructure.ts
 *
 * Sources (one-off downloads, re-run to refresh):
 *  - WRI Global Power Plant Database v1.3.0 (CC BY 4.0), GitHub raw CSV: plants of 500 MW or more
 *    and every nuclear plant. Data to 2021.
 *  - Wikidata (CC0) via the public SPARQL endpoint: all nuclear power plants and oil refineries, and
 *    dams and ports with an English Wikipedia article, one small query per class (larger ones time out).
 * Coordinates come only from these sources; nothing is placed by hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { isCrimea } from '../collector/geo/countries.ts';
import { distanceKm } from '../shared/domain/installations.ts';
import type { InfraDataset, InfraSite, InfraType } from '../shared/domain/infrastructure.ts';

const UA = { 'User-Agent': 'WATCHTOWER-OSINT/0.38 (personal research; one-off download)' };
const ISO2 = 'IL PS LB SY JO IQ IR SA KW BH QA AE OM UA RU BY MD PL LT LV EE RO TW KP KR PH VN MY BN YE ER DJ SO'.split(' ');
const ISO3: Record<string, string> = {
  ISR: 'IL', PSE: 'PS', LBN: 'LB', SYR: 'SY', JOR: 'JO', IRQ: 'IQ', IRN: 'IR', SAU: 'SA', KWT: 'KW', BHR: 'BH', QAT: 'QA', ARE: 'AE', OMN: 'OM',
  UKR: 'UA', RUS: 'RU', BLR: 'BY', MDA: 'MD', POL: 'PL', LTU: 'LT', LVA: 'LV', EST: 'EE', ROU: 'RO', TWN: 'TW', PRK: 'KP', KOR: 'KR',
  PHL: 'PH', VNM: 'VN', MYS: 'MY', BRN: 'BN', YEM: 'YE', ERI: 'ER', DJI: 'DJ', SOM: 'SO',
};
const MIN_MW = 500;
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const fixCrimea = (s: InfraSite) => (s.c === 'RU' && isCrimea(s.la, s.lo) ? { ...s, c: 'UA' } : s);

// ---------------------------------------------------------------- WRI power plants
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n') row.push(cell), rows.push(row), (row = []), (cell = '');
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

const WRI_URL = 'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv';
const csvRes = await fetch(WRI_URL, { headers: UA });
if (!csvRes.ok) throw new Error(`WRI download failed: HTTP ${csvRes.status}`);
const [head, ...rows] = parseCsv(await csvRes.text());
const col = (n: string) => head.indexOf(n);
const wri: InfraSite[] = [];
for (const r of rows) {
  const c = ISO3[r[col('country')]];
  if (!c) continue;
  const mw = Number(r[col('capacity_mw')]);
  const fuel = r[col('primary_fuel')];
  const nuclear = fuel === 'Nuclear';
  if (!nuclear && !(mw >= MIN_MW)) continue;
  const la = Number(r[col('latitude')]);
  const lo = Number(r[col('longitude')]);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
  wri.push(fixCrimea({ id: `gppd:${r[col('gppd_idnr')]}`, n: [r[col('name')]], t: nuclear ? 'nuclear' : 'power', la: r5(la), lo: r5(lo), c, f: fuel, mw: Math.round(mw), s: ['wri'] }));
}
console.log(`WRI: ${wri.length} plants (${wri.filter((s) => s.t === 'nuclear').length} nuclear)`);

// ---------------------------------------------------------------- Wikidata
async function sparql(query: string) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    // GET: on 2026-11-21 the endpoint answered GET while POSTed queries returned 502/504.
    const res = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query, format: 'json' })}`, {
      headers: { ...UA, Accept: 'application/sparql-results+json' },
      signal: AbortSignal.timeout(75_000),
    });
    if (res.ok) return ((await res.json()) as { results: { bindings: Record<string, { value: string } | undefined>[] } }).results.bindings;
    console.warn(`  HTTP ${res.status} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 8_000 * attempt));
  }
  throw new Error('Wikidata query failed 6 times; refusing to write a partial file');
}
const countries = await sparql(`SELECT ?c ?iso WHERE { VALUES ?iso { ${ISO2.map((x) => `"${x}"`).join(' ')} } ?c wdt:P297 ?iso . }`);
const isoOf = new Map(countries.map((r) => [r.c!.value.split('/').pop()!, r.iso!.value]));
const countryValues = [...isoOf.keys()].map((q) => `wd:${q}`).join(' ');
console.log(`Wikidata: ${isoOf.size} countries`);
/** [class, type, require an English Wikipedia article]: small critical classes are kept whole; dams and ports need an article (notability). */
const CLASSES: [string, InfraType, boolean][] = [['Q134447', 'nuclear', false], ['Q12353044', 'refinery', false], ['Q12323', 'dam', true], ['Q44782', 'port', true], ['Q15310171', 'port', true]];
const wd = new Map<string, InfraSite>();
for (const [cls, t, needArticle] of CLASSES) {
  // Kept as simple as the probe that ran in about a second: country codes and the "dissolved"
  // check are resolved here, because adding them to the query made the planner time out (504).
  const rs = await sparql(`SELECT ?item ?itemLabel ?coord ?country ?dissolved ?article WHERE {
    VALUES ?country { ${countryValues} }
    ?item wdt:P31 wd:${cls} ; wdt:P17 ?country ; wdt:P625 ?coord .
    ${needArticle ? '' : 'OPTIONAL {'} ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . ${needArticle ? '' : '}'}
    OPTIONAL { ?item wdt:P576 ?dissolved }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`);
  let added = 0;
  for (const r of rs) {
    const qid = r.item!.value.split('/').pop()!;
    const name = r.itemLabel?.value ?? '';
    const m = r.coord?.value.match(/^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/);
    if (!m || !name || /^Q\d+$/.test(name) || wd.has(qid) || r.dissolved) continue;
    wd.set(qid, fixCrimea({ id: `wd:${qid}`, n: [name], t, la: r5(Number(m[2])), lo: r5(Number(m[1])), c: isoOf.get(r.country!.value.split('/').pop()!) ?? '', w: r.article ? decodeURIComponent(r.article.value.replace('https://en.wikipedia.org/wiki/', '')) : null, s: ['wikidata'] }));
    added++;
  }
  console.log(`Wikidata ${cls} (${t}): ${added}`);
  await new Promise((r) => setTimeout(r, 1500));
}

// ---------------------------------------------------------------- merge
// A Wikidata nuclear plant within 5 km of a WRI nuclear plant is the same site: keep WRI's capacity,
// add Wikidata's name and article.
const sites: InfraSite[] = [...wri];
for (const s of wd.values()) {
  const same = s.t === 'nuclear' ? sites.find((x) => x.t === 'nuclear' && distanceKm(x.la, x.lo, s.la, s.lo) <= 5) : undefined;
  if (same) {
    same.n = [s.n[0], ...same.n.filter((n) => n !== s.n[0])];
    same.w = s.w;
    same.s = [...new Set([...same.s, ...s.s])];
  } else sites.push(s);
}
if (sites.length < 500) throw new Error(`Suspiciously few sites (${sites.length}); refusing to overwrite`);
sites.sort((a, b) => a.t.localeCompare(b.t) || a.n[0].localeCompare(b.n[0]));

const out: InfraDataset = {
  sources: [
    { name: 'World Resources Institute — Global Power Plant Database v1.3.0', url: 'https://datasets.wri.org/dataset/globalpowerplantdatabase', licence: 'CC BY 4.0 (credit: World Resources Institute)', dataCurrency: '2021' },
    { name: 'Wikidata — nuclear power plants and oil refineries; dams and ports with an English Wikipedia article', url: 'https://www.wikidata.org/', licence: 'CC0 1.0 (community-maintained, not official)', dataCurrency: new Date().toISOString().slice(0, 10) },
  ],
  retrievedAt: new Date().toISOString(),
  count: sites.length,
  sites,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/infrastructure.json', import.meta.url), JSON.stringify(out));
const by = (t: InfraType) => sites.filter((s) => s.t === t).length;
console.log(`Wrote ${sites.length} sites: nuclear ${by('nuclear')}, power ${by('power')}, refinery ${by('refinery')}, dam ${by('dam')}, port ${by('port')}`);
