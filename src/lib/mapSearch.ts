import type { AircraftPosition } from '@shared/domain/aircraft';
import type { ChokepointReading } from '@shared/domain/chokepoints';
import type { FleetArea } from '@shared/domain/fleet';
import type { FlaggedSite, InfraSite } from '@shared/domain/infrastructure';
import type { Installation, WorldInstallation } from '@shared/domain/installations';
import type { Airport } from '@shared/domain/radio';
import type { SanctionedShipSighting } from '@shared/domain/sanctionedShips';
import { WATCH_REGIONS } from '@shared/domain/regions';
import type { MapSelection } from './mapLink';
import { UNDERSEA_LABEL, type UnderseaLine } from '@shared/domain/undersea';
import type { DisputedDataset } from '@shared/domain/disputed';
import { TRAFFIC_LABEL, type TrafficShip } from '@shared/domain/shipTraffic';
import { INFRA_LABEL } from '@shared/domain/infrastructure';

/**
 * Map search (v0.68.0): finds what is already loaded on the map, so a search costs no reads.
 * Layers that are switched off are not searched; the search box says which.
 */
export type SearchKind = 'region' | 'base' | 'aircraft' | 'ship' | 'traffic' | 'fleet' | 'strait' | 'infra' | 'cable' | 'area' | 'airport';
export const KIND_LABEL: Record<SearchKind, string> = {
  region: 'REGION',
  base: 'BASE',
  aircraft: 'AIRCRAFT',
  ship: 'SANCTIONED SHIP',
  traffic: 'TANKER / CARGO',
  fleet: 'US NAVY',
  strait: 'STRAIT',
  infra: 'SITE',
  cable: 'UNDERSEA',
  area: 'DISPUTED AREA',
  airport: 'AIRPORT',
};

export interface SearchItem {
  kind: SearchKind;
  /** Shown as the result line. */
  label: string;
  /** Second line: what else matched or where it is. */
  detail: string;
  /** Lower-case text the query is matched against. */
  text: string;
  lat: number;
  lon: number;
  /** What to select on the map; null for a plain location (airport) or a region. */
  select: MapSelection | null;
  regionId?: string;
}

export interface SearchSources {
  bases?: Installation[];
  worldBases?: WorldInstallation[];
  aircraft?: AircraftPosition[];
  ships?: SanctionedShipSighting[];
  fleet?: FleetArea[];
  straits?: ChokepointReading[];
  infra?: InfraSite[];
  flaggedInfra?: FlaggedSite[];
  airports?: Airport[];
  undersea?: UnderseaLine[];
  traffic?: TrafficShip[];
  disputed?: DisputedDataset['features'];
}

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function buildSearchIndex(s: SearchSources): SearchItem[] {
  const out: SearchItem[] = [];
  const add = (it: Omit<SearchItem, 'text'>, extra: (string | null | undefined)[] = []) =>
    out.push({ ...it, text: norm([it.label, it.detail, ...extra].filter(Boolean).join(' ')) });

  for (const r of WATCH_REGIONS) {
    if (!r.bbox) continue;
    const [w, so, e, n] = r.bbox;
    add({ kind: 'region', label: r.name, detail: r.shortCode, lat: (so + n) / 2, lon: (w + e) / 2, select: null, regionId: r.id }, [r.id]);
  }
  for (const b of s.bases ?? []) add({ kind: 'base', label: b.name, detail: [b.component, b.state].filter(Boolean).join(' · '), lat: b.lat, lon: b.lon, select: { kind: 'base', key: `dod:${b.name}` } });
  for (const b of s.worldBases ?? []) add({ kind: 'base', label: b.n, detail: b.c, lat: b.la, lon: b.lo, select: { kind: 'base', key: `wd:${b.q}` } }, [b.q, ...b.oc]);
  for (const a of s.aircraft ?? []) {
    const label = a.cs?.trim() || a.reg || a.hex.toUpperCase();
    add({ kind: 'aircraft', label, detail: [a.t, a.reg, a.hex.toUpperCase(), a.cls].filter(Boolean).join(' · '), lat: a.la, lon: a.lo, select: { kind: 'air', key: a.hex } });
  }
  for (const v of s.ships ?? []) {
    const key = v.imo ?? `mmsi:${v.mmsi}`;
    add(
      { kind: 'ship', label: v.listedName, detail: [v.aisName && v.aisName !== v.listedName ? `AIS ${v.aisName}` : null, v.imo ? `IMO ${v.imo}` : null, `MMSI ${v.mmsi}`].filter(Boolean).join(' · '), lat: v.la, lon: v.lo, select: { kind: 'listed', key } },
      [v.destination],
    );
  }
  for (const f of s.fleet ?? []) {
    if (!f.point) continue;
    add({ kind: 'fleet', label: f.name, detail: f.ships.map((x) => `${x.name} (${x.hull})`).join(', ').slice(0, 140), lat: f.point[0], lon: f.point[1], select: { kind: 'fleet', key: f.name } }, f.ships.map((x) => `${x.name} ${x.hull}`));
  }
  for (const c of s.straits ?? []) add({ kind: 'strait', label: c.name, detail: 'Chokepoint traffic', lat: c.lat, lon: c.lon, select: { kind: 'strait', key: c.id } });
  const seenInfra = new Set<string>();
  for (const f of s.flaggedInfra ?? []) {
    seenInfra.add(f.id);
    add({ kind: 'infra', label: f.name, detail: `${f.type} · ${f.country} · flagged`, lat: f.lat, lon: f.lon, select: { kind: 'infra', key: f.id } });
  }
  for (const i of s.infra ?? []) {
    if (seenInfra.has(i.id) || !i.n[0]) continue;
    add({ kind: 'infra', label: i.n[0], detail: `${INFRA_LABEL[i.t]} · ${i.c}`, lat: i.la, lon: i.lo, select: { kind: 'infra', key: i.id } }, [...i.n.slice(1), i.t]);
  }
  for (const t of s.traffic ?? []) {
    add(
      { kind: 'traffic', label: t.name ?? `MMSI ${t.mmsi}`, detail: [TRAFFIC_LABEL[t.kind], t.imo ? `IMO ${t.imo}` : null, `MMSI ${t.mmsi}`, t.destination ? `to ${t.destination}` : null].filter(Boolean).join(' · '), lat: t.la, lon: t.lo, select: { kind: 'ship', key: t.mmsi } },
      [t.kind],
    );
  }
  for (const l of s.undersea ?? []) {
    if (!l.n) continue;
    const mid = l.g[0][Math.floor(l.g[0].length / 2)];
    add({ kind: 'cable', label: l.n, detail: [UNDERSEA_LABEL[l.k], l.op].filter(Boolean).join(' · '), lat: mid[1], lon: mid[0], select: { kind: 'cable', key: l.id } });
  }
  for (const f of s.disputed ?? []) {
    const pts = f.geometry.coordinates.flat(2);
    const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const lon = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    add({ kind: 'area', label: f.properties.name, detail: f.properties.note ?? f.properties.kind, lat, lon, select: { kind: 'area', key: f.properties.id } });
  }
  for (const a of s.airports ?? []) add({ kind: 'airport', label: `${a.icao} ${a.name}`, detail: a.region, lat: a.lat, lon: a.lon, select: null });
  return out;
}

/**
 * Every query word must appear. Ranked: label starts with the query, then a word in the label starts with
 * it, then anywhere; ties by kind order (regions first) and label.
 */
export function searchMap(index: SearchItem[], query: string, limit = 12): SearchItem[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const kindOrder = Object.keys(KIND_LABEL);
  const scored: { it: SearchItem; score: number }[] = [];
  for (const it of index) {
    if (!words.every((w) => it.text.includes(w))) continue;
    const label = norm(it.label);
    const score = label === q ? 0 : label.startsWith(q) ? 1 : label.split(/[\s(·/-]+/).some((w) => w.startsWith(words[0])) ? 2 : 3;
    scored.push({ it, score });
  }
  scored.sort((a, b) => a.score - b.score || kindOrder.indexOf(a.it.kind) - kindOrder.indexOf(b.it.kind) || a.it.label.localeCompare(b.it.label));
  return scored.slice(0, limit).map((s) => s.it);
}
