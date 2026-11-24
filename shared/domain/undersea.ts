/**
 * Undersea cables and pipelines (v0.71.0), from OpenStreetMap (ODbL 1.0): telecom cables, power cables
 * of 100 kV or more, and oil and gas pipelines in the watch-region seas. Routes are as volunteers traced
 * them: approximate, and missing where nobody has mapped them.
 */
export type UnderseaKind = 'telecom' | 'power' | 'pipeline';
export const UNDERSEA_LABEL: Record<UnderseaKind, string> = { telecom: 'Telecom cable', power: 'Power cable (100 kV+)', pipeline: 'Oil or gas pipeline' };

export interface UnderseaLine {
  /** First OpenStreetMap way, e.g. osm:way/123. */
  id: string;
  k: UnderseaKind;
  n: string | null;
  op: string | null;
  /** Power cables: highest voltage in kV. */
  kv: number | null;
  /** Pipelines: what they carry, as tagged. */
  sub: string | null;
  /** Line parts, each [[lon, lat], …]. */
  g: [number, number][][];
}

export interface UnderseaDataset {
  source: { name: string; url: string; licence: string };
  /** Sea areas covered, bbox [w, s, e, n]. */
  areas: { name: string; bbox: [number, number, number, number] }[];
  retrievedAt: string;
  count: number;
  lines: UnderseaLine[];
}

/** Distance in km from a point to a line part (flat projection, fine at these distances). */
function pointToSegmentKm(lat: number, lon: number, a: [number, number], b: [number, number]): number {
  const k = Math.cos((lat * Math.PI) / 180);
  const ax = (a[0] - lon) * k;
  const ay = a[1] - lat;
  const bx = (b[0] - lon) * k;
  const by = b[1] - lat;
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * 111.195;
}

/** Undersea lines within `maxKm` of a point, nearest first. */
export function nearbyLines(lines: UnderseaLine[], lat: number, lon: number, maxKm: number): { line: UnderseaLine; km: number }[] {
  const out: { line: UnderseaLine; km: number }[] = [];
  const deg = maxKm / 80;
  for (const line of lines) {
    let best = Infinity;
    for (const part of line.g) {
      for (let i = 1; i < part.length; i++) {
        const [a, b] = [part[i - 1], part[i]];
        if (Math.min(a[1], b[1]) - deg > lat || Math.max(a[1], b[1]) + deg < lat) continue;
        best = Math.min(best, pointToSegmentKm(lat, lon, a, b));
      }
    }
    if (best <= maxKm) out.push({ line, km: Math.round(best * 10) / 10 });
  }
  return out.sort((a, b) => a.km - b.km);
}

export const underseaName = (l: UnderseaLine) => l.n ?? `Unnamed ${UNDERSEA_LABEL[l.k].toLowerCase()}`;
