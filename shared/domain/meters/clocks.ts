import type { IntelligenceEvent } from '../types.ts';
import type { MeterInput } from './input.ts';
import type { CalendarItem, DaysSinceCounter } from './types.ts';
import { isAdvisoryRaise, isDprkLaunch, isDprkNuclearTest, isGovernmentShutdown, isUnscDivided, isUnscFailedDraft, isUnscMeeting } from './signals.ts';
import { DAY, inRegion, meta } from './util.ts';
import { knownDatesAhead } from '../knownDates.ts';

const when = (e: IntelligenceEvent) => e.occurredAt ?? e.publishedAt ?? e.collectedAt;

interface CounterDef {
  id: string;
  label: string;
  rule: string;
  pred?: (e: IntelligenceEvent) => boolean;
  /** For counters fed by a layer rather than records. */
  layer?: (input: MeterInput) => { at: string; title: string; url: string | null } | null;
}

export const COUNTERS: CounterDef[] = [
  { id: 'dprk-launch', label: 'DPRK missile launch', rule: 'Yonhap reports a North Korean missile launch (one record per Korea day).', pred: isDprkLaunch },
  { id: 'dprk-nuclear-test', label: 'DPRK nuclear test', rule: 'Yonhap reports a North Korean nuclear test.', pred: isDprkNuclearTest },
  { id: 'unsc-ukraine', label: 'UNSC meeting on Ukraine', rule: 'A UN Security Council meeting whose agenda is tagged to Eastern Europe / Ukraine.', pred: (e) => isUnscMeeting(e) && inRegion(e, 'eastern-europe') },
  { id: 'unsc-middle-east', label: 'UNSC meeting on the Middle East', rule: 'A UN Security Council meeting whose agenda is tagged to the Middle East.', pred: (e) => isUnscMeeting(e) && inRegion(e, 'middle-east') },
  { id: 'unsc-split', label: 'Divided UNSC vote or failed draft', rule: 'A resolution adopted with votes against or abstentions, or a draft that failed or was vetoed.', pred: (e) => isUnscDivided(e) || isUnscFailedDraft(e) },
  {
    id: 'carrier-gulf',
    label: 'US carrier in the Middle East',
    rule: 'The weekly USNI tracker places an aircraft carrier (CVN) in a Middle East area (Arabian Sea, Gulf, Gulf of Oman, eastern Mediterranean).',
    layer: (input) => {
      const area = (input.fleet?.areas ?? []).find((a) => a.regionIds.includes('middle-east') && a.ships.some((s) => s.hullType === 'CVN'));
      if (!area || !input.fleet) return null;
      const ship = area.ships.find((s) => s.hullType === 'CVN')!;
      return { at: `${input.fleet.asOf}T12:00:00.000Z`, title: `${ship.name} (${ship.hull}) — ${area.name}`, url: input.fleet.url };
    },
  },
  { id: 'ordered-departure', label: 'Embassy ordered departure', rule: 'The State Department orders non-emergency staff and families to leave a post.', pred: (e) => e.sourceId === 'state-travel-advisories' && meta(e, 'postureChange') === 'ordered-departure' },
  { id: 'level4-raise', label: 'US advisory raised to Level 4', rule: 'A State Department advisory raised to Level 4 (Do Not Travel).', pred: (e) => isAdvisoryRaise(e) && meta(e, 'advisoryLevel') === 4 },
  { id: 'gov-shutdown', label: 'Government-ordered internet shutdown', rule: 'Cloudflare Radar attributes an outage to a government order.', pred: isGovernmentShutdown },
  {
    id: 'sanctioned-ship',
    label: 'Sanctioned ship seen on AIS',
    rule: 'A ship on the US, EU or UK sanctions lists broadcasts in the Baltic or North Sea.',
    layer: (input) => {
      const s = [...(input.sanctionedShips?.sightings ?? [])].sort((a, b) => b.seenAt.localeCompare(a.seenAt))[0];
      return s ? { at: s.seenAt, title: `${s.listedName}${s.imo ? ` (IMO ${s.imo})` : ''}`, url: null } : null;
    },
  },
];

/** "Days since" counters: the newest occurrence in loaded data, carried forward from the previous run so they outlive the loaded window. */
export function daysSince(input: MeterInput): DaysSinceCounter[] {
  return COUNTERS.map((def) => {
    const prev = input.previous?.counters.find((c) => c.id === def.id) ?? null;
    let found: { at: string; title: string; url: string | null } | null = null;
    if (def.pred) {
      const hit = input.events.filter(def.pred).sort((a, b) => when(b).localeCompare(when(a)))[0];
      if (hit) found = { at: when(hit), title: hit.title, url: hit.sourceUrl };
    } else if (def.layer) {
      found = def.layer(input);
    }
    const best = found && (!prev?.lastAt || found.at >= prev.lastAt) ? found : prev?.lastAt ? { at: prev.lastAt, title: prev.title ?? '', url: prev.url } : null;
    return { id: def.id, label: def.label, rule: def.rule, lastAt: best?.at ?? null, title: best?.title ?? null, url: best?.url ?? null };
  });
}

export const daysBetween = (fromIso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(fromIso)) / DAY));

/** Dated items ahead: scheduled military launches (Launch Library 2), security-committee hearings (Congress.gov), curated known dates and predicted CME arrivals (NASA DONKI). 30 days. */
export function upcomingCalendar(input: MeterInput): CalendarItem[] {
  const { now } = input;
  const end = now + 30 * DAY;
  const launches: CalendarItem[] = (input.upcomingLaunches ?? [])
    .filter((l) => Date.parse(l.net) > now && Date.parse(l.net) <= end)
    .map((l) => ({ at: l.net, title: `${l.name}${l.provider ? ` — ${l.provider}` : ''}${l.status ? ` (${l.status})` : ''}`, kind: 'launch' as const, url: l.url, source: 'Launch Library 2', regionIds: [] }));
  const hearings: CalendarItem[] = input.events
    .filter((e) => e.sourceId === 'congress' && e.occurredAt && Date.parse(e.occurredAt) > now && Date.parse(e.occurredAt) <= end)
    .map((e) => ({ at: e.occurredAt!, title: e.title, kind: 'hearing' as const, url: e.sourceUrl, source: 'Congress.gov', regionIds: e.regionIds }));
  const known: CalendarItem[] = knownDatesAhead(now, 30).map((d) => ({
    at: d.at,
    title: d.approximate ? `${d.title} (usually this month)` : d.title,
    kind: 'known-date' as const,
    url: d.url,
    source: 'Known dates (curated)',
    regionIds: d.regionIds,
  }));
  const cmes: CalendarItem[] = (input.spaceWeather?.arrivals ?? [])
    .filter((a) => Date.parse(a.arrival) > now - 12 * 3_600_000 && Date.parse(a.arrival) <= end)
    .map((a) => ({
      at: a.arrival,
      title: `CME expected at Earth${a.glancing ? ' (glancing blow)' : ''}${a.kpHigh !== null ? `, model Kp up to ${a.kpHigh}` : ''} (±7 h)`,
      kind: 'other' as const,
      url: a.url,
      source: 'NASA DONKI (WSA-Enlil)',
      regionIds: [],
    }));
  const seen = new Set<string>();
  return [...launches, ...hearings, ...known, ...cmes]
    .filter((c) => (seen.has(c.title + c.at) ? false : (seen.add(c.title + c.at), true)))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 40);
}
