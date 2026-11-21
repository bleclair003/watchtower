import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { US_STATE_NAMES } from '../../shared/domain/geo/usPlaces.ts';
import {
  MAP_MAX_COUNTIES,
  MAP_MAX_PATH_CHARS,
  MAP_MIN_COUNTY_OUT,
  ODIN_PAGE,
  STATE_RECORD_STEPS,
  outerRings,
  packRings,
  type PowerOutageCounty,
  type PowerOutageSnapshot,
  type PowerOutageState,
} from '../../shared/domain/powerOutages.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const ODIN_SOURCE_ID = 'odin-power-outages';
/** Public, anonymous API (no key): active outages by county, with county outlines. */
export const ODIN_MAP_URL = 'https://odin.ornl.gov/odi/map?scale=COUNTY';
/** Utilities currently sending data, with their outage counts. */
export const ODIN_STATUS_URL = 'https://odin.ornl.gov/odi/status';

export interface OdinState {
  lastFetchedAt: string;
  latest: PowerOutageSnapshot | null;
}

interface OdinOutage {
  utilityName?: unknown;
  metersOut?: unknown;
}
interface OdinMapRow {
  id?: unknown;
  countyName?: unknown;
  stateName?: unknown;
  metersOut?: unknown;
  outages?: OdinOutage[];
  feature?: { type?: unknown; coordinates?: unknown } | null;
}
interface OdinStatusRow {
  totalOutages?: unknown;
  hasError?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const STATE_CODE: Record<string, string> = Object.fromEntries(Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
const fmt = (n: number) => n.toLocaleString('en-US');

/** Builds the snapshot from ODIN's county map rows and utility status rows. Pure. */
export function buildOutageSnapshot(rows: OdinMapRow[], status: OdinStatusRow[], nowIso: string): PowerOutageSnapshot {
  const counties: (PowerOutageCounty & { rings: number })[] = [];
  const states = new Map<string, PowerOutageState & { utilities: Map<string, number> }>();
  for (const r of rows) {
    const fips = str(r.id);
    const out = num(r.metersOut);
    if (!/^\d{5}$/.test(fips) || out === 0) continue;
    const stateName = str(r.stateName) || 'Unknown state';
    const byUtility = new Map<string, number>();
    for (const o of r.outages ?? []) {
      const name = str(o.utilityName);
      if (name) byUtility.set(name, (byUtility.get(name) ?? 0) + num(o.metersOut));
    }
    const utilities = [...byUtility].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const rings = outerRings(r.feature);
    counties.push({ fips, name: str(r.countyName) || fips, state: stateName, out, utilities: utilities.slice(0, 3), path: packRings(rings), rings: rings.length });
    const sFips = fips.slice(0, 2);
    const s = states.get(sFips) ?? { fips: sFips, name: stateName, out: 0, counties: 0, top: [], utilities: new Map<string, number>() };
    s.out += out;
    s.counties += 1;
    for (const [n, v] of byUtility) s.utilities.set(n, (s.utilities.get(n) ?? 0) + v);
    states.set(sFips, s);
  }
  const stateList: PowerOutageState[] = [...states.values()]
    .map(({ utilities, ...s }) => ({ ...s, top: [...utilities].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, out]) => ({ name, out })) }))
    .sort((a, b) => b.out - a.out);
  const mapped = counties
    .filter((c) => c.out >= MAP_MIN_COUNTY_OUT && c.rings > 0)
    .sort((a, b) => b.out - a.out)
    .slice(0, MAP_MAX_COUNTIES)
    .map(({ rings: _rings, ...c }) => c);
  // Keep the snapshot small during big events: stop adding outlines past the size budget.
  let chars = 0;
  const kept = mapped.filter((c) => (chars += c.path.length) <= MAP_MAX_PATH_CHARS);
  const reporting = status.filter((u) => u.hasError !== true);
  return {
    fetchedAt: nowIso,
    utilitiesReporting: reporting.length,
    utilitiesWithOutages: reporting.filter((u) => num(u.totalOutages) > 0).length,
    totalOut: stateList.reduce((a, s) => a + s.out, 0),
    states: stateList,
    counties: kept,
  };
}

/** Highest step reached (0 when below the first). */
export const stepOf = (out: number) => STATE_RECORD_STEPS.filter((s) => out >= s).pop() ?? 0;

/**
 * Records: one per state per UTC day for each step it reaches (25k, 100k, 250k, 500k, 1M customers
 * out), so a growing outage is recorded again as it grows and a lasting one once a day.
 */
export function outageEvents(snap: PowerOutageSnapshot, nowIso: string): IntelligenceEvent[] {
  const day = nowIso.slice(0, 10);
  return snap.states
    .filter((s) => stepOf(s.out) > 0)
    .map((s) => {
      const step = stepOf(s.out);
      const id = contentHash(ODIN_SOURCE_ID, s.fips, day, String(step));
      const code = STATE_CODE[s.name.toLowerCase()];
      const top = s.top.map((u) => `${u.name} ${fmt(u.out)}`).join('; ');
      return {
        id,
        contentHash: id,
        dataOrigin: 'live' as const,
        sourceId: ODIN_SOURCE_ID,
        sourceName: 'ODIN — US power outages (DOE / ORNL)',
        sourceClass: 'official' as const,
        sourceUrl: ODIN_PAGE,
        title: truncate(`Power outages — ${s.name}: ${fmt(s.out)} customers without power (${s.counties} ${s.counties === 1 ? 'county' : 'counties'})`, LIMITS.title),
        summary: truncate(
          `Utilities reporting to ODIN (US Department of Energy / Oak Ridge National Laboratory) listed ${fmt(s.out)} customers without power in ${s.name} at ${nowIso.slice(11, 16)} UTC` +
            `${top ? `; largest: ${top}` : ''}. Only utilities that report to ODIN are counted (${snap.utilitiesReporting} nationwide), so the true total can be higher. ODIN does not give causes.`,
          LIMITS.summary,
        ),
        category: 'disaster' as const,
        regionIds: ['united-states'],
        countryCodes: ['US'],
        publishedAt: nowIso,
        occurredAt: nowIso,
        collectedAt: nowIso,
        credibility: 'official' as const,
        verificationStatus: 'unreviewed' as const,
        locationPrecision: 'region' as const,
        metadata: {
          subtype: 'power-outage',
          stateFips: s.fips,
          customersOut: s.out,
          step,
          counties: s.counties,
          usStates: code ? [code] : [],
          geoBasis: 'ODIN county reports (state total)',
        },
      };
    });
}

/** ODIN US power outages: county-level customers out, every run (two small public requests, no key). */
export const odinPowerOutages: SourceAdapter<OdinState> = {
  sourceId: ODIN_SOURCE_ID,
  async collect(ctx: AdapterContext<OdinState>): Promise<AdapterResult<OdinState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const headers = { Accept: 'application/json' };
    const [map, status] = await Promise.all([ctx.fetch(ODIN_MAP_URL, undefined, headers, { maxBytes: 4 * 1024 * 1024 }), ctx.fetch(ODIN_STATUS_URL, undefined, headers)]);
    if (map.kind !== 'ok') throw new Error(`ODIN map: unexpected ${map.status}`);
    const rows = JSON.parse(map.body) as unknown;
    if (!Array.isArray(rows)) throw new Error('ODIN map: response is not a list');
    const statusRows = status.kind === 'ok' ? (JSON.parse(status.body) as unknown) : [];
    const snap = buildOutageSnapshot(rows as OdinMapRow[], Array.isArray(statusRows) ? (statusRows as OdinStatusRow[]) : [], nowIso);
    const events = outageEvents(snap, nowIso);
    return { events, rejected: [], itemsSeen: rows.length, notModified: false, state: { lastFetchedAt: nowIso, latest: snap } };
  },
};
