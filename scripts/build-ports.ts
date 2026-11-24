/**
 * Builds public/data/ports-extra.json: ports and harbours in the Baltic and North Sea countries outside
 * the watch regions (Finland, Sweden, Denmark, Germany, Norway), from Wikidata (CC0). The collector uses
 * them, with the ports already in infrastructure.json, so ships at or near a port are not taken for
 * ships going dark or lingering over cables. Not drawn on the map.
 *
 *   node scripts/build-ports.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'WATCHTOWER-OSINT/0.77 (personal research; one-off download)', Accept: 'application/sparql-results+json' };
const COUNTRIES: Record<string, string> = { Q33: 'FI', Q34: 'SE', Q35: 'DK', Q183: 'DE', Q20: 'NO' };
/** port, seaport, harbor, ferry port, marina excluded (too many, mostly small craft). */
const CLASSES = ['wd:Q44782', 'wd:Q15310171', 'wd:Q283202', 'wd:Q2143825'];

async function sparql(query: string) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query, format: 'json' })}`, { headers: UA, signal: AbortSignal.timeout(90_000) });
    if (res.ok) return ((await res.json()) as { results: { bindings: Record<string, { value: string } | undefined>[] } }).results.bindings;
    console.warn(`  HTTP ${res.status} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, res.status === 429 ? 65_000 : 8_000 * attempt));
  }
  throw new Error('Wikidata query failed 6 times; refusing to write a partial file');
}

const out: { n: string; la: number; lo: number; c: string }[] = [];
const seen = new Set<string>();
for (const [q, iso] of Object.entries(COUNTRIES)) {
  const rows = await sparql(`SELECT ?item ?itemLabel ?coord WHERE {
    VALUES ?cls { ${CLASSES.join(' ')} }
    ?item wdt:P31 ?cls ; wdt:P17 wd:${q} ; wdt:P625 ?coord .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,${iso.toLowerCase()}". }
  }`);
  let added = 0;
  for (const r of rows) {
    const id = r.item!.value.split('/').pop()!;
    const m = r.coord?.value.match(/^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/);
    if (!m || seen.has(id)) continue;
    seen.add(id);
    out.push({ n: r.itemLabel?.value ?? id, la: Math.round(Number(m[2]) * 1e4) / 1e4, lo: Math.round(Number(m[1]) * 1e4) / 1e4, c: iso });
    added++;
  }
  console.log(`${iso}: ${added} ports`);
  await new Promise((r) => setTimeout(r, 65_000)); // the endpoint allows about one query a minute while throttling
}
if (out.length < 100) throw new Error(`Suspiciously few ports (${out.length}); refusing to overwrite`);
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../public/data/ports-extra.json', import.meta.url),
  JSON.stringify({ source: { name: 'Wikidata — ports and harbours in FI, SE, DK, DE, NO', url: 'https://www.wikidata.org/', licence: 'CC0 1.0' }, retrievedAt: new Date().toISOString(), ports: out }),
);
console.log(`Wrote ${out.length} ports`);
