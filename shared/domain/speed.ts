import type { IntelligenceEvent } from './types.ts';
import { getSource } from './sources.ts';
import { buildStories } from './stories/stories.ts';
import { isNews } from './changes.ts';

/**
 * Phase 15 item 6: who's first.
 *
 *  1. Outlets: in every story carried by two or more publishers, who published first and how many
 *     hours later each other publisher followed.
 *  2. Kinds of event: a sensor or official record (earthquake, internet outage, disaster alert,
 *     DPRK launch, WHO outbreak report, sanctions, travel advice) paired with the first news report
 *     about the same kind of event in the same country within 48 hours either side: how far ahead of
 *     (or behind) the news the source was.
 *
 * Times are the timestamps the feeds give (publication times), not when a story first appeared
 * anywhere online. Collection runs every 30 minutes, so differences under an hour are noise.
 */

const H = 3_600_000;
const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export interface OutletSpeed {
  sourceId: string;
  name: string;
  /** Multi-publisher stories it took part in. */
  stories: number;
  first: number;
  /** Median hours behind the first report when it was not first. */
  medianLagHours: number | null;
}

interface KindRule {
  id: string;
  label: string;
  /** 'date': the source gives a date or a fixed hour, not the real time — compared in whole days. */
  timing: 'exact' | 'date';
  source: (e: IntelligenceEvent) => boolean;
  news: RegExp;
}

const m = (e: IntelligenceEvent, k: string) => (e.metadata ?? {})[k];
export const KIND_RULES: KindRule[] = [
  { id: 'earthquake', label: 'Earthquake (USGS, M5.5+)', timing: 'exact', source: (e) => e.sourceId === 'usgs-earthquakes' && Number(m(e, 'magnitude')) >= 5.5, news: /\b(earthquake|quake|tremor|seismic)/i },
  { id: 'outage', label: 'Internet outage (Cloudflare, IODA)', timing: 'exact', source: (e) => e.sourceId === 'cloudflare-radar-outages' || e.sourceId === 'ioda-outages', news: /\b(internet|outage|blackout|connectivity|shutdown|cut off)/i },
  { id: 'disaster', label: 'Disaster alert (GDACS orange/red)', timing: 'exact', source: (e) => e.sourceId === 'gdacs' && ['Orange', 'Red'].includes(String(m(e, 'alertLevel'))), news: /\b(flood|floods|flooding|cyclone|typhoon|hurricane|storm|wildfire|fires?|drought|volcan|landslide)/i },
  { id: 'dprk-launch', label: 'DPRK missile launch (Yonhap)', timing: 'date', source: (e) => e.sourceId === 'yonhap-dprk-launches', news: /\b(missile|launch|ballistic)/i },
  { id: 'outbreak', label: 'Disease outbreak (WHO)', timing: 'date', source: (e) => e.sourceId === 'who-don', news: /\b(outbreak|virus|ebola|marburg|mers|cholera|mpox|flu|influenza|disease|epidemic)/i },
  { id: 'sanctions', label: 'Sanctions designations (US, EU, UK)', timing: 'date', source: (e) => ['ofac-sdn', 'eu-sanctions', 'uk-sanctions'].includes(e.sourceId) && m(e, 'subtype') === 'sanctions-designations', news: /\bsanction/i },
  { id: 'travel-uk', label: 'UK travel advice update (FCDO)', timing: 'exact', source: (e) => e.sourceId === 'uk-fcdo-travel', news: /\b(travel advi|leave the country|evacuat|embassy|consulate)/i },
  { id: 'travel-us', label: 'US travel advisory change (State)', timing: 'date', source: (e) => e.sourceId === 'state-travel-advisories' && m(e, 'change') !== 'initial', news: /\b(travel advi|leave the country|evacuat|embassy|consulate|do not travel)/i },
];

export interface KindSpeed {
  id: string;
  label: string;
  timing: 'exact' | 'date';
  /** Source records of this kind in the window. */
  records: number;
  /** Records paired with a news report on the same country within 48 hours. */
  paired: number;
  /** Paired records where the source came first. */
  sourceFirst: number;
  /** Median lead over the news (negative = behind): hours for exact timing, whole days for date timing. */
  medianLead: number | null;
  unit: 'hours' | 'days';
  examples: { source: string; news: string; lead: number }[];
}

export interface SpeedReport {
  computedAt: string;
  windowDays: number;
  outlets: OutletSpeed[];
  kinds: KindSpeed[];
  storiesCompared: number;
}

export const SPEED_WINDOW_DAYS = 30;

export function whoIsFirst(events: IntelligenceEvent[], now: number, windowDays = SPEED_WINDOW_DAYS): SpeedReport {
  const from = now - windowDays * 24 * H;
  const inWindow = events.filter((e) => at(e) >= from && at(e) <= now + H);
  const news = inWindow.filter(isNews);

  // ---- outlets (multi-publisher stories)
  const byId = new Map(news.map((e) => [e.id, e]));
  const stories = buildStories(news).filter((s) => s.publishers.length >= 2);
  const stat = new Map<string, { stories: number; first: number; lags: number[] }>();
  for (const s of stories) {
    const members = s.memberIds.map((id) => byId.get(id)!).filter(Boolean);
    const firstBy = new Map<string, number>();
    for (const e of members) firstBy.set(e.sourceId, Math.min(firstBy.get(e.sourceId) ?? Infinity, at(e)));
    const start = Math.min(...firstBy.values());
    for (const [src, t] of firstBy) {
      const x = stat.get(src) ?? { stories: 0, first: 0, lags: [] };
      x.stories++;
      if (t === start) x.first++;
      else x.lags.push((t - start) / H);
      stat.set(src, x);
    }
  }
  const outlets: OutletSpeed[] = [...stat]
    .map(([sourceId, x]) => ({ sourceId, name: getSource(sourceId)?.organization ?? sourceId, stories: x.stories, first: x.first, medianLagHours: r1(median(x.lags)) }))
    .sort((a, b) => b.first / b.stories - a.first / a.stories || b.stories - a.stories);

  // ---- kinds of event (source record vs first matching news report, same country, ±48 h)
  const kinds: KindSpeed[] = KIND_RULES.map((rule) => {
    const records = inWindow.filter(rule.source);
    let sourceFirst = 0;
    const leads: number[] = [];
    const examples: KindSpeed['examples'] = [];
    for (const r of records) {
      if (!r.countryCodes.length) continue;
      const t = at(r);
      const match = news
        .filter((n) => n.sourceId !== r.sourceId && n.countryCodes.some((c) => r.countryCodes.includes(c)) && rule.news.test(n.title) && Math.abs(at(n) - t) <= 48 * H)
        .sort((a, b) => at(a) - at(b))[0];
      if (!match) continue;
      const day = (x: number) => Math.floor(x / (24 * H));
      const lead = rule.timing === 'exact' ? (at(match) - t) / H : day(at(match)) - day(t);
      leads.push(lead);
      if (lead > 0) sourceFirst++;
      if (examples.length < 3) examples.push({ source: r.title, news: match.title, lead: r1(lead)! });
    }
    return { id: rule.id, label: rule.label, timing: rule.timing, records: records.length, paired: leads.length, sourceFirst, medianLead: r1(median(leads)), unit: rule.timing === 'exact' ? ('hours' as const) : ('days' as const), examples };
  });

  return { computedAt: new Date(now).toISOString(), windowDays, outlets, kinds, storiesCompared: stories.length };
}
