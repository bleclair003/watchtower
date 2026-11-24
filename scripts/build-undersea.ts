/**
 * Builds public/data/undersea.json: undersea telecom cables, power cables (100 kV+) and oil and gas
 * pipelines in the watch-region seas, from OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors).
 *
 *   node scripts/build-undersea.ts
 *
 * One Overpass query per sea area. OpenStreetMap maps what volunteers have traced: busy European waters
 * are well covered, other seas less so, and routes are approximate. TeleGeography's cable data was not
 * used: its raw data is sold under a paid licence (only its map images are CC BY-SA).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { UnderseaDataset, UnderseaKind, UnderseaLine } from '../shared/domain/undersea.ts';

const UA = { 'User-Agent': 'WATCHTOWER-OSINT/0.71 (personal research; one-off download)' };
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
/** [name, south, west, north, east] */
const AREAS: [string, number, number, number, number][] = [
  ['Baltic and North Sea', 53, 9, 66, 31],
  ['Black Sea', 40, 27, 47.5, 42],
  ['Eastern Mediterranean', 30, 25, 37.5, 37],
  ['Gulf and Hormuz', 22, 47, 31, 60],
  ['Red Sea and Gulf of Aden', 11, 32, 30, 52],
  ['Korea and the Sea of Japan', 32, 123, 40, 132],
  ['Taiwan Strait', 20, 116, 27, 124],
  ['South China Sea', 0, 103, 23, 122],
];
const UNDER = '["location"~"^(underwater|submarine)$"]';

async function overpass(query: string): Promise<{ elements: { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] }> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const url = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(240_000) });
      if (res.ok) return (await res.json()) as never;
      console.warn(`  ${url}: HTTP ${res.status} (attempt ${attempt})`);
    } catch (err) {
      console.warn(`  ${url}: ${err instanceof Error ? err.message : err} (attempt ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, 20_000 * attempt));
  }
  throw new Error('Overpass failed 6 times; refusing to write a partial file');
}

function kindOf(t: Record<string, string>): UnderseaKind | null {
  if (t.communication === 'line' || t.telecom === 'line') return 'telecom';
  if (t.power === 'cable') {
    const kv = Math.max(0, ...String(t.voltage ?? '').split(/[;,]/).map((v) => Number(v) / 1000).filter(Number.isFinite));
    return kv >= 100 || /hvdc/i.test(t.name ?? '') ? 'power' : null;
  }
  if (t.man_made === 'pipeline') return /^(gas|natural_gas|oil|crude_oil|fuel|hydrocarbons|lng|condensate|petroleum)$/i.test(t.substance ?? t.type ?? '') ? 'pipeline' : null;
  return null;
}

/** Douglas–Peucker on lon/lat degrees. */
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
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const lines = new Map<string, UnderseaLine>();
const seenWays = new Set<number>();
for (const [area, s, w, n, e] of AREAS) {
  const bb = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:200];(way["communication"="line"]${UNDER}${bb};way["telecom"="line"]${UNDER}${bb};way["power"="cable"]${UNDER}${bb};way["man_made"="pipeline"]${UNDER}${bb};);out tags geom;`;
  const d = await overpass(q);
  let kept = 0;
  for (const el of d.elements) {
    if (el.type !== 'way' || !el.geometry?.length || seenWays.has(el.id)) continue;
    const t = el.tags ?? {};
    const k = kindOf(t);
    if (!k) continue;
    seenWays.add(el.id);
    const name = (t.name ?? t['name:en'] ?? '').trim() || null;
    const key = name ? `${k}|${name.toLowerCase()}` : `${k}|way/${el.id}`;
    const pts = simplify(
      el.geometry.map((p) => [r3(p.lon), r3(p.lat)] as [number, number]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]),
      0.003,
    );
    if (pts.length < 2) continue;
    const kv = k === 'power' ? Math.max(0, ...String(t.voltage ?? '').split(/[;,]/).map((v) => Number(v) / 1000).filter(Number.isFinite)) || null : null;
    const prev = lines.get(key);
    if (prev) prev.g.push(pts);
    else lines.set(key, { id: `osm:way/${el.id}`, k, n: name, op: t.operator?.trim() || null, kv, sub: k === 'pipeline' ? (t.substance ?? t.type ?? null) : null, g: [pts] });
    kept++;
  }
  console.log(`${area}: ${d.elements.length} ways, ${kept} kept`);
  await new Promise((r) => setTimeout(r, 5000));
}

const all = [...lines.values()].sort((a, b) => a.k.localeCompare(b.k) || (a.n ?? '~').localeCompare(b.n ?? '~'));
const by = (k: UnderseaKind) => all.filter((l) => l.k === k).length;
if (by('telecom') < 20 || by('pipeline') < 5) throw new Error(`Suspiciously few lines (${all.length}); refusing to overwrite`);
const out: UnderseaDataset = {
  source: { name: 'OpenStreetMap — undersea telecom cables, power cables 100 kV+, oil and gas pipelines', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0 (© OpenStreetMap contributors)' },
  areas: AREAS.map(([name, s, w, n, e]) => ({ name, bbox: [w, s, e, n] as [number, number, number, number] })),
  retrievedAt: new Date().toISOString(),
  count: all.length,
  lines: all,
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/undersea.json', import.meta.url), JSON.stringify(out));
console.log(`Wrote ${all.length} lines: telecom ${by('telecom')} (${all.filter((l) => l.k === 'telecom' && l.n).length} named), power ${by('power')}, pipeline ${by('pipeline')}`);
