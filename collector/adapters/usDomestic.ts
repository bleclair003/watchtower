import { XMLParser } from 'fast-xml-parser';
import type { EventCategory, IntelligenceEvent } from '../../shared/domain/types.ts';
import { getSource } from '../../shared/domain/sources.ts';
import { US_STATE_NAMES } from '../../shared/domain/geo/usPlaces.ts';
import { contentHash } from '../lib/hash.ts';
import { FeedParseError } from '../lib/feed.ts';
import { LIMITS, cleanText, decodeEntities, safeUrl, truncate } from '../lib/text.ts';
import { FIRST_RUN_LOOKBACK_DAYS, STEADY_LOOKBACK_DAYS, type AdapterContext, type AdapterResult, type SourceAdapter } from './types.ts';

/**
 * US domestic structured sources: FAA temporary flight restrictions, DHS NTAS advisories,
 * FEMA disaster declarations and NWS extreme-weather alerts. All official, all tagged to the
 * 'united-states' watch region with country 'US'; the state(s) are kept in metadata.
 */

const DAY = 86_400_000;
type Simple = { firstRunAt: string };
const US_REGION = ['united-states'];
const stateList = (codes: string[]) => codes.map((c) => US_STATE_NAMES[c] ?? c).join(', ');

function base(sourceId: string, nowIso: string) {
  const def = getSource(sourceId)!;
  return {
    dataOrigin: 'live' as const,
    sourceId,
    sourceName: `${def.organization} — ${def.name}`,
    sourceClass: 'official' as const,
    regionIds: US_REGION,
    countryCodes: ['US'],
    collectedAt: nowIso,
    credibility: 'official' as const,
    verificationStatus: 'unreviewed' as const,
    locationPrecision: 'country' as const,
  };
}

// ---------------------------------------------------------------- FAA TFR

/** TFR types imported. HAZARDS (fires, etc.), air shows, drone-at-gatherings and space launches are not security signals. */
export const TFR_TYPES: Record<string, { label: string; category: EventCategory }> = {
  SECURITY: { label: 'Security (national defence airspace)', category: 'military' },
  VIP: { label: 'VIP movement', category: 'official' },
  SPECIAL: { label: 'Special', category: 'aviation' },
};

/** "11/20/2026" → ISO date at 00:00 UTC (the list gives no time). */
export function tfrDate(raw: unknown): string | null {
  const m = typeof raw === 'string' ? raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))).toISOString() : null;
}

export const faaTfr: SourceAdapter<Simple> = {
  sourceId: 'faa-tfr',
  async collect(ctx: AdapterContext<Simple>): Promise<AdapterResult<Simple>> {
    const def = getSource('faa-tfr')!;
    const res = await ctx.fetch(def.endpoint!);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    const rows = JSON.parse(res.body) as Record<string, unknown>[];
    if (!Array.isArray(rows)) throw new Error('FAA TFR list is not an array');
    const nowIso = new Date(ctx.now).toISOString();
    const lookback = ctx.now - (ctx.state ? STEADY_LOOKBACK_DAYS : FIRST_RUN_LOOKBACK_DAYS) * DAY;
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<Simple>['rejected'] = [];
    for (const r of rows) {
      const type = String(r.type ?? '').toUpperCase();
      const kind = TFR_TYPES[type];
      if (!kind) continue;
      const notam = String(r.notam_id ?? '');
      const created = tfrDate(r.creation_date);
      if (!/^\d\/\d{4}$/.test(notam) || !created) {
        rejected.push({ ref: notam || '(no id)', reason: 'missing NOTAM id or creation date' });
        continue;
      }
      if (Date.parse(created) < lookback) continue;
      const state = String(r.state ?? '').toUpperCase();
      const where = cleanText(String(r.description ?? ''))
        // "MAYPORT, FL, Saturday, November 21, 2026 through …" → "MAYPORT, FL"
        .replace(/,\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b.*$/i, '')
        .replace(/,\s*$/, '');
      const id = contentHash('faa-tfr', notam);
      events.push({
        ...base('faa-tfr', nowIso),
        id,
        contentHash: id,
        sourceUrl: `https://tfr.faa.gov/tfr3/?page=detail_${notam.replace('/', '_')}`,
        title: truncate(`FAA ${kind.label} flight restriction — ${where || (US_STATE_NAMES[state] ?? state)}`, LIMITS.title),
        summary: truncate(`NOTAM ${notam} · type ${type} · ${state === 'USA' ? 'nationwide' : US_STATE_NAMES[state] ?? state} · issued ${created.slice(0, 10)}. ${where}`, LIMITS.summary),
        category: kind.category,
        publishedAt: created,
        occurredAt: null,
        metadata: { notamId: notam, tfrType: type, usStates: state && state !== 'USA' ? [state] : [], facility: String(r.facility ?? ''), geoBasis: 'source-country' },
      });
    }
    return { events, rejected, itemsSeen: rows.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};

// ---------------------------------------------------------------- DHS NTAS

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', processEntities: false, isArray: (n) => n === 'alert' });
const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([k]) => !k.startsWith('@')).map(([, x]) => text(x)).join(' ');
  return '';
};

/**
 * NTAS (National Terrorism Advisory System). The feed is usually EMPTY: DHS issues advisories
 * rarely, so any advisory is significant. Fields are read defensively (attribute or child element).
 */
export const dhsNtas: SourceAdapter<Simple> = {
  sourceId: 'dhs-ntas',
  async collect(ctx: AdapterContext<Simple>): Promise<AdapterResult<Simple>> {
    const def = getSource('dhs-ntas')!;
    const res = await ctx.fetch(def.endpoint!);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    if (/<!ENTITY/i.test(res.body)) throw new FeedParseError('Feed declares XML entities; refused');
    const doc = xml.parse(res.body) as { alerts?: { alert?: Record<string, unknown>[] } | string };
    if (doc.alerts === undefined) throw new FeedParseError('NTAS document has no <alerts> root');
    const alerts = typeof doc.alerts === 'object' && Array.isArray(doc.alerts.alert) ? doc.alerts.alert : [];
    const nowIso = new Date(ctx.now).toISOString();
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<Simple>['rejected'] = [];
    for (const a of alerts) {
      const get = (k: string) => cleanText(decodeEntities(text(a[`@${k}`] ?? a[k])));
      const type = get('type') || 'Advisory';
      const summary = get('summary') || get('title');
      const link = safeUrl(get('link') || get('href')) ?? 'https://www.dhs.gov/national-terrorism-advisory-system';
      const startRaw = get('start');
      const start = startRaw && !Number.isNaN(Date.parse(startRaw.replace(/\//g, '-'))) ? new Date(Date.parse(startRaw.replace(/\//g, '-'))).toISOString() : null;
      if (!summary && !start) {
        rejected.push({ ref: type, reason: 'advisory without summary or start' });
        continue;
      }
      const id = contentHash('dhs-ntas', link, startRaw, type);
      events.push({
        ...base('dhs-ntas', nowIso),
        id,
        contentHash: id,
        sourceUrl: link,
        title: truncate(`DHS NTAS ${type}${summary ? `: ${summary}` : ''}`, LIMITS.title),
        summary: truncate([get('details'), get('end') ? `Expires ${get('end')}.` : ''].filter(Boolean).join(' '), LIMITS.summary) || undefined,
        category: 'unrest',
        publishedAt: start,
        occurredAt: start,
        metadata: { ntasType: type, expires: get('end') || null, geoBasis: 'source-country' },
      });
    }
    return { events, rejected, itemsSeen: alerts.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};

// ---------------------------------------------------------------- FEMA

const DECLARATION: Record<string, string> = { DR: 'Major disaster declaration', EM: 'Emergency declaration', FM: 'Fire management assistance' };

/** OpenFEMA disaster declarations: one record per disaster (rows are per county), with the number of areas. */
export const femaDeclarations: SourceAdapter<Simple> = {
  sourceId: 'fema-declarations',
  async collect(ctx: AdapterContext<Simple>): Promise<AdapterResult<Simple>> {
    const def = getSource('fema-declarations')!;
    const since = new Date(ctx.now - (ctx.state ? 14 : FIRST_RUN_LOOKBACK_DAYS) * DAY).toISOString().slice(0, 10);
    const url = `${def.endpoint}?$filter=declarationDate%20ge%20'${since}'&$orderby=declarationDate%20desc&$top=1000`;
    const res = await ctx.fetch(url);
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    const rows = (JSON.parse(res.body) as { DisasterDeclarationsSummaries?: Record<string, unknown>[] }).DisasterDeclarationsSummaries ?? [];
    const nowIso = new Date(ctx.now).toISOString();
    const byDisaster = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const key = String(r.femaDeclarationString ?? '');
      if (key) byDisaster.set(key, [...(byDisaster.get(key) ?? []), r]);
    }
    const events: IntelligenceEvent[] = [];
    for (const [key, group] of byDisaster) {
      const r = group[0];
      const state = String(r.state ?? '');
      const declared = typeof r.declarationDate === 'string' ? new Date(r.declarationDate).toISOString() : null;
      const kind = DECLARATION[String(r.declarationType)] ?? 'Declaration';
      const id = contentHash('fema-declarations', key);
      events.push({
        ...base('fema-declarations', nowIso),
        id,
        contentHash: id,
        sourceUrl: `https://www.fema.gov/disaster/${String(r.disasterNumber ?? '')}`,
        title: truncate(`FEMA ${kind} — ${cleanText(String(r.declarationTitle ?? r.incidentType ?? ''))} (${US_STATE_NAMES[state] ?? state})`, LIMITS.title),
        summary: truncate(`${key}: ${String(r.incidentType ?? 'incident')} · ${group.length} designated area(s) · incident began ${String(r.incidentBeginDate ?? '').slice(0, 10) || 'not stated'}.`, LIMITS.summary),
        category: 'disaster',
        publishedAt: declared,
        occurredAt: typeof r.incidentBeginDate === 'string' ? new Date(r.incidentBeginDate).toISOString() : null,
        metadata: { femaId: key, declarationType: String(r.declarationType ?? ''), incidentType: String(r.incidentType ?? ''), areas: group.length, usStates: state ? [state] : [], geoBasis: 'source-country' },
      });
    }
    return { events, rejected: [], itemsSeen: rows.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};

// ---------------------------------------------------------------- NWS

/** Active NWS alerts with severity Extreme (tornado emergencies, extreme wind, hurricane-force …). */
export const nwsAlerts: SourceAdapter<Simple> = {
  sourceId: 'nws-alerts',
  async collect(ctx: AdapterContext<Simple>): Promise<AdapterResult<Simple>> {
    const def = getSource('nws-alerts')!;
    const res = await ctx.fetch(`${def.endpoint}?severity=Extreme&status=actual`, undefined, { Accept: 'application/geo+json' });
    if (res.kind === 'not-modified') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    const doc = JSON.parse(res.body) as { features?: { properties?: Record<string, unknown> }[] };
    const features = Array.isArray(doc.features) ? doc.features : [];
    const nowIso = new Date(ctx.now).toISOString();
    const events: IntelligenceEvent[] = [];
    const rejected: AdapterResult<Simple>['rejected'] = [];
    for (const f of features) {
      const p = f.properties ?? {};
      const alertId = String(p.id ?? '');
      const sent = typeof p.sent === 'string' && !Number.isNaN(Date.parse(p.sent)) ? new Date(p.sent).toISOString() : null;
      if (!alertId || !sent) {
        rejected.push({ ref: alertId || '(no id)', reason: 'missing id or sent time' });
        continue;
      }
      const ugc = ((p.geocode as Record<string, unknown> | undefined)?.UGC as unknown[] | undefined) ?? [];
      const states = [...new Set(ugc.filter((u): u is string => typeof u === 'string').map((u) => u.slice(0, 2)))];
      const id = contentHash('nws-alerts', alertId);
      events.push({
        ...base('nws-alerts', nowIso),
        id,
        contentHash: id,
        sourceUrl: safeUrl(p['@id']) ?? 'https://alerts.weather.gov/',
        title: truncate(`NWS ${cleanText(String(p.event ?? 'alert'))} — ${cleanText(String(p.areaDesc ?? stateList(states)))}`, LIMITS.title),
        summary: truncate(cleanText(String(p.headline ?? '')), LIMITS.summary) || undefined,
        category: 'disaster',
        publishedAt: sent,
        occurredAt: typeof p.onset === 'string' ? p.onset : null,
        metadata: { nwsEvent: String(p.event ?? ''), severity: String(p.severity ?? ''), urgency: String(p.urgency ?? ''), expires: p.expires ?? null, usStates: states, geoBasis: 'source-country' },
      });
    }
    return { events, rejected, itemsSeen: features.length, notModified: false, state: { firstRunAt: ctx.state?.firstRunAt ?? nowIso } };
  },
};
