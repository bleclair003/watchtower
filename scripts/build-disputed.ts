/**
 * Builds public/data/disputed.json: disputed areas, breakaway regions and claim areas worldwide, from
 * Natural Earth's 1:10m "Admin 0 – Breakaway, Disputed Areas" (public domain; "Made with Natural Earth").
 *
 *   node scripts/build-disputed.ts
 *
 * Natural Earth draws lines as they are on the ground ("de facto"), with a note saying who administers
 * and who claims each area. WATCHTOWER shows that note; it does not take a side.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DisputedDataset } from '../shared/domain/disputed.ts';

const URL_10M = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_disputed_areas.geojson';
const res = await fetch(URL_10M, { headers: { 'User-Agent': 'WATCHTOWER-OSINT/0.71 (personal research; one-off download)' } });
if (!res.ok) throw new Error(`Natural Earth download failed: HTTP ${res.status}`);
const fc = (await res.json()) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
function ring(r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of r) {
    const p: [number, number] = [r3(x), r3(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : r.map(([x, y]) => [r3(x), r3(y)] as [number, number]);
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const features: DisputedDataset['features'] = [];
for (const [i, f] of fc.features.entries()) {
  const p = f.properties;
  const g = f.geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as [number, number][][][];
  features.push({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: polys.map((poly) => poly.map(ring)) },
    properties: {
      id: `ne:${i}`,
      name: str(p.BRK_NAME) ?? str(p.NAME) ?? 'Unnamed area',
      note: str(p.NOTE_BRK),
      kind: str(p.TYPE) ?? str(p.featurecla) ?? 'Disputed',
      sovereign: str(p.SOVEREIGNT),
    },
  });
}
if (features.length < 30) throw new Error(`Suspiciously few areas (${features.length}); refusing to overwrite`);
const out: DisputedDataset = {
  type: 'FeatureCollection',
  source: { name: "Natural Earth — Admin 0 breakaway and disputed areas (1:10m)", url: 'https://www.naturalearthdata.com/', licence: 'Public domain ("Made with Natural Earth")' },
  retrievedAt: new Date().toISOString(),
  features,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/disputed.json', import.meta.url), JSON.stringify(out));
const kinds = new Map<string, number>();
for (const f of features) kinds.set(f.properties.kind, (kinds.get(f.properties.kind) ?? 0) + 1);
console.log(`Wrote ${features.length} areas: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
