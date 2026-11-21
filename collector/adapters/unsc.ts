import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { countryByName, matchGazetteer } from '../../shared/domain/geo/gazetteer.ts';
import { parseFeed } from '../lib/feed.ts';
import { parseFeedDate } from '../lib/dates.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, decodeEntities, htmlToText, safeUrl, truncate } from '../lib/text.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

export const UNSC_SOURCE_ID = 'un-security-council';
const DL = 'https://digitallibrary.un.org/search';
/** Latest 30 Security Council meeting records (verbatim records and communiqués). */
export const UNSC_MEETINGS_URL = `${DL}?ln=en&p=191__a%3AS%2FPV.*&sf=latest+first&so=d&rg=30&of=xm`;
/** Latest 20 Security Council voting records (adopted resolutions with per-member votes). */
export const UNSC_VOTES_URL = `${DL}?ln=en&cc=Voting+Data&p=981__a%3A%22Security+Council%22&sf=latest+first&so=d&rg=20&of=xm`;
/** UN Meetings Coverage and Press Releases (latest 10 items, all bodies). */
export const UN_PRESS_URL = 'https://press.un.org/en/rss.xml';
/** The Digital Library catalogues meetings 1–3 days late; every 2 hours is enough. */
export const UNSC_EVERY_HOURS = 2;

// ------------------------------------------------------------- MARC XML ---

type Fields = Map<string, [string, string][][]>;
function marcRecords(xml: string): Fields[] {
  if (!xml.includes('<collection')) throw new Error('UN Digital Library: not a MARC XML collection');
  return xml
    .split('<record>')
    .slice(1)
    .map((r) => {
      const f: Fields = new Map();
      for (const m of r.matchAll(/<datafield tag="(\d+)"[^>]*>([\s\S]*?)<\/datafield>/g)) {
        const subs = [...m[2].matchAll(/<subfield code="(\w)">([^<]*)<\/subfield>/g)].map((s) => [s[1], cleanText(decodeEntities(s[2]))] as [string, string]);
        f.set(m[1], [...(f.get(m[1]) ?? []), subs]);
      }
      return f;
    });
}
const sub = (f: Fields, tag: string, code: string) => (f.get(tag) ?? []).flatMap((subs) => subs.filter(([c]) => c === code).map(([, v]) => v));
const first = (f: Fields, tag: string, code: string) => sub(f, tag, code)[0] ?? null;

/** UN subject and member-state names → ISO alpha-2. */
const UN_NAMES: Record<string, string> = {
  'syrian arab republic': 'SY', 'russian federation': 'RU', "democratic people's republic of korea": 'KP', 'republic of korea': 'KR',
  'territories occupied by israel': 'PS', palestine: 'PS', 'state of palestine': 'PS', 'gaza strip': 'PS', 'west bank': 'PS',
  'democratic republic of the congo': 'CD', 'lao people’s democratic republic': 'LA', 'republic of moldova': 'MD', 'united republic of tanzania': 'TZ',
  'united kingdom of great britain and northern ireland': 'GB', 'united states of america': 'US', 'türkiye': 'TR', 'viet nam': 'VN',
};
export function unCountry(name: string): string | null {
  const n = name.trim().toLowerCase();
  return UN_NAMES[n] ?? countryByName(n.replace(/\s*\(.*\)\s*$/, '')) ?? countryByName(n);
}

export interface Meeting {
  symbol: string;
  date: string;
  agenda: string;
  closed: boolean;
  countries: string[];
  url: string;
}

export function parseMeetings(xml: string): Meeting[] {
  return marcRecords(xml).flatMap((f) => {
    const symbol = first(f, '191', 'a');
    const date = first(f, '992', 'a');
    if (!symbol?.startsWith('S/PV.') || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const agenda = sub(f, '991', 'c')[0] ?? sub(f, '991', 'd')[0] ?? '';
    const title = first(f, '245', 'a') ?? '';
    const fromSubjects = sub(f, '650', 'a').map(unCountry);
    const fromAgenda = matchGazetteer(agenda).countryCodes;
    const recordUrl = (f.get('856') ?? []).flatMap((s) => s.filter(([c]) => c === 'u').map(([, v]) => v)).find((u) => /-EN\.pdf$/.test(u)) ?? null;
    return [{
      symbol: symbol.replace(/\s+/g, ' '),
      date,
      agenda: agenda.replace(/\.$/, ''),
      closed: /\(closed\)|in private|communiqu/i.test(title),
      countries: [...new Set([...fromSubjects, ...fromAgenda].filter((c): c is string => !!c))],
      url: safeUrl(recordUrl) ?? `https://digitallibrary.un.org/search?ln=en&p=${encodeURIComponent(`"${symbol}"`)}`,
    }];
  });
}

export interface Vote {
  symbol: string;
  date: string;
  title: string;
  agenda: string;
  meeting: string | null;
  yes: number;
  no: number;
  abstain: number;
  /** Members voting no or abstaining, with P for permanent members. */
  against: { name: string; vote: 'N' | 'A'; permanent: boolean }[];
}

export function parseVotes(xml: string): Vote[] {
  return marcRecords(xml).flatMap((f) => {
    const symbol = first(f, '791', 'a');
    const date = first(f, '992', 'a');
    if (!symbol?.startsWith('S/RES/') || !date) return [];
    const n = (c: string) => Number(first(f, '996', c) ?? 0) || 0;
    const against = (f.get('967') ?? []).flatMap((s) => {
      const get = (c: string) => s.find(([k]) => k === c)?.[1] ?? '';
      const vote = get('d');
      return vote === 'N' || vote === 'A' ? [{ name: get('e'), vote: vote as 'N' | 'A', permanent: get('b') === 'P' }] : [];
    });
    return [{
      symbol: symbol.replace(/\s+/g, ''),
      date,
      title: first(f, '245', 'a') ?? symbol,
      agenda: (sub(f, '991', 'c')[0] ?? '').replace(/\.$/, ''),
      meeting: first(f, '952', 'a'),
      yes: n('b'),
      no: n('c'),
      abstain: n('d'),
      against,
    }];
  });
}

/** Press releases that report a failed draft or a veto in the Security Council. */
export const FAILED_DRAFT_RE = /\bSecurity Council\b[\s\S]*\b(fails? to adopt|not adopted|veto(?:es|ed)?|negative vote)\b/i;

// ------------------------------------------------------------- records ---

const cc = (countries: string[]) => ({ countryCodes: countries, regionIds: [...new Set(countries.flatMap(regionsForCountry))].filter((r) => r !== 'united-states') });

function base(id: string, nowIso: string, at: string, url: string) {
  return {
    id,
    contentHash: id,
    dataOrigin: 'live' as const,
    sourceId: UNSC_SOURCE_ID,
    sourceClass: 'official' as const,
    sourceUrl: url,
    category: 'diplomatic' as const,
    publishedAt: at,
    occurredAt: at,
    collectedAt: nowIso,
    credibility: 'official' as const,
    verificationStatus: 'unreviewed' as const,
  };
}

export function meetingEvents(meetings: Meeting[], nowIso: string): IntelligenceEvent[] {
  return meetings.map((m) => {
    const where = cc(m.countries);
    const id = contentHash(UNSC_SOURCE_ID, 'meeting', m.symbol);
    return {
      ...base(id, nowIso, `${m.date}T12:00:00.000Z`, m.url),
      sourceName: 'UN Digital Library — Security Council meetings',
      title: truncate(`UN Security Council ${m.closed ? 'closed meeting' : 'meeting'} (${m.symbol}): ${m.agenda || 'agenda not catalogued'}`, LIMITS.title),
      summary: truncate(
        `${m.symbol}, ${m.date}${m.closed ? ', held in private' : ''}. Agenda: ${m.agenda || 'not catalogued'}.` +
          `${m.countries.length ? ` Countries in the UN catalogue subjects or agenda: ${m.countries.join(', ')}.` : ''} Catalogued by the UN Digital Library, usually 1–3 days after the meeting.`,
        LIMITS.summary,
      ),
      ...where,
      locationPrecision: m.countries.length ? 'country' : 'none',
      metadata: { subtype: 'unsc-meeting', symbol: m.symbol, closed: m.closed, agenda: m.agenda },
    };
  });
}

export function voteEvents(votes: Vote[], meetings: Meeting[], nowIso: string): IntelligenceEvent[] {
  return votes.map((v) => {
    const meeting = v.meeting ? meetings.find((m) => m.symbol.replace(/\s+/g, '') === v.meeting!.replace(/\s+/g, '')) : undefined;
    const countries = [...new Set([...(meeting?.countries ?? []), ...matchGazetteer(`${v.title} ${v.agenda}`).countryCodes])];
    const where = cc(countries);
    const topic = /\[(.+)\]/.exec(v.title)?.[1] ?? v.agenda;
    const tally = `${v.yes}-${v.no}-${v.abstain}`;
    const dissent = v.against.length ? ` ${v.against.map((a) => `${a.name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase())} ${a.vote === 'N' ? 'against' : 'abstained'}`).join(', ')}.` : '';
    const id = contentHash(UNSC_SOURCE_ID, 'resolution', v.symbol);
    return {
      ...base(id, nowIso, `${v.date}T12:00:00.000Z`, `https://digitallibrary.un.org/search?ln=en&p=${encodeURIComponent(`"${v.symbol}"`)}`),
      sourceName: 'UN Digital Library — Security Council votes',
      title: truncate(`UN Security Council adopts ${v.symbol.replace('S/RES/', 'resolution ')} (${tally}): ${topic}`, LIMITS.title),
      summary: truncate(`Adopted ${v.date} by ${v.yes} votes to ${v.no}, with ${v.abstain} abstention${v.abstain === 1 ? '' : 's'}.${dissent} Agenda: ${v.agenda || 'not catalogued'}.`, LIMITS.summary),
      ...where,
      locationPrecision: countries.length ? 'country' : 'none',
      metadata: { subtype: 'unsc-resolution', symbol: v.symbol, yes: v.yes, no: v.no, abstain: v.abstain, divided: v.no > 0 || v.abstain > 0 },
    };
  });
}

export function failedDraftEvents(pressXml: string, nowIso: string, sinceMs: number): IntelligenceEvent[] {
  return parseFeed(pressXml).flatMap((it) => {
    const title = cleanText(it.title);
    if (!FAILED_DRAFT_RE.test(title)) return [];
    const url = safeUrl(it.link);
    const at = parseFeedDate(it.published);
    if (!url || !at || Date.parse(at) < sinceMs) return [];
    const text = `${title} ${htmlToText(it.description)}`;
    const vetoBy = ['China', 'France', 'Russian Federation', 'United Kingdom', 'United States'].filter((p) => new RegExp(`(negative vote|veto)[^.]{0,80}\\b${p}\\b|\\b${p}\\b[^.]{0,40}\\bveto`, 'i').test(text));
    const countries = matchGazetteer(text).countryCodes;
    const id = contentHash(UNSC_SOURCE_ID, 'failed', url);
    return [{
      ...base(id, nowIso, at, url),
      sourceName: 'UN Meetings Coverage and Press Releases',
      title: truncate(title, LIMITS.title),
      summary: truncate(`${htmlToText(it.description)}${vetoBy.length ? ` Permanent member(s) named as voting against: ${vetoBy.join(', ')}.` : ''}`, LIMITS.summary),
      ...cc(countries),
      locationPrecision: countries.length ? 'country' : 'none',
      metadata: { subtype: 'unsc-failed-draft', veto: vetoBy.length > 0, vetoBy },
    } as IntelligenceEvent];
  });
}

// ------------------------------------------------------------- adapter ---

export interface UnscState {
  lastFetchedAt: string;
}

/**
 * UN Security Council: meetings and adopted resolutions from the UN Digital Library, and failed
 * drafts / vetoes from the UN press-release feed. Records are keyed by document symbol or URL,
 * so re-reading the same items adds nothing.
 */
export const unSecurityCouncil: SourceAdapter<UnscState> = {
  sourceId: UNSC_SOURCE_ID,
  async collect(ctx: AdapterContext<UnscState>): Promise<AdapterResult<UnscState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < UNSC_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const nowIso = new Date(ctx.now).toISOString();
    const get = async (url: string) => {
      const r = await ctx.fetch(url);
      if (r.kind !== 'ok') throw new Error(`unexpected 304 from ${url}`);
      return r.body;
    };
    const meetings = parseMeetings(await get(UNSC_MEETINGS_URL));
    const votes = parseVotes(await get(UNSC_VOTES_URL));
    const press = await get(UN_PRESS_URL);
    const since = ctx.now - 45 * 86_400_000;
    const events = [
      ...meetingEvents(meetings.filter((m) => Date.parse(m.date) >= since), nowIso),
      ...voteEvents(votes.filter((v) => Date.parse(v.date) >= since), meetings, nowIso),
      ...failedDraftEvents(press, nowIso, since),
    ];
    return { events, rejected: [], itemsSeen: meetings.length + votes.length, notModified: false, state: { lastFetchedAt: nowIso } };
  },
};
