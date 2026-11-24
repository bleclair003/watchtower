import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import {
  assessDay,
  buildPlaSnapshot,
  parsePlaCsv,
  PLA_CREDIT,
  PLA_CSV_URL,
  PLA_LEVEL_LABEL,
  PLA_RECORDS_URL,
  TAIWAN_PLA_SOURCE_ID,
  type PlaDay,
  type TaiwanPlaSnapshot,
} from '../../shared/domain/taiwanPla.ts';
import type { Validators } from '../lib/http.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * PLA activity around Taiwan (v0.82.0), from Skyfaring's PLA Tracker CSV (CC BY 4.0), which transcribes
 * Taiwan's MND daily releases. One record per day; recent days are re-sent each read so a correction in the
 * tracker's log rewrites the stored record (revisable).
 */

/** The file changes once a day (around midday Taiwan time); read it at most this often. */
export const PLA_MIN_INTERVAL_MS = 2 * 3_600_000;
/** Days sent on the first read, and re-sent on later reads (to pick up corrections). */
export const PLA_FIRST_DAYS = 14;
export const PLA_RESEND_DAYS = 10;

export interface TaiwanPlaState {
  latest: TaiwanPlaSnapshot | null;
  fetchedAt: string | null;
  validators?: Validators;
}

const md = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const n = (x: number | null, word: string) => (x === null ? `${word} not stated` : `${x} ${word}`);

export function plaEvent(days: PlaDay[], day: PlaDay, nowIso: string): IntelligenceEvent {
  const a = assessDay(days, day.date)!;
  const id = contentHash(TAIWAN_PLA_SOURCE_ID, day.date);
  const crossed = day.crossed !== null && day.aircraft ? ` (${day.crossed} crossed the median line)` : '';
  const level = a.level === 'normal' ? '' : ` — ${PLA_LEVEL_LABEL[a.level]}`;
  const vs = (k: 'aircraft' | 'ships') =>
    a[k].status === 'ok' && a[k].centre !== null ? `${k} ${a[k].score} typical spreads from a usual ${a[k].centre}` : `${k}: building a baseline`;
  // The release covers 06:00 the day before to 06:00 that day, UTC+8.
  const start = new Date(Date.parse(`${day.date}T06:00:00+08:00`) - 86_400_000).toISOString();
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId: TAIWAN_PLA_SOURCE_ID,
    sourceName: 'Taiwan MND daily PLA report (via Skyfaring’s PLA Tracker)',
    sourceClass: 'aggregator',
    sourceUrl: PLA_RECORDS_URL,
    title: truncate(`PLA activity around Taiwan, ${md(day.date)}: ${n(day.aircraft, 'aircraft')}${crossed}, ${n(day.ships, 'ships')}${day.balloons ? `, ${day.balloons} balloon(s)` : ''}${level}`, LIMITS.title),
    summary: truncate(
      `Taiwan's Ministry of National Defense counted ${n(day.aircraft, 'PLA aircraft sorties')}${crossed} and ${n(day.ships, 'PLA Navy and official ships')} around Taiwan in the 24 hours to 06:00 (UTC+8) on ${day.date}. ` +
        `Against the 60 days before: ${vs('aircraft')}; ${vs('ships')}. ${PLA_CREDIT}.`,
      LIMITS.summary,
    ),
    category: 'military',
    regionIds: ['taiwan-strait'],
    countryCodes: ['TW'],
    publishedAt: `${day.date}T01:00:00.000Z`,
    occurredAt: start,
    collectedAt: nowIso,
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'region',
    metadata: {
      subtype: 'pla-daily',
      date: day.date,
      aircraft: day.aircraft,
      crossed: day.crossed,
      ships: day.ships,
      balloons: day.balloons,
      aircraftType: day.type,
      level: a.level,
      direction: a.level === 'surge' ? 'surge' : null,
      aircraftScore: a.aircraft.score,
      shipsScore: a.ships.score,
      revisionKey: `${day.aircraft}|${day.crossed}|${day.ships}|${day.balloons}|${a.level}`,
      geoBasis: 'none (counts for the area around Taiwan)',
    },
  };
}

export function makeTaiwanPlaAdapter(): SourceAdapter<TaiwanPlaState> {
  return {
    sourceId: TAIWAN_PLA_SOURCE_ID,
    revisable: true,
    async collect(ctx: AdapterContext<TaiwanPlaState>): Promise<AdapterResult<TaiwanPlaState>> {
      const prev = ctx.state;
      const nowIso = new Date(ctx.now).toISOString();
      if (prev?.fetchedAt && ctx.now - Date.parse(prev.fetchedAt) < PLA_MIN_INTERVAL_MS) {
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev, note: 'read less than 2 h ago' };
      }
      const res = await ctx.fetch(PLA_CSV_URL, prev?.validators, { Accept: 'text/csv' }, { maxBytes: 4_000_000 });
      if (res.kind === 'not-modified') {
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: { ...prev!, fetchedAt: nowIso } };
      }
      const days = parsePlaCsv(res.body);
      if (days.length < 10) throw new Error(`PLA Tracker CSV: only ${days.length} days parsed`);
      const send = days.slice(-(prev?.latest ? PLA_RESEND_DAYS : PLA_FIRST_DAYS));
      return {
        events: send.map((d) => plaEvent(days, d, nowIso)),
        rejected: [],
        itemsSeen: days.length,
        notModified: false,
        state: { latest: buildPlaSnapshot(days, nowIso), fetchedAt: nowIso, validators: res.validators },
        note: `latest ${days[days.length - 1].date}`,
      };
    },
  };
}

export const taiwanPla = makeTaiwanPlaAdapter();
