import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { packRings, outerRings } from '../../shared/domain/powerOutages.ts';
import {
  AIRPORT_KIND_LABEL,
  FAA_NOTICES_PAGE,
  areaLevel,
  isNotableCondition,
  noticeArea,
  noticeKind,
  tfrTime,
  type AirportEvent,
  type AirportEventKind,
  type AirportStatusSnapshot,
  type AirspaceNoticeArea,
  type AirspaceNoticeDoc,
  type AirspaceNoticesSnapshot,
  type TfrShape,
  type TfrSnapshot,
  type TfrType,
} from '../../shared/domain/faa.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, decodeEntities, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

// ---------------------------------------------------------------- TFR shapes and details

/** The FAA TFR map's feature service (public): one polygon per active TFR. */
export const TFR_SHAPES_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json';
export const tfrDetailUrl = (notam: string) => `https://tfr.faa.gov/tfrapi/getWebText?notamId=${encodeURIComponent(notam)}`;
/** New TFRs whose details are fetched per run (the rest follow on later runs). */
export const TFR_DETAILS_PER_RUN = 15;
/** Total packed outline size kept in the snapshot. */
const TFR_MAX_PATH_CHARS = 30_000;

export interface TfrDetail {
  start: string | null;
  end: string | null;
  reason: string | null;
  altitude: string | null;
  location: string | null;
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Parses the TFR detail page (HTML in the getWebText JSON): label cell, then value cell. */
export function parseTfrDetail(html: string): TfrDetail {
  const field = (label: string) => {
    const m = html.match(new RegExp(`${label}\\s*:?\\s*</font>[\\s\\S]*?<font[^>]*>([\\s\\S]*?)</font>`, 'i'));
    const v = m ? stripTags(m[1]) : '';
    return v && v.length < 300 ? v : null;
  };
  return {
    start: tfrTime(field('Beginning Date and Time')),
    end: tfrTime(field('Ending Date and Time')),
    reason: field('Reason for NOTAM'),
    altitude: field('Altitude'),
    location: field('Location'),
  };
}

interface WfsFeature {
  properties?: { NOTAM_KEY?: unknown; TITLE?: unknown; STATE?: unknown; LEGAL?: unknown };
  geometry?: { type?: unknown; coordinates?: unknown } | null;
}

/** Outline per NOTAM id ("6/9141") from the feature service. */
export function tfrOutlines(features: WfsFeature[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of features) {
    const key = String(f.properties?.NOTAM_KEY ?? '').split('-')[0];
    if (!/^\d\/\d{4}$/.test(key)) continue;
    const rings = outerRings(f.geometry, 0.002);
    if (!rings.length) continue;
    out.set(key, out.has(key) ? `${out.get(key)}|${packRings(rings)}` : packRings(rings));
  }
  return out;
}

/** Builds the TFR layer: imported TFRs with details and outlines (outlines capped by size, VIP and special first). */
export function buildTfrSnapshot(rows: { notam: string; type: TfrType; title: string; state: string }[], details: Record<string, TfrDetail | null>, outlines: Map<string, string>, nowIso: string): TfrSnapshot {
  const order: Record<TfrType, number> = { VIP: 0, SPECIAL: 1, SECURITY: 2 };
  let chars = 0;
  const items: TfrShape[] = [...rows]
    .sort((a, b) => order[a.type] - order[b.type])
    .map((r) => {
      const d = details[r.notam] ?? null;
      let path = outlines.get(r.notam) ?? '';
      if (path && chars + path.length > TFR_MAX_PATH_CHARS) path = '';
      chars += path.length;
      return { notam: r.notam, type: r.type, title: d?.location ?? r.title, state: r.state, start: d?.start ?? null, end: d?.end ?? null, reason: d?.reason ?? null, altitude: d?.altitude ?? null, path };
    });
  return { fetchedAt: nowIso, items };
}

// ---------------------------------------------------------------- airport status

export const AIRPORT_STATUS_SOURCE_ID = 'faa-airport-status';
export const AIRPORT_EVENTS_URL = 'https://nasstatus.faa.gov/api/airport-events';
const NAS_PAGE = 'https://nasstatus.faa.gov/';

export interface AirportStatusState {
  latest: AirportStatusSnapshot | null;
}

type Obj = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const coord = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null;
};

/** Flattens the FAA airport-events list into one entry per airport and kind (routine partial closures left out). */
export function parseAirportEvents(rows: Obj[]): AirportEvent[] {
  const out: AirportEvent[] = [];
  for (const r of rows) {
    const code = s(r.airportId).toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(code)) continue;
    const base = { code, name: s(r.airportLongName) || code, lat: coord(r.latitude), lon: coord(r.longitude) };
    const add = (kind: AirportEventKind, o: unknown, condition: string, delay: string | null = null) => {
      if (!o || typeof o !== 'object') return;
      const x = o as Obj;
      out.push({ ...base, kind, condition: condition || 'not stated', start: iso(x.startTime), end: iso(x.endTime ?? x.programExpirationTime), delay, notable: isNotableCondition(condition), url: s(x.advisoryUrl) || null });
    };
    const gs = r.groundStop as Obj | null;
    add('ground-stop', gs, s(gs?.impactingCondition));
    const gd = r.groundDelay as Obj | null;
    add('ground-delay', gd, s(gd?.impactingCondition), s(gd?.avgDelay) || s(gd?.maxDelay) || null);
    const cl = r.airportClosure as Obj | null;
    add('closure', cl, s(cl?.text) || s(cl?.simpleText) || s(cl?.reason));
    for (const [k, kind] of [['arrivalDelay', 'arrival-delay'], ['departureDelay', 'departure-delay']] as const) {
      const d = r[k] as Obj | null;
      const ad = (d?.arrivalDeparture ?? null) as Obj | null;
      add(kind, d, s(d?.reason), ad ? `${s(ad.min)}–${s(ad.max)}` : null);
    }
  }
  return out;
}

/** Records: a ground stop or ground delay program with a notable cause, once per airport, kind and start. */
export function airportEventRecords(events: AirportEvent[], nowIso: string): IntelligenceEvent[] {
  return events
    .filter((e) => (e.kind === 'ground-stop' || e.kind === 'ground-delay') && e.notable)
    .map((e) => {
      const id = contentHash(AIRPORT_STATUS_SOURCE_ID, e.code, e.kind, e.start ?? nowIso.slice(0, 13));
      const canadian = /^Y[A-Z]{2}$/.test(e.code);
      return {
        id,
        contentHash: id,
        dataOrigin: 'live' as const,
        sourceId: AIRPORT_STATUS_SOURCE_ID,
        sourceName: 'FAA — National Airspace System status',
        sourceClass: 'official' as const,
        sourceUrl: e.url ?? NAS_PAGE,
        title: truncate(`FAA ${AIRPORT_KIND_LABEL[e.kind].toLowerCase()} — ${e.name} (${e.code}): ${e.condition}`, LIMITS.title),
        summary: truncate(
          `The FAA Air Traffic Control System Command Center listed a ${AIRPORT_KIND_LABEL[e.kind].toLowerCase()} at ${e.name} (${e.code}), cause "${e.condition}"` +
            `${e.start ? `, from ${e.start.slice(11, 16)} UTC` : ''}${e.end ? ` until ${e.end.slice(11, 16)} UTC` : ''}${e.delay ? `, delays ${e.delay}` : ''}.`,
          LIMITS.summary,
        ),
        category: 'aviation' as const,
        regionIds: canadian ? [] : ['united-states'],
        countryCodes: canadian ? ['CA'] : ['US'],
        publishedAt: e.start ?? nowIso,
        occurredAt: e.start,
        collectedAt: nowIso,
        credibility: 'official' as const,
        verificationStatus: 'unreviewed' as const,
        ...(e.lat !== null && e.lon !== null ? { latitude: e.lat, longitude: e.lon, locationPrecision: 'exact' as const } : { locationPrecision: 'country' as const }),
        metadata: { subtype: 'airport-status', airport: e.code, programKind: e.kind, condition: e.condition, endsAt: e.end, geoBasis: 'FAA airport reference point' },
      };
    });
}

/** FAA NAS status: ground stops, ground delay programs, delays and closures, every run (one public request). */
export const faaAirportStatus: SourceAdapter<AirportStatusState> = {
  sourceId: AIRPORT_STATUS_SOURCE_ID,
  async collect(ctx: AdapterContext<AirportStatusState>): Promise<AdapterResult<AirportStatusState>> {
    const nowIso = new Date(ctx.now).toISOString();
    const res = await ctx.fetch(AIRPORT_EVENTS_URL, undefined, { Accept: 'application/json' });
    if (res.kind !== 'ok') throw new Error(`FAA airport events: unexpected ${res.status}`);
    const rows = JSON.parse(res.body) as unknown;
    if (!Array.isArray(rows)) throw new Error('FAA airport events: response is not a list');
    const events = parseAirportEvents(rows as Obj[]);
    return { events: airportEventRecords(events, nowIso), rejected: [], itemsSeen: rows.length, notModified: false, state: { latest: { fetchedAt: nowIso, events } } };
  },
};

// ---------------------------------------------------------------- notices for US aviation abroad

export const NOTICES_SOURCE_ID = 'faa-airspace-notices';
/** The page changes rarely: read it every few hours. */
export const NOTICES_FETCH_HOURS = 3;

export interface NoticesState {
  lastFetchedAt: string;
  trackingSince: string;
  /** url → first seen (null = present when tracking began). */
  seen: Record<string, string | null>;
  latest: AirspaceNoticesSnapshot | null;
}

/** Sections (h2) of the FAA page with their notice documents. Domestic and boilerplate sections are skipped. */
export function parseNoticesPage(html: string): { name: string; docs: { title: string; url: string }[] }[] {
  const main = html.slice(Math.max(0, html.indexOf('Alphabetical List by Country')));
  const parts = main.split(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const out: { name: string; docs: { title: string; url: string }[] }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const name = stripTags(parts[i]).replace(/ /g, ' ').trim();
    if (!name || name === 'United States' || /acronyms|Department of Transportation|Important Info|Review Documents|Moving FAA|Other FAA Sites|Policies/i.test(name)) continue;
    const docs: { title: string; url: string }[] = [];
    for (const m of parts[i + 1].matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = m[1];
      if (!/\.pdf\b|\/media\/|\/doc\//i.test(href)) continue;
      const url = new URL(decodeEntities(href), FAA_NOTICES_PAGE).toString();
      const title = stripTags(m[2]);
      if (title && !docs.some((d) => d.url === url)) docs.push({ title, url });
    }
    if (docs.length) out.push({ name, docs });
  }
  return out;
}

export function buildNotices(sections: ReturnType<typeof parseNoticesPage>, seen: Record<string, string | null>, trackingSince: string, nowIso: string): AirspaceNoticesSnapshot {
  const areas: AirspaceNoticeArea[] = sections.map((sec) => {
    const docs: AirspaceNoticeDoc[] = sec.docs.map((d) => ({ ...d, kind: noticeKind(d.title), firstSeen: seen[d.url] ?? null }));
    return { name: sec.name, ...noticeArea(sec.name), level: areaLevel(docs), docs };
  });
  return { fetchedAt: nowIso, trackingSince, areas };
}

/** Records: one per notice document that appears on the page after tracking began. */
export function noticeRecords(snap: AirspaceNoticesSnapshot, newUrls: Set<string>, nowIso: string): IntelligenceEvent[] {
  const out: IntelligenceEvent[] = [];
  for (const a of snap.areas) {
    for (const d of a.docs) {
      if (!newUrls.has(d.url)) continue;
      const id = contentHash(NOTICES_SOURCE_ID, d.url);
      out.push({
        id,
        contentHash: id,
        dataOrigin: 'live',
        sourceId: NOTICES_SOURCE_ID,
        sourceName: 'FAA — Prohibitions, Restrictions and Notices',
        sourceClass: 'official',
        sourceUrl: d.url,
        title: truncate(`FAA notice for US flights — ${a.name}: ${d.title}`, LIMITS.title),
        summary: truncate(
          `A new document appeared in the ${a.name} section of the FAA's Prohibitions, Restrictions and Notices page (US civil aviation abroad): "${d.title}". ` +
            `${a.name} is now listed at ${a.level === 'prohibition' ? 'prohibition' : a.level === 'advisory' ? 'advisory' : 'notice'} level. New documents can also be updated versions of earlier ones.`,
          LIMITS.summary,
        ),
        category: 'aviation',
        regionIds: a.regionIds,
        countryCodes: a.code ? [a.code] : [],
        publishedAt: nowIso,
        occurredAt: null,
        collectedAt: nowIso,
        credibility: 'official',
        verificationStatus: 'unreviewed',
        locationPrecision: a.code ? 'country' : 'none',
        metadata: { subtype: 'faa-airspace-notice', area: a.name, noticeKind: d.kind, areaLevel: a.level, geoBasis: a.code ? 'source-country' : 'none' },
      });
    }
  }
  return out;
}

/** FAA "Prohibitions, Restrictions and Notices": standing bans and advisories for US flights abroad; new documents become records. */
export const faaAirspaceNotices: SourceAdapter<NoticesState> = {
  sourceId: NOTICES_SOURCE_ID,
  async collect(ctx: AdapterContext<NoticesState>): Promise<AdapterResult<NoticesState>> {
    const prev = ctx.state;
    const nowIso = new Date(ctx.now).toISOString();
    if (prev && ctx.now - Date.parse(prev.lastFetchedAt) < NOTICES_FETCH_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
    }
    const res = await ctx.fetch(FAA_NOTICES_PAGE);
    if (res.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev ? { ...prev, lastFetchedAt: nowIso } : prev! };
    const sections = parseNoticesPage(res.body);
    if (sections.length < 5) throw new Error(`FAA notices page: only ${sections.length} sections found (layout changed?)`);
    const trackingSince = prev?.trackingSince ?? nowIso;
    const seen: Record<string, string | null> = {};
    const fresh = new Set<string>();
    for (const sec of sections) {
      for (const d of sec.docs) {
        if (prev && !(d.url in prev.seen)) {
          seen[d.url] = nowIso;
          fresh.add(d.url);
        } else seen[d.url] = prev?.seen[d.url] ?? null;
      }
    }
    const snap = buildNotices(sections, seen, trackingSince, nowIso);
    return { events: noticeRecords(snap, fresh, nowIso), rejected: [], itemsSeen: Object.keys(seen).length, notModified: false, state: { lastFetchedAt: nowIso, trackingSince, seen, latest: snap } };
  },
};
