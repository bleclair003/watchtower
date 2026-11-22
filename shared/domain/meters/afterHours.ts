import type { IntelligenceEvent } from '../types.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterLevel } from './types.ts';
import { BASELINE_DAYS, evidenceOf, fmtUsual, levelFromUsual, meta, meter, newest, plural, usualFor, within } from './util.ts';
import { signalsOf } from '../anomaly.ts';

/**
 * Pentagon after-hours index — a stand-in for the "Pentagon pizza" idea (people working unusual
 * hours before major operations). Google Maps popular-times data has no API and may not be
 * scraped, so this uses real signals of night-time work that WATCHTOWER collects:
 *  - US military news posted at night (22:00–06:00 US Eastern): war.gov, Air Force, Marines —
 *    the only US defence feeds whose timestamps carry a real time of day
 *  - US airborne command posts (E-4B, E-6B) and government VIP transports (SAM, SPAR, VENUS, EXEC
 *    callsigns) seen on ADS-B at night, US Eastern
 * Each is compared with its usual level over 72 hours; withheld until 14 days of history.
 */

/** Feeds checked on 2026-11-21 to carry real times of day (others are stamped at a fixed hour). */
export const TIMED_DEFENCE_FEEDS = ['war-gov-news', 'af-news', 'marines-news'];
/** Command and VIP aircraft were first recorded from this release (v0.36.0): their baseline starts here. */
export const ROLE_RECORDING_START = Date.parse('2026-11-21T14:00:00Z');

const EASTERN_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
export const easternHour = (iso: string) => Number(EASTERN_HOUR.format(new Date(iso)));
export const isEasternNight = (iso: string) => {
  const h = easternHour(iso);
  return h >= 22 || h < 6;
};

const when = (e: IntelligenceEvent) => e.publishedAt ?? e.collectedAt;
export const isNightDefenceRelease = (e: IntelligenceEvent) => TIMED_DEFENCE_FEEDS.includes(e.sourceId) && !!e.publishedAt && isEasternNight(e.publishedAt);
export const isDecisionAircraft = (e: IntelligenceEvent) => e.sourceId === 'adsb-military' && !!meta(e, 'aircraftRole');
export const isNightDecisionFlight = (e: IntelligenceEvent) => isDecisionAircraft(e) && isEasternNight(when(e));

export function afterHours(input: MeterInput): Meter {
  const { now, events, historyStart } = input;
  const posts = usualFor(input, 'night-posts', isNightDefenceRelease, 72, BASELINE_DAYS, 1);
  const flightsStart = historyStart === null ? null : Math.max(historyStart, ROLE_RECORDING_START);
  const flights = usualFor(input, 'night-flights', isNightDecisionFlight, 72, BASELINE_DAYS, 1, flightsStart);
  const recentPosts = events.filter((e) => isNightDefenceRelease(e) && within(e, now, 72));
  const recentFlights = events.filter((e) => isNightDecisionFlight(e) && within(e, now, 72));
  const command = events.filter((e) => isDecisionAircraft(e) && meta(e, 'aircraftRole') === 'command' && within(e, now, 72));
  const allDay = events.filter((e) => TIMED_DEFENCE_FEEDS.includes(e.sourceId) && within(e, now, 72)).length;

  // Each part counts only with at least 2 night items, so one late post never moves the meter.
  // Levels from how unusual each part is (Phase 24; the ratio until the typical spread is known).
  const partLevel = (u: typeof posts) => (u.status === 'ok' && u.current >= 2 ? levelFromUsual(u, [0.01, 1.5, 2, 3]) : u.current > 0 ? 1 : 0);
  const ratio = (u: typeof posts) => (u.status === 'ok' && u.current >= 2 ? u.ratio! : 0);
  const ready = posts.status === 'ok' || flights.status === 'ok';
  const top = Math.max(ratio(posts), ratio(flights));
  const level: MeterLevel = ready ? (recentPosts.length + recentFlights.length === 0 ? 0 : Math.max(partLevel(posts), partLevel(flights), 1) as Exclude<MeterLevel, null>) : null;
  const fmt = fmtUsual;

  return meter({
    id: 'after-hours',
    kind: 'after-hours',
    family: 'topic',
    name: 'Pentagon after-hours',
    regionId: 'united-states',
    level,
    label: ready ? undefined : `${recentPosts.length + recentFlights.length} AT NIGHT`,
    value: ready ? top : recentPosts.length + recentFlights.length,
    reading: ready
      ? `${plural(recentPosts.length, 'night-time defence release')} and ${plural(recentFlights.length, 'night-time command or VIP flight')} in 72 h, against their usual levels.`
      : `${plural(recentPosts.length, 'defence release')} posted at night (of ${allDay}) and ${plural(recentFlights.length, 'command or VIP flight')} at night in 72 h; usual levels need ${BASELINE_DAYS} days of history.`,
    components: [
      { label: 'Defence news posted 22:00–06:00 ET (72 h)', value: fmt(posts), active: partLevel(posts) >= 2, note: 'war.gov, Air Force, Marines' },
      { label: 'Command or VIP flights at night ET (72 h)', value: fmt(flights), active: partLevel(flights) >= 2, note: `recorded since ${new Date(ROLE_RECORDING_START).toISOString().slice(0, 10)}` },
      { label: 'Airborne command posts seen (72 h, any hour)', value: String(command.length), active: command.length > 0, note: 'E-4B, E-6B; rarely broadcast' },
    ],
    evidence: evidenceOf([...recentFlights, ...recentPosts], (e) => (isDecisionAircraft(e) ? `${meta(e, 'aircraftRole')} flight at ${String(easternHour(when(e))).padStart(2, '0')}:00 ET` : `posted ${String(easternHour(when(e))).padStart(2, '0')}:00 ET`), 6),
    asOf: newest([...recentPosts, ...recentFlights]),
    baseline: ready ? 'ok' : 'building',
    baselineBasis: posts.basis?.text ?? null,
    signals: [...(posts.current >= 2 ? signalsOf('Night-time defence releases (72 h)', 'night-posts', posts.anomaly) : []), ...(flights.current >= 2 ? signalsOf('Night-time command or VIP flights (72 h)', 'night-flights', flights.anomaly) : [])],
    notes: [
      'A stand-in for the Pentagon pizza index: Google Maps popular-times data has no API and may not be scraped, so this measures night-time work through official publishing and government flights instead.',
      'Hypothesis, not evidence: news offices publish late for many reasons, and VIP flights follow travel schedules. Only aircraft that broadcast ADS-B are seen.',
    ],
  });
}
