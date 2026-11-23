import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { NAV_KIND_LABEL, parseDailyMemo, readWarning, warningsFromBody, type NavWarning, type NgaWarningRaw } from '../../shared/domain/navWarnings.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * NGA Maritime Safety Information broadcast warnings (Phase 25). Active warnings of the notable kinds
 * (missile and rocket firings, live firing, military exercises, GPS interference, piracy, mines, cable
 * work) are kept for the map; each is recorded once, when first seen. U.S. government work.
 */
export const NGA_SOURCE_ID = 'nga-msi';
export const NGA_URL = 'https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active';
const PORTAL = 'https://msi.nga.mil/NavWarnings';
/**
 * While the portal is down for maintenance, NGA's maintenance page links the in-force warnings as plain
 * text, one file per series (v0.66.1). Read only when the API fails.
 */
export const NGA_DAILY_BASE = 'https://msi.nga.mil/apology_objects/';
export const NGA_DAILY_FILES = ['DailyMemIV.txt', 'DailyMemXII.txt', 'DailyMemLAN.txt', 'DailyMemPAC.txt', 'DailyMemARC.txt'];
const DAY = 86_400_000;
/** Warnings change a few times a day: read every 3 hours. */
export const NGA_EVERY_MS = 3 * 3_600_000;

export interface NgaState {
  warnings: NavWarning[];
  activeTotal: number;
  fetchedAt: string;
  /** Warning keys already recorded (kept while active). */
  seen: string[];
  /** v0.66.1: in-force time of the list read, and which route it came from. */
  asOf?: string | null;
  via?: 'api' | 'daily-files';
}

/** The in-force lists from the daily files; throws when none can be read. */
async function readDailyFiles(ctx: AdapterContext<NgaState>, apiError: string): Promise<{ raw: NgaWarningRaw[]; asOf: string | null }> {
  const raw: NgaWarningRaw[] = [];
  const times: string[] = [];
  let ok = 0;
  for (const f of NGA_DAILY_FILES) {
    const res = await ctx.fetch(NGA_DAILY_BASE + f, undefined, { Accept: 'text/plain' }).catch(() => null);
    if (res?.kind !== 'ok' || !/IN FORCE AS OF/i.test(res.body.slice(0, 500))) continue;
    ok++;
    const memo = parseDailyMemo(res.body);
    raw.push(...memo.warnings);
    if (memo.asOf) times.push(memo.asOf);
  }
  if (ok === 0) throw new Error(`NGA MSI: ${apiError}, and the daily in-force files could not be read either`);
  // The oldest file's time: the list as a whole is in force as of then.
  return { raw, asOf: times.length ? times.sort()[0] : null };
}

const CATEGORY: Record<NavWarning['kind'], IntelligenceEvent['category']> = {
  missile: 'military',
  firing: 'military',
  exercise: 'military',
  gnss: 'aviation',
  piracy: 'maritime',
  mine: 'maritime',
  cable: 'maritime',
  other: 'maritime',
};

const DAILY_FILE_BY_SERIES: Record<string, string> = { 'NAVAREA IV': 'DailyMemIV.txt', 'NAVAREA XII': 'DailyMemXII.txt', HYDROLANT: 'DailyMemLAN.txt', HYDROPAC: 'DailyMemPAC.txt', HYDROARC: 'DailyMemARC.txt' };

export function warningRecord(w: NavWarning, nowIso: string, via: 'api' | 'daily-files' = 'api'): IntelligenceEvent {
  const id = contentHash(NGA_SOURCE_ID, w.key);
  const where = w.lat !== null ? '' : ' (no position in the text)';
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: NGA_SOURCE_ID,
    sourceName: 'NGA Maritime Safety Information',
    sourceClass: 'official',
    sourceUrl: via === 'daily-files' ? NGA_DAILY_BASE + (DAILY_FILE_BY_SERIES[w.series] ?? 'DailyMemPAC.txt') : PORTAL,
    title: truncate(`${w.series} ${w.number}/${String(w.year).slice(-2)}: ${NAV_KIND_LABEL[w.kind]}${where} — ${w.text}`, LIMITS.title),
    summary: truncate(`Navigational warning ${w.key}, ${NAV_KIND_LABEL[w.kind]}. ${w.text} (U.S. NGA, public domain${via === 'daily-files' ? '; read from the daily in-force list NGA posts while its portal is down' : ''}.)`, LIMITS.summary),
    category: CATEGORY[w.kind],
    regionIds: w.regionIds,
    countryCodes: [],
    publishedAt: w.issuedAt ?? nowIso,
    occurredAt: null,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    ...(w.lat !== null && w.lon !== null ? { latitude: w.lat, longitude: w.lon, locationPrecision: 'region' as const } : { locationPrecision: 'none' as const }),
    metadata: { subtype: 'nav-warning', navKind: w.kind, warningKey: w.key, points: w.points.length, geoBasis: w.lat !== null ? 'warning-area-centre' : 'none' },
  };
}

export const ngaMsi: SourceAdapter<NgaState> = {
  sourceId: NGA_SOURCE_ID,
  async collect(ctx: AdapterContext<NgaState>): Promise<AdapterResult<NgaState>> {
    const nowIso = new Date(ctx.now).toISOString();
    if (ctx.state && ctx.now - Date.parse(ctx.state.fetchedAt) < NGA_EVERY_MS) return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    let raw: NgaWarningRaw[];
    let asOf: string | null = null;
    let via: 'api' | 'daily-files' = 'api';
    try {
      const res = await ctx.fetch(NGA_URL, undefined, { Accept: 'application/json' });
      if (res.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state ?? { warnings: [], activeTotal: 0, fetchedAt: nowIso, seen: [] } };
      let body: unknown;
      try {
        body = JSON.parse(res.body);
      } catch {
        throw new Error('answer is not JSON (the portal may be under maintenance)');
      }
      raw = warningsFromBody(body);
    } catch (err) {
      const daily = await readDailyFiles(ctx, err instanceof Error ? err.message : String(err));
      raw = daily.raw;
      asOf = daily.asOf;
      via = 'daily-files';
    }
    const rejected: AdapterResult<NgaState>['rejected'] = [];
    const all: NavWarning[] = [];
    for (const r of raw) {
      const w = readWarning(r);
      if (w) all.push(w);
      else rejected.push({ ref: `${r.navArea ?? '?'} ${r.msgNumber ?? '?'}/${r.msgYear ?? '?'}`, reason: 'no number, year or text' });
    }
    const notable = all.filter((w) => w.kind !== 'other');
    const seen = new Set(ctx.state?.seen ?? []);
    const firstRun = !ctx.state;
    const events: IntelligenceEvent[] = [];
    for (const w of notable) {
      if (seen.has(w.key)) continue;
      // First run: only warnings issued in the back-fill window become records (older ones are still mapped).
      const issued = w.issuedAt ? Date.parse(w.issuedAt) : ctx.now;
      if (!firstRun || issued >= ctx.now - FIRST_RUN_LOOKBACK_DAYS * DAY) events.push(warningRecord(w, nowIso, via));
    }
    const activeKeys = new Set(all.map((w) => w.key));
    const nextSeen = [...new Set([...seen, ...notable.map((w) => w.key)])].filter((k) => activeKeys.has(k));
    return { events, rejected, itemsSeen: raw.length, notModified: false, state: { warnings: notable, activeTotal: all.length, fetchedAt: nowIso, seen: nextSeen, asOf, via } };
  },
};
