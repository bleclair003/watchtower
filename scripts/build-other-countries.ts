/**
 * Builds collector/geo/other-countries.json: borders of every country that is NOT a watch
 * country, so the collector can tell "over open water" from "over a non-watch country".
 *
 *   curl -L -o ne50.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
 *   node scripts/build-other-countries.ts ne50.geojson
 *
 * Source: Natural Earth 1:50m Admin 0 countries (public domain). Coordinates are rounded to
 * 0.01° (about 1 km), which is enough to decide land vs sea for an aircraft or ship position.
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Ring = [number, number][];
const input = process.argv[2];
if (!input) throw new Error('usage: node scripts/build-other-countries.ts <ne_50m_admin_0_countries.geojson>');

const watch = JSON.parse(readFileSync(new URL('../collector/geo/watch-countries.json', import.meta.url), 'utf8')) as { countries: Record<string, unknown> };
const ne = JSON.parse(readFileSync(input, 'utf8')) as {
  features: { properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }[];
};

const round = (v: number) => Math.round(v * 100) / 100;
function simplify(ring: number[][]): Ring {
  const out: Ring = [];
  for (const [x, y] of ring) {
    const p: [number, number] = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

const countries: Record<string, Ring[][]> = {};
for (const f of ne.features) {
  const iso = f.properties.ISO_A2_EH && f.properties.ISO_A2_EH !== '-99' ? f.properties.ISO_A2_EH : `X-${f.properties.ADM0_A3}`;
  if (iso in watch.countries) continue;
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : (f.geometry.coordinates as unknown[])) as number[][][][];
  const out = polys.map((p) => p.map(simplify).filter((r) => r.length >= 4)).filter((p) => p.length > 0);
  if (out.length) (countries[iso] ??= []).push(...out);
}

writeFileSync(
  new URL('../collector/geo/other-countries.json', import.meta.url),
  JSON.stringify({ source: 'Natural Earth 1:50m Admin 0 countries (public domain), every country except the watch countries; ISO_A2_EH (X-<ADM0_A3> where none); coordinates rounded to 0.01 deg', countries }),
);
console.log(`${Object.keys(countries).length} countries written`);
