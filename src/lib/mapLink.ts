import { EVENT_CATEGORIES, type EventCategory } from '@shared/domain/types';
import { getRegion } from '@shared/domain/regions';
import type { OperatorSettings } from '../state/SettingsContext';
import { DEFAULT_FILTERS, type DashboardFilters, type SourceClassFilter } from './filters';
import type { LonLat } from './measure';
import { IMAGERY } from './imagery';

/**
 * Shareable GOC links (v0.68.0). The address bar holds the map view, the layers, the feed filters, the
 * selected item and a ruler measurement, so copying, bookmarking or reloading the page brings the same
 * view back. Every value read from a link is checked; anything unknown or out of range is dropped.
 */

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

export const SELECTION_KINDS = ['event', 'base', 'air', 'fleet', 'strait', 'listed', 'infra', 'gnss', 'cable', 'area', 'warea', 'ship', 'conv', 'sat'] as const;
export type SelectionKind = (typeof SELECTION_KINDS)[number];
export interface MapSelection {
  kind: SelectionKind;
  key: string;
}

/** Map layer toggles in link order, each with a one-letter code. */
export const LAYER_CODES = {
  graticule: 'g',
  regionOutlines: 'a',
  installations: 'b',
  aircraft: 'p',
  fleet: 'f',
  chokepoints: 's',
  sanctionedShips: 'x',
  infrastructure: 'i',
  powerOutages: 'w',
  faa: 'q',
  radiation: 'r',
  navWarnings: 'n',
  conflicts: 'c',
  gnss: 'j',
  undersea: 'u',
  disputed: 'd',
  watchAreas: 'm',
  traffic: 't',
  lanes: 'l',
  convergence: 'v',
  satellites: 'o',
} as const satisfies Partial<Record<keyof OperatorSettings, string>>;
export type LayerKey = keyof typeof LAYER_CODES;
const LAYER_KEYS = Object.keys(LAYER_CODES) as LayerKey[];

export type LinkSettings = Pick<OperatorSettings, LayerKey | 'installationsOperator' | 'navWarnDays' | 'conflictDays' | 'imagery' | 'imageryDate'>;

export interface MapLinkState {
  view: MapView | null;
  settings: Partial<LinkSettings>;
  filters: Partial<DashboardFilters>;
  selection: MapSelection | null;
  ruler: [LonLat, LonLat] | null;
}

const IMAGERY_IDS = ['off', ...Object.keys(IMAGERY)];
const CLASSES: SourceClassFilter[] = ['all', 'official', 'non-official'];
const KEYWORD_MAX = 100;
const KEY_MAX = 200;

const fix = (n: number, d: number) => String(Number(n.toFixed(d)));
const clampLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function encodeMapLink(s: { view: MapView | null; settings: LinkSettings; filters: DashboardFilters; selection: MapSelection | null; ruler: [LonLat, LonLat] | null }): string {
  const p = new URLSearchParams();
  if (s.view) p.set('at', `${fix(s.view.lat, 3)},${fix(clampLon(s.view.lon), 3)},${fix(s.view.zoom, 2)}`);
  p.set('layers', LAYER_KEYS.filter((k) => s.settings[k]).map((k) => LAYER_CODES[k]).join('') || '-');
  if (s.settings.installations && s.settings.installationsOperator && s.settings.installationsOperator !== 'ALL') p.set('op', s.settings.installationsOperator);
  if (s.settings.navWarnings && s.settings.navWarnDays != null) p.set('nav', String(s.settings.navWarnDays));
  if (s.settings.conflicts && s.settings.conflictDays != null) p.set('cfl', String(s.settings.conflictDays));
  if (s.settings.imagery && s.settings.imagery !== 'off') p.set('img', s.settings.imageryDate ? `${s.settings.imagery},${s.settings.imageryDate}` : s.settings.imagery);
  const f = s.filters;
  if (f.regionId) p.set('region', f.regionId);
  if (f.windowHours !== DEFAULT_FILTERS.windowHours) p.set('win', f.windowHours == null ? 'all' : String(f.windowHours));
  if (f.categories.length) p.set('cat', f.categories.join(','));
  if (f.sourceId) p.set('src', f.sourceId);
  if (f.sourceClass !== 'all') p.set('cls', f.sourceClass);
  if (f.keyword) p.set('q', f.keyword.slice(0, KEYWORD_MAX));
  if (f.showOffTopic) p.set('offtopic', '1');
  if (f.showRoutine) p.set('routine', '1');
  if (s.selection) p.set('sel', `${s.selection.kind}:${s.selection.key}`);
  if (s.ruler) p.set('ruler', s.ruler.map(([lo, la]) => `${fix(lo, 4)},${fix(la, 4)}`).join(';'));
  // Commas, semicolons and colons are safe in a query string; leaving them readable keeps links short.
  return p.toString().replace(/%2C/g, ',').replace(/%3B/g, ';').replace(/%3A/g, ':').replace(/%7C/g, '|').replace(/%2F/g, '/');
}

const finite = (x: string | undefined) => (x != null && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const lonLat = (s: string): LonLat | null => {
  const [lo, la] = s.split(',').map(finite);
  return lo != null && la != null && Math.abs(la) <= 90 && Math.abs(lo) <= 540 ? [lo, la] : null;
};
const dayCount = (s: string | null) => {
  const n = finite(s ?? undefined);
  return n != null && Number.isInteger(n) && n >= 1 && n <= 400 ? n : undefined;
};

/** Reads a link's query string. Returns null when it carries no map state at all. */
export function decodeMapLink(search: string): MapLinkState | null {
  const p = new URLSearchParams(search);
  const known = ['at', 'layers', 'region', 'win', 'cat', 'src', 'cls', 'q', 'offtopic', 'routine', 'sel', 'ruler', 'op', 'nav', 'cfl', 'img'];
  if (!known.some((k) => p.has(k))) return null;

  let view: MapView | null = null;
  const at = p.get('at')?.split(',').map(finite);
  if (at && at.length === 3 && at.every((x) => x != null)) {
    const [lat, lon, zoom] = at as number[];
    if (Math.abs(lat) <= 85 && Math.abs(lon) <= 540) view = { lat, lon: clampLon(lon), zoom: Math.min(12, Math.max(0.8, zoom)) };
  }

  const settings: Partial<LinkSettings> = {};
  const layers = p.get('layers');
  if (layers != null && /^(-|[a-z]{0,20})$/.test(layers)) for (const k of LAYER_KEYS) settings[k] = layers.includes(LAYER_CODES[k]);
  const op = p.get('op');
  if (op && /^[A-Z]{2}$/.test(op)) settings.installationsOperator = op;
  const nav = dayCount(p.get('nav'));
  if (nav) settings.navWarnDays = nav;
  const cfl = dayCount(p.get('cfl'));
  if (cfl) settings.conflictDays = cfl;
  const [imgId, imgDate] = (p.get('img') ?? '').split(',');
  if (IMAGERY_IDS.includes(imgId)) {
    settings.imagery = imgId;
    if (imgDate && /^\d{4}-\d{2}-\d{2}$/.test(imgDate)) settings.imageryDate = imgDate;
  }

  const filters: Partial<DashboardFilters> = {};
  const region = p.get('region');
  if (region && getRegion(region)) filters.regionId = region;
  const win = p.get('win');
  if (win === 'all') filters.windowHours = null;
  else if (win) {
    const h = finite(win);
    if (h != null && Number.isInteger(h) && h > 0 && h <= 24 * 366) filters.windowHours = h;
  }
  const cats = (p.get('cat') ?? '').split(',').filter((c): c is EventCategory => (EVENT_CATEGORIES as readonly string[]).includes(c));
  if (cats.length) filters.categories = [...new Set(cats)];
  const src = p.get('src');
  if (src && /^[a-z0-9-]{1,60}$/.test(src)) filters.sourceId = src;
  const cls = p.get('cls') as SourceClassFilter | null;
  if (cls && CLASSES.includes(cls)) filters.sourceClass = cls;
  const q = p.get('q');
  if (q) filters.keyword = q.slice(0, KEYWORD_MAX);
  if (p.get('offtopic') === '1') filters.showOffTopic = true;
  if (p.get('routine') === '1') filters.showRoutine = true;

  let selection: MapSelection | null = null;
  const sel = p.get('sel');
  if (sel) {
    const i = sel.indexOf(':');
    const kind = sel.slice(0, i) as SelectionKind;
    const key = sel.slice(i + 1);
    if (i > 0 && SELECTION_KINDS.includes(kind) && key.length > 0 && key.length <= KEY_MAX) selection = { kind, key };
  }

  let ruler: [LonLat, LonLat] | null = null;
  const r = p.get('ruler')?.split(';').map(lonLat);
  if (r && r.length === 2 && r[0] && r[1]) ruler = [r[0], r[1]];

  return { view, settings, filters, selection, ruler };
}

/** The view a fresh visit opens on: the last one, kept in this browser. */
export const VIEW_STORAGE_KEY = 'wt.mapView.v1';
export function validView(v: unknown): MapView | null {
  if (!v || typeof v !== 'object') return null;
  const { lat, lon, zoom } = v as Record<string, unknown>;
  return typeof lat === 'number' && typeof lon === 'number' && typeof zoom === 'number' && Math.abs(lat) <= 85 && Math.abs(lon) <= 180 && zoom >= 0.8 && zoom <= 12
    ? { lat, lon, zoom }
    : null;
}
