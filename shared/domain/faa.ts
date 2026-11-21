/**
 * FAA data (Phase 17): temporary flight restriction shapes and times, live airport status (ground
 * stops, ground delay programs, delays, closures) and the FAA's prohibitions and advisories for US
 * civil aviation abroad ("Prohibitions, Restrictions and Notices"). All free, no key.
 */
import type { IntelligenceEvent } from './types.ts';
import { regionsForCountry } from './regions.ts';

// ---------------------------------------------------------------- flight restrictions (TFR)

export type TfrType = 'SECURITY' | 'VIP' | 'SPECIAL';

export interface TfrShape {
  /** e.g. "6/9141" */
  notam: string;
  type: TfrType;
  /** Where, as the FAA states it ("Middleburg, Virginia near ARMEL VOR/DME"). */
  title: string;
  /** Two-letter state code, or 'USA'. */
  state: string;
  /** ISO times, or null when the FAA gives none (or gives local time). */
  start: string | null;
  end: string | null;
  reason: string | null;
  altitude: string | null;
  /** Outline from the FAA's TFR map service, simplified and packed (see powerOutages packRings); '' when none. */
  path: string;
}

export interface TfrSnapshot {
  fetchedAt: string;
  /** All TFRs of the imported types (security, VIP, special). */
  items: TfrShape[];
  simulated?: boolean;
}

/** Active at `now`: inside its times, or no times given. */
export function tfrActive(t: Pick<TfrShape, 'start' | 'end'>, now: number): boolean {
  const s = t.start ? Date.parse(t.start) : null;
  const e = t.end ? Date.parse(t.end) : null;
  return (s === null || s <= now) && (e === null || e >= now);
}

/** "November 21, 2026 at 1830 UTC" → ISO; local times and other forms → null. */
export function tfrTime(raw: string | null | undefined): string | null {
  const m = raw?.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})(?: at (\d{2})(\d{2}))? UTC/);
  if (!m) return null;
  const t = Date.parse(`${m[1]} ${m[2]}, ${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------------------------------------------------------- airport status

export type AirportEventKind = 'ground-stop' | 'ground-delay' | 'closure' | 'arrival-delay' | 'departure-delay';

export interface AirportEvent {
  /** FAA identifier, e.g. "EWR". */
  code: string;
  name: string;
  /** FAA's own airport coordinates. */
  lat: number | null;
  lon: number | null;
  kind: AirportEventKind;
  /** Stated cause, e.g. "fog", "equipment / outage", "WX:Thunderstorms". */
  condition: string;
  start: string | null;
  end: string | null;
  /** Average or maximum delay, when given (e.g. "45 minutes"). */
  delay: string | null;
  /** A cause other than weather, traffic volume or runway work (see isNotableCondition). */
  notable: boolean;
  url: string | null;
}

export interface AirportStatusSnapshot {
  fetchedAt: string;
  events: AirportEvent[];
  simulated?: boolean;
}

export const AIRPORT_KIND_LABEL: Record<AirportEventKind, string> = {
  'ground-stop': 'Ground stop',
  'ground-delay': 'Ground delay program',
  closure: 'Airport closed',
  'arrival-delay': 'Arrival delays',
  'departure-delay': 'Departure delays',
};

const NOTABLE = /secur|\bvip\b|equipment|outage|power|fire|bomb|threat|emergenc|military|airspace|evacuat|system|telecom|comm(unication)?s?\b|radar|launch|space|drone|\buas\b|accident|incident|disabled aircraft|hazmat|police|law enforcement/i;

/** A ground stop or delay cause worth recording: not weather, traffic volume or runway work. */
export function isNotableCondition(condition: string): boolean {
  return NOTABLE.test(condition);
}

/** Airport events at or above this many simultaneous ground stops count as a widespread stop. */
export const WIDESPREAD_GROUND_STOPS = 8;

// ---------------------------------------------------------------- notices for US aviation abroad

export type NoticeKind = 'prohibition' | 'advisory' | 'regulation' | 'pointer' | 'background' | 'other';

export interface AirspaceNoticeDoc {
  title: string;
  url: string;
  kind: NoticeKind;
  /** When WATCHTOWER first saw the document on the FAA page; null for those present when tracking began. */
  firstSeen: string | null;
}

export interface AirspaceNoticeArea {
  /** Section name on the FAA page ("Iran", "Persian Gulf and Gulf of Oman"). */
  name: string;
  /** ISO alpha-2, or null for sea areas and groups. */
  code: string | null;
  regionIds: string[];
  /** Strongest notice in force: a prohibition (SFAR or prohibitory NOTAM) or an advisory. */
  level: 'prohibition' | 'advisory' | 'notice';
  docs: AirspaceNoticeDoc[];
}

export interface AirspaceNoticesSnapshot {
  fetchedAt: string;
  /** When tracking began (documents present then have no firstSeen). */
  trackingSince: string;
  areas: AirspaceNoticeArea[];
  simulated?: boolean;
}

export const FAA_NOTICES_PAGE = 'https://www.faa.gov/air_traffic/publications/us_restrictions/';

/** FAA section names → ISO codes (sections without one are sea areas or groups). */
export const NOTICE_AREA_CODE: Record<string, string> = {
  Afghanistan: 'AF', Bahamas: 'BS', Belarus: 'BY', Canada: 'CA', Colombia: 'CO', Cuba: 'CU', Ecuador: 'EC', Egypt: 'EG', Ethiopia: 'ET', Haiti: 'HT',
  Iran: 'IR', Iraq: 'IQ', Israel: 'IL', Jordan: 'JO', Kenya: 'KE', 'Korea, North': 'KP', Kuwait: 'KW', Lebanon: 'LB', Libya: 'LY', Mali: 'ML', Mexico: 'MX',
  Pakistan: 'PK', Panama: 'PA', Qatar: 'QA', 'Russian Federation': 'RU', 'Saudi Arabia': 'SA', Somalia: 'SO', 'South Sudan': 'SS', Sudan: 'SD', Syria: 'SY',
  Ukraine: 'UA', 'United Arab Emirates': 'AE', Venezuela: 'VE', Yemen: 'YE', Bahrain: 'BH', Oman: 'OM', China: 'CN', Taiwan: 'TW', Philippines: 'PH',
};
/** Sea areas and groups mapped to watch regions. */
export const NOTICE_AREA_REGIONS: Record<string, string[]> = {
  'Persian Gulf and Gulf of Oman': ['middle-east'],
  'Red Sea': ['red-sea'],
  'Black Sea': ['eastern-europe'],
  'South China Sea': ['south-china-sea'],
};

export function noticeArea(name: string): { code: string | null; regionIds: string[] } {
  const code = NOTICE_AREA_CODE[name] ?? null;
  return { code, regionIds: code ? regionsForCountry(code) : (NOTICE_AREA_REGIONS[name] ?? []) };
}

export function noticeKind(title: string): NoticeKind {
  if (/prohibit/i.test(title)) return 'prohibition';
  if (/advisory/i.test(title)) return 'advisory';
  if (/pointer/i.test(title)) return 'pointer';
  if (/\bSFAR\b|Special Federal Aviation Regulation/i.test(title)) return 'regulation';
  if (/background/i.test(title)) return 'background';
  return 'other';
}

export function areaLevel(docs: AirspaceNoticeDoc[]): AirspaceNoticeArea['level'] {
  if (docs.some((d) => d.kind === 'prohibition' || (d.kind === 'regulation' && /prohibit/i.test(d.title)))) return 'prohibition';
  if (docs.some((d) => d.kind === 'advisory')) return 'advisory';
  return 'notice';
}

// ---------------------------------------------------------------- headlines

const AIRSPACE_TERMS = /\b(airspace (is |was |has been )?(closed|closes|closing|closure|shut|reopen(s|ed)?|restrict(ed|ions?))|clos(es|ed|ing) (its|the) airspace|no[- ]fly zone|flights? (suspended|cancelled|canceled|halted|grounded|diverted|rerouted)|airlines? (suspend|cancel|halt|avoid|reroute)s?|suspends? flights|gps (jamming|interference|spoofing)|jamming of gps|notams?\b|air traffic (halted|suspended|stopped)|ground stop)/i;

/** A headline about airspace closures, suspended flights, GPS jamming or no-fly zones. */
export function isAirspaceHeadline(title: string): boolean {
  return AIRSPACE_TERMS.test(title);
}

export const FAA_FEEDS = new Set(['faa-tfr', 'faa-airport-status', 'faa-airspace-notices']);
export const isFaaRecord = (e: IntelligenceEvent) => FAA_FEEDS.has(e.sourceId);
