/**
 * Builds public/data/infrastructure.json: critical infrastructure in the watch-region countries.
 *
 *   node scripts/build-infrastructure.ts
 *   node scripts/build-infrastructure.ts --new-types-only   (keeps the file, refreshes only nuclear sites and embassies)
 *
 * Sources (one-off downloads, re-run to refresh):
 *  - WRI Global Power Plant Database v1.3.0 (CC BY 4.0), GitHub raw CSV: plants of 500 MW or more
 *    and every nuclear plant. Data to 2021.
 *  - Wikidata (CC0) via the public SPARQL endpoint: all nuclear power plants and oil refineries, and
 *    dams and ports with an English Wikipedia article, one small query per class (larger ones time out).
 *    From v0.71.0 also other nuclear facilities (research reactors, enrichment, fuel cycle; "nuclear
 *    facility" and "research reactor" and their direct subclasses) and embassies and consulates (and
 *    their direct subclasses, such as "Embassy of the United States").
 * Coordinates come only from these sources; nothing is placed by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isCrimea } from '../collector/geo/countries.ts';
import { distanceKm } from '../shared/domain/installations.ts';
import { INFRA_TYPES as INFRA_TYPES_LIST, type InfraDataset, type InfraSite, type InfraType } from '../shared/domain/infrastructure.ts';

const UA = { 'User-Agent': 'WATCHTOWER-OSINT/0.38 (personal research; one-off download)' };
const ISO2 = 'IL PS LB SY JO IQ IR SA KW BH QA AE OM UA RU BY MD PL LT LV EE RO TW KP KR PH VN MY BN YE ER DJ SO'.split(' ');
const ISO3: Record<string, string> = {
  ISR: 'IL', PSE: 'PS', LBN: 'LB', SYR: 'SY', JOR: 'JO', IRQ: 'IQ', IRN: 'IR', SAU: 'SA', KWT: 'KW', BHR: 'BH', QAT: 'QA', ARE: 'AE', OMN: 'OM',
  UKR: 'UA', RUS: 'RU', BLR: 'BY', MDA: 'MD', POL: 'PL', LTU: 'LT', LVA: 'LV', EST: 'EE', ROU: 'RO', TWN: 'TW', PRK: 'KP', KOR: 'KR',
  PHL: 'PH', VNM: 'VN', MYS: 'MY', BRN: 'BN', YEM: 'YE', ERI: 'ER', DJI: 'DJ', SOM: 'SO',
};
const MIN_MW = 500;
const NEW_TYPES_ONLY = process.argv.includes('--new-types-only');
const NEW_TYPES: InfraType[] = ['nuclear-site', 'embassy'];
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
const existing = NEW_TYPES_ONLY ? (JSON.parse(readFileSync(new URL('../public/data/infrastructure.json', import.meta.url), 'utf8')) as InfraDataset) : null;
const csvText = existing ? '' : await (async () => {
  const csvRes = await fetch(WRI_URL, { headers: UA });
  if (!csvRes.ok) throw new Error(`WRI download failed: HTTP ${csvRes.status}`);
  return csvRes.text();
})();
const [head, ...rows] = existing ? [[], []] : parseCsv(csvText);
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
    // 429: the endpoint may allow one query a minute (as during an outage on 2026-11-23).
    await new Promise((r) => setTimeout(r, res.status === 429 ? 65_000 : 8_000 * attempt));
  }
  throw new Error('Wikidata query failed 6 times; refusing to write a partial file');
}
const countries = await sparql(`SELECT ?c ?iso WHERE { VALUES ?iso { ${ISO2.map((x) => `"${x}"`).join(' ')} } ?c wdt:P297 ?iso . }`);
const isoOf = new Map(countries.map((r) => [r.c!.value.split('/').pop()!, r.iso!.value]));
const countryValues = [...isoOf.keys()].map((q) => `wd:${q}`).join(' ');
console.log(`Wikidata: ${isoOf.size} countries`);
/**
 * [class pattern, type, require an English Wikipedia article]: small critical classes are kept whole; dams
 * and ports need an article (notability). A pattern is a property path and object for ?item.
 */
const OLD_CLASSES: [string, InfraType, boolean][] = [
  ['wdt:P31 wd:Q134447', 'nuclear', false],
  ['wdt:P31 wd:Q12353044', 'refinery', false],
  ['wdt:P31 wd:Q12323', 'dam', true],
  ['wdt:P31 wd:Q44782', 'port', true],
  ['wdt:P31 wd:Q15310171', 'port', true],
];
const NEW_CLASSES: [string, InfraType, boolean][] = [
  // nuclear facility, research reactor (and direct subclasses); power plants are already in the file.
  ['wdt:P31/wdt:P279? wd:Q1739545', 'nuclear-site', false],
  ['wdt:P31/wdt:P279? wd:Q1438105', 'nuclear-site', false],
  // embassy, consulate (and direct subclasses such as "Embassy of the United States").
  ['wdt:P31/wdt:P279? wd:Q3917681', 'embassy', false],
  ['wdt:P31/wdt:P279? wd:Q7843791', 'embassy', false],
];
const CLASSES = NEW_TYPES_ONLY ? NEW_CLASSES : [...OLD_CLASSES, ...NEW_CLASSES];
const wd = new Map<string, InfraSite>();
for (const [cls, t, needArticle] of CLASSES) {
  // Kept as simple as the probe that ran in about a second: country codes and the "dissolved"
  // check are resolved here, because adding them to the query made the planner time out (504).
  const rs = await sparql(`SELECT ?item ?itemLabel ?coord ?country ?dissolved ?article WHERE {
    VALUES ?country { ${countryValues} }
    ?item ${cls} ; wdt:P17 ?country ; wdt:P625 ?coord .
    ${t === 'nuclear-site' ? 'FILTER NOT EXISTS { ?item wdt:P31 wd:Q134447 }' : ''}
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
  // One query a minute keeps within the endpoint's limit when it is throttling.
  await new Promise((r) => setTimeout(r, NEW_TYPES_ONLY ? 65_000 : 1500));
}

// ---------------------------------------------------------------- merge
// A Wikidata nuclear plant within 5 km of a WRI nuclear plant is the same site: keep WRI's capacity,
// add Wikidata's name and article.
const sites: InfraSite[] = existing ? existing.sites.filter((s) => !NEW_TYPES.includes(s.t)) : [...wri];
for (const s of wd.values()) {
  // A nuclear facility within 3 km of a nuclear power plant is the plant (some items carry both classes).
  if (s.t === 'nuclear-site' && sites.some((x) => x.t === 'nuclear' && distanceKm(x.la, x.lo, s.la, s.lo) <= 3)) continue;
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
    {
      name: 'Wikidata — nuclear power plants, other nuclear facilities, oil refineries, embassies and consulates; dams and ports with an English Wikipedia article',
      url: 'https://www.wikidata.org/',
      licence: 'CC0 1.0 (community-maintained, not official)',
      dataCurrency: new Date().toISOString().slice(0, 10),
    },
  ],
  retrievedAt: new Date().toISOString(),
  count: sites.length,
  sites,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/infrastructure.json', import.meta.url), JSON.stringify(out));
const by = (t: InfraType) => sites.filter((s) => s.t === t).length;
console.log(`Wrote ${sites.length} sites: ${INFRA_TYPES_LIST.map((t) => `${t} ${by(t)}`).join(', ')}`);
