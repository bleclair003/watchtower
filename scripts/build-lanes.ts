/**
 * Builds public/data/lanes.json: global commercial shipping lanes (major, middle, minor) as lines.
 *
 *   node scripts/build-lanes.ts
 *
 * Source: Benden, P. (2022) "Global Shipping Lanes", https://doi.org/10.5281/zenodo.6361763, via
 * github.com/newzealandpaul/Shipping-Lanes. Georeferenced from the CIA "Map of the World's Oceans"
 * (October 2012). Its LICENSE file is CC BY 4.0 and its README says CC BY-SA 4.0 (both "excluding
 * Statista"); WATCHTOWER follows the stricter one: credit the author, and this derived file is shared
 * under CC BY-SA 4.0. Lanes show where traffic usually runs, not live traffic.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { LanesDataset, LaneClass } from '../shared/domain/shipTraffic.ts';

const URL_GEOJSON = 'https://raw.githubusercontent.com/newzealandpaul/Shipping-Lanes/main/data/Shipping_Lanes_v1.geojson';
const res = await fetch(URL_GEOJSON, { headers: { 'User-Agent': 'WATCHTOWER-OSINT/0.75 (personal research; one-off download)' } });
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const fc = (await res.json()) as { features: { properties: { Type?: string }; geometry: { type: string; coordinates: [number, number][][] | [number, number][] } }[] };

function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = dx || dy ? Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy) : Math.hypot(x - a[0], y - a[1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  return max > tol ? [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)] : [a, b];
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const lanes: LanesDataset['lanes'] = [];
let points = 0;
for (const f of fc.features) {
  const cls = (f.properties.Type ?? '').toLowerCase() as LaneClass;
  if (!['major', 'middle', 'minor'].includes(cls)) continue;
  const parts = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) as [number, number][][];
  const simplified = parts.map((p) => simplify(p.map(([x, y]) => [r2(x), r2(y)] as [number, number]), 0.03)).filter((p) => p.length >= 2);
  points += simplified.reduce((a, p) => a + p.length, 0);
  lanes.push({ c: cls, g: simplified });
}
if (lanes.length !== 3) throw new Error(`Expected 3 lane classes, got ${lanes.length}; refusing to overwrite`);
const out: LanesDataset = {
  source: {
    name: 'Global Shipping Lanes v1 — Benden, P. (2022), doi:10.5281/zenodo.6361763, from the CIA Map of the World’s Oceans (2012)',
    url: 'https://github.com/newzealandpaul/Shipping-Lanes',
    licence: 'CC BY-SA 4.0 (the source states CC BY 4.0 and CC BY-SA 4.0; the stricter is followed)',
  },
  retrievedAt: new Date().toISOString(),
  lanes,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/lanes.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote 3 lane classes, ${points} points`);
