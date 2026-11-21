import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { matchGazetteer } from '../../shared/domain/geo/gazetteer.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, cleanText, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const CONGRESS_SOURCE_ID = 'congress';
export const CONGRESS_KEY_ENV = 'CONGRESS_API_KEY';
const API = 'https://api.congress.gov/v3';
export const CONGRESS_EVERY_HOURS = 2;
/** Committee-meeting details cost one request each; at most this many new ones per run. */
const MAX_MEETING_DETAILS = 12;
const LOOKBACK_DAYS = 30;

/** The Congress in session on a date (the 119th sits 2025–2026). */
export const congressNumber = (iso: string) => Math.floor((Number(iso.slice(0, 4)) - 1789) / 2) + 1;

export type CongressKind = 'war-powers' | 'arms-sale-disapproval' | 'nuclear-cooperation' | 'ndaa' | 'hearing';

/** Bills and resolutions worth recording, by official title. */
export function classifyMeasure(title: string): Exclude<CongressKind, 'hearing'> | null {
  if (/removal of United States Armed Forces from hostilities|War Powers|authori[sz](e|ation|ing) (for )?(the )?use of (United States )?(Armed Forces|military force)|declaration of war/i.test(title)) return 'war-powers';
  if (/disapproval of the proposed (foreign military|direct commercial|arms|commercial) sale/i.test(title)) return 'arms-sale-disapproval';
  if (/civilian nuclear cooperation/i.test(title) && /disapprov/i.test(title)) return 'nuclear-cooperation';
  if (/^National Defense Authorization Act|^To authorize appropriations for fiscal year \d{4} for military activities of the Department of Defense/i.test(title)) return 'ndaa';
  return null;
}

/** Committees whose hearings are recorded. */
export const SECURITY_COMMITTEE = /Armed Services|Intelligence|Foreign Affairs|Foreign Relations|Homeland Security/i;

interface ApiBill {
  congress: number;
  type: string;
  number: string;
  title: string;
  updateDate?: string;
  latestAction?: { actionDate?: string; text?: string };
}

interface ApiMeeting {
  title?: string;
  date?: string;
  type?: string;
  meetingStatus?: string;
  chamber?: string;
  eventId?: string;
  committees?: { name?: string }[];
}

const BILL_LABEL: Record<string, string> = { HR: 'H.R.', S: 'S.', HJRES: 'H.J.Res.', SJRES: 'S.J.Res.', HRES: 'H.Res.', SRES: 'S.Res.', HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.' };
const BILL_PATH: Record<string, string> = { HR: 'house-bill', S: 'senate-bill', HJRES: 'house-joint-resolution', SJRES: 'senate-joint-resolution', HRES: 'house-resolution', SRES: 'senate-resolution', HCONRES: 'house-concurrent-resolution', SCONRES: 'senate-concurrent-resolution' };
const KIND_LABEL: Record<CongressKind, string> = {
  'war-powers': 'war powers',
  'arms-sale-disapproval': 'arms-sale disapproval',
  'nuclear-cooperation': 'nuclear-cooperation disapproval',
  ndaa: 'defense authorization (NDAA)',
  hearing: 'hearing',
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const placeOf = (text: string) => matchGazetteer(text).countryCodes.filter((c) => c !== 'US');

function base(id: string, nowIso: string, at: string, url: string, countries: string[]) {
  return {
    id,
    contentHash: id,
    dataOrigin: 'live' as const,
    sourceId: CONGRESS_SOURCE_ID,
    sourceName: 'Congress.gov',
    sourceClass: 'official' as const,
    sourceUrl: url,
    category: 'official' as const,
    regionIds: [...new Set(countries.flatMap(regionsForCountry))].filter((r) => r !== 'united-states'),
    countryCodes: countries,
    publishedAt: at,
    occurredAt: at,
    collectedAt: nowIso,
    credibility: 'official' as const,
    verificationStatus: 'unreviewed' as const,
    locationPrecision: countries.length ? ('country' as const) : ('none' as const),
  };
}

/** One record per measure and latest action (introduction, committee step, floor vote …). */
export function measureEvents(bills: ApiBill[], nowIso: string, sinceIso: string): IntelligenceEvent[] {
  return bills.flatMap((b) => {
    const kind = classifyMeasure(b.title ?? '');
    const action = b.latestAction;
    if (!kind || !action?.actionDate || action.actionDate < sinceIso.slice(0, 10)) return [];
    const label = `${BILL_LABEL[b.type?.toUpperCase()] ?? b.type} ${b.number}`;
    const countries = placeOf(b.title);
    const text = cleanText(action.text ?? '');
    const vote = /\bVote\b|Record Vote|Yea-Nay|passed|agreed to/i.test(text);
    const url = `https://www.congress.gov/bill/${ordinal(b.congress)}-congress/${BILL_PATH[b.type?.toUpperCase()] ?? 'bill'}/${b.number}`;
    const id = contentHash(CONGRESS_SOURCE_ID, b.congress, b.type, b.number, action.actionDate, text);
    return [{
      ...base(id, nowIso, `${action.actionDate}T12:00:00.000Z`, url, countries),
      title: truncate(`Congress — ${KIND_LABEL[kind]}: ${label}${countries.length ? ` (${countries.join(', ')})` : ''}: ${text}`, LIMITS.title),
      summary: truncate(`${cleanText(b.title)} Latest action ${action.actionDate}: ${text}`, LIMITS.summary),
      metadata: { subtype: 'congress', congressKind: kind, measure: label, floorVote: vote },
    }];
  });
}

export function hearingEvents(meetings: ApiMeeting[], nowIso: string): IntelligenceEvent[] {
  return meetings.flatMap((m) => {
    const committees = (m.committees ?? []).map((c) => c.name ?? '').filter(Boolean);
    if (!m.eventId || !m.title || !m.date || !committees.some((c) => SECURITY_COMMITTEE.test(c))) return [];
    const title = cleanText(m.title);
    const countries = placeOf(title);
    const day = m.date.slice(0, 10);
    const status = (m.meetingStatus ?? '').toLowerCase();
    const id = contentHash(CONGRESS_SOURCE_ID, 'meeting', m.eventId, status);
    return [{
      ...base(id, nowIso, nowIso, `https://www.congress.gov/event/${ordinal(congressNumber(day))}-congress/${(m.chamber ?? 'house').toLowerCase()}-event/${m.eventId}`, countries),
      occurredAt: `${m.date.slice(0, 19)}.000Z`,
      title: truncate(`${committees[0]} ${m.type?.toLowerCase().includes('markup') ? 'markup' : 'hearing'} (${day}${status && status !== 'scheduled' ? `, ${status}` : ''}): ${title}`, LIMITS.title),
      summary: truncate(`${m.type ?? 'Meeting'} of ${committees.join('; ')} on ${day}${status ? ` (${status})` : ''}. ${title}`, LIMITS.summary),
      metadata: { subtype: 'congress', congressKind: 'hearing', eventId: m.eventId, committees, closed: /closed/i.test(m.type ?? '') },
    }];
  });
}

export interface CongressState {
  lastFetchedAt: string;
  /** Committee meetings already read (event id → update date). */
  meetingsSeen: Record<string, string>;
}

/**
 * Congress.gov: war-powers and use-of-force resolutions, arms-sale and nuclear-cooperation
 * disapprovals, NDAA actions, and hearings of the armed services, intelligence, foreign affairs
 * and homeland security committees. Free key (api.data.gov), every 2 hours.
 */
export const congress: SourceAdapter<CongressState> = {
  sourceId: CONGRESS_SOURCE_ID,
  requiredEnv: [CONGRESS_KEY_ENV],
  async collect(ctx: AdapterContext<CongressState>): Promise<AdapterResult<CongressState>> {
    const key = readSecret(CONGRESS_KEY_ENV);
    if (!key) throw new Error(`${CONGRESS_KEY_ENV} is not set`);
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < CONGRESS_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const nowIso = new Date(ctx.now).toISOString();
    const since = new Date(ctx.now - LOOKBACK_DAYS * 86_400_000).toISOString();
    const n = congressNumber(nowIso);
    // The key goes in a header (X-Api-Key), never in a URL that could be logged.
    const get = async <T>(path: string): Promise<T> => {
      const res = await ctx.fetch(`${API}${path}${path.includes('?') ? '&' : '?'}format=json`, undefined, { 'X-Api-Key': key, Accept: 'application/json' });
      if (res.kind !== 'ok') throw new Error(`Congress.gov: unexpected 304 for ${path.split('?')[0]}`);
      return JSON.parse(res.body) as T;
    };
    const bills: ApiBill[] = [];
    for (const type of ['hjres', 'sjres']) bills.push(...((await get<{ bills?: ApiBill[] }>(`/bill/${n}/${type}?limit=50&sort=updateDate+desc`)).bills ?? []));
    const fromDate = (ctx.state ? new Date(Date.parse(ctx.state.lastFetchedAt) - 3_600_000) : new Date(since)).toISOString().slice(0, 19) + 'Z';
    bills.push(...((await get<{ bills?: ApiBill[] }>(`/bill?limit=250&sort=updateDate+desc&fromDateTime=${fromDate}`)).bills ?? []));

    const seen = { ...(ctx.state?.meetingsSeen ?? {}) };
    const list = (await get<{ committeeMeetings?: { eventId?: string; updateDate?: string; chamber?: string }[] }>(`/committee-meeting/${n}?limit=50`)).committeeMeetings ?? [];
    const fresh = list.filter((m) => m.eventId && m.updateDate && seen[m.eventId] !== m.updateDate).slice(0, MAX_MEETING_DETAILS);
    const meetings: ApiMeeting[] = [];
    for (const m of fresh) {
      const d = await get<{ committeeMeeting?: ApiMeeting }>(`/committee-meeting/${n}/${(m.chamber ?? 'house').toLowerCase()}/${m.eventId}`);
      if (d.committeeMeeting) meetings.push({ ...d.committeeMeeting, eventId: m.eventId });
      seen[m.eventId!] = m.updateDate!;
    }
    const keep = Object.fromEntries(Object.entries(seen).slice(-400));
    const unique = [...new Map(bills.map((b) => [`${b.type}${b.number}`, b])).values()];
    return {
      events: [...measureEvents(unique, nowIso, since), ...hearingEvents(meetings, nowIso)],
      rejected: [],
      itemsSeen: unique.length + meetings.length,
      notModified: false,
      state: { lastFetchedAt: nowIso, meetingsSeen: keep },
    };
  },
};
