/**
 * Builds public/data/installations-world.json: current military installations OUTSIDE the US
 * (US sites come from the DoD dataset, see build-installations.ts).
 *
 * Source: Wikidata (CC0), via the public SPARQL endpoint. Items that are an instance of a military
 * base class (air base, military base, naval base, military installation, RAF station, Canadian
 * Forces base, radar/missile/listening station, forward/main operating base, space force base …),
 * have a coordinate (P625), and have NO dissolution date (P576). Wikidata coordinates are
 * community-maintained, not official: the app says so.
 *
 * For each: label, coordinate, country (P17, ISO 3166-1 alpha-2 via P297), operators (P137) and
 * their countries, English Wikipedia article, Wikidata id.
 *
 *   node scripts/build-installations-world.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { isCrimea } from '../collector/geo/countries.ts';

/** Short labels for the classes below. */
const KIND: Record<string, string> = {
  Q695850: 'air base', Q245016: 'military base', Q1324633: 'naval base', Q18691599: 'military installation', Q7373622: 'RAF station',
  Q7619063: 'naval shore establishment', Q2886620: 'Canadian Forces base', Q133288241: 'radar station', Q2604714: 'forward operating base',
  Q21193688: 'missile base', Q85881832: 'US base (Okinawa)', Q136558797: 'army base', Q131520524: 'space force base', Q1536137: 'main operating base',
  Q92547605: 'air base annex', Q6646468: 'listening station',
};

const CLASSES = [
  'Q695850', // air base
  'Q245016', // military base
  'Q1324633', // naval base
  'Q18691599', // military installation
  'Q7373622', // Royal Air Force station
  'Q7619063', // naval shore establishment
  'Q2886620', // Canadian Forces base
  'Q133288241', // military radar station
  'Q2604714', // forward operating base
  'Q21193688', // missile base
  'Q85881832', // United States military base in Okinawa
  'Q136558797', // army base
  'Q131520524', // space force base
  'Q1536137', // main operating base
  'Q92547605', // airbase annex
  'Q6646468', // listening station
];

/** One small query per class: a single grouped query over all classes times out (60 s limit). */
const queryFor = (cls: string) => `
SELECT ?item ?itemLabel ?coord ?iso ?countryItemLabel ?op ?opLabel ?opIso ?article WHERE {
  ?item wdt:P31 wd:${cls} ; wdt:P625 ?coord .
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  FILTER NOT EXISTS { ?item wdt:P17 wd:Q30 }
  OPTIONAL { ?item wdt:P17 ?countryItem . ?countryItem wdt:P297 ?iso . }
  OPTIONAL { ?item wdt:P137 ?op . OPTIONAL { ?op wdt:P17 ?opCountry . ?opCountry wdt:P297 ?opIso } }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

type B = Record<string, { value: string } | undefined>;
async function run(cls: string): Promise<B[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
        'User-Agent': 'WATCHTOWER-OSINT/0.15 (personal research; one-off download)',
      },
      body: new URLSearchParams({ query: queryFor(cls) }),
    });
    if (res.ok) return ((await res.json()) as { results: { bindings: B[] } }).results.bindings;
    console.warn(`  ${cls}: HTTP ${res.status} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  throw new Error(`Wikidata query for ${cls} failed 3 times; refusing to write a partial file`);
}

const seen = new Map<string, { qid: string; name: string; lat: number; lon: number; country: string; countryName: string; operators: string[]; operatorCountries: string[]; kinds: string[]; wiki: string | null }>();
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
let total = 0;
for (const cls of CLASSES) {
  const rows = await run(cls);
  total += rows.length;
  console.log(`  ${cls}: ${rows.length} rows`);
  for (const r of rows) {
    const qid = r.item!.value.split('/').pop()!;
    const name = r.itemLabel?.value ?? '';
    const m = r.coord?.value.match(/^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/);
    if (!m || !name || /^Q\d+$/.test(name)) continue; // no English label: skip rather than show an id
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    let rec = seen.get(qid);
    if (!rec) {
      rec = { qid, name, lat: r5(lat), lon: r5(lon), country: '', countryName: '', operators: [], operatorCountries: [], kinds: [], wiki: null };
      seen.set(qid, rec);
    }
    if (!rec.kinds.includes(cls)) rec.kinds.push(cls);
    if (r.iso?.value && !rec.country) {
      rec.country = r.iso.value;
      rec.countryName = r.countryItemLabel?.value ?? '';
    }
    const op = r.opLabel?.value;
    if (op && !/^Q\d+$/.test(op) && !rec.operators.includes(op)) rec.operators.push(op);
    if (r.opIso?.value && !rec.operatorCountries.includes(r.opIso.value)) rec.operatorCountries.push(r.opIso.value);
    if (r.article?.value && !rec.wiki) rec.wiki = r.article.value;
  }
  await new Promise((r) => setTimeout(r, 1500)); // be polite to the public endpoint
}

// Crimea follows the internationally recognised border (as elsewhere in WATCHTOWER).
for (const r of seen.values()) if (r.country === 'RU' && isCrimea(r.lat, r.lon)) r.country = 'UA';

// Compact keys keep the file small: it is loaded in the browser when BASES is on.
const installations = [...seen.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((r) => ({
    q: r.qid,
    n: r.name,
    la: r.lat,
    lo: r.lon,
    c: r.country,
    o: r.operators,
    oc: r.operatorCountries,
    k: r.kinds.map((k) => KIND[k] ?? k),
    w: r.wiki ? decodeURIComponent(r.wiki.replace('https://en.wikipedia.org/wiki/', '')) : null,
  }));
if (installations.length < 1000) throw new Error(`Suspiciously few installations (${installations.length}); refusing to overwrite`);
const out = {
  source: 'Wikidata — military bases with coordinates and no dissolution date, outside the US',
  sourceUrl: 'https://www.wikidata.org/',
  licence: 'CC0 1.0 (Wikidata). Community-maintained, not official.',
  dataCurrency: new Date().toISOString().slice(0, 10),
  coverage: 'Worldwide except the United States (DoD data covers the US)',
  retrievedAt: new Date().toISOString(),
  count: installations.length,
  keys: { q: 'Wikidata id', n: 'name', la: 'latitude', lo: 'longitude', c: 'country (ISO alpha-2)', o: 'operators (may include former)', oc: 'operator countries', k: 'kinds', w: 'English Wikipedia title' },
  installations,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/installations-world.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${installations.length} installations (${Buffer.byteLength(JSON.stringify(out))} bytes) from ${total} rows`);
