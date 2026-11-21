import type { IntelligenceEvent } from './types.ts';
import { getSource } from './sources.ts';
import { STORY_SOURCES, buildStories } from './stories/stories.ts';
import { isNews } from './changes.ts';
import { isStrikeNews } from './meters/signals.ts';
import { stems } from './coverage.ts';

/**
 * Phase 15 item 7: source track record — how often a source's leading reports are later carried by
 * another publisher.
 *
 *  - Leading report: no other publisher had a matching report in the 48 hours before it.
 *  - Confirmed: another publisher has a matching report within 48 hours after it.
 *  - Matching: the same story (stories.ts) or 3+ shared content words — stricter than the
 *    coverage-gap check (2 words), so confirmation is not overstated.
 *  - Reports under 48 hours old are pending and not counted.
 *
 * A low rate is not a finding of error: exclusives, regional focus and outlets WATCHTOWER does not
 * collect all lower it. It says how often others picked a report up, nothing about its truth.
 */

export const CONFIRM_HOURS = 48;
export const STRONG_SHARED = 3;
export const TRACK_WINDOW_DAYS = 30;

export interface SourceRecord {
  sourceId: string;
  publisher: string;
  /** Leading reports old enough to judge. */
  leading: number;
  confirmed: number;
  /** Strike/attack headlines among them. */
  strikeLeading: number;
  strikeConfirmed: number;
  /** Leading reports under 48 hours old. */
  pending: number;
  /** Median hours until another publisher carried it, for confirmed reports. */
  medianHoursToConfirm: number | null;
}

export interface TrackRecordReport {
  computedAt: string;
  windowDays: number;
  sources: SourceRecord[];
  /** Reports are judged from here on (the later of the window start and the start of collection). */
  judgedFrom: string;
}

const H = 3_600_000;
const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);
const publisherOf = (e: IntelligenceEvent) => getSource(e.sourceId)?.organization ?? e.sourceId;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};

/**
 * `historyStart`: when collection began. Reports published before then are not judged, because
 * WATCHTOWER cannot know whether another publisher had already carried them.
 */
export function trackRecord(events: IntelligenceEvent[], now: number, historyStart: number | null, windowDays = TRACK_WINDOW_DAYS): TrackRecordReport {
  const from = Math.max(now - windowDays * 24 * H, historyStart ?? -Infinity);
  const news = events
    .filter((e) => STORY_SOURCES.has(e.sourceId) && isNews(e) && at(e) >= from - CONFIRM_HOURS * H && at(e) <= now + H)
    .sort((a, b) => at(a) - at(b));
  const storyOf = new Map<string, string>();
  for (const s of buildStories(news)) for (const id of s.memberIds) storyOf.set(id, s.id);
  const words = new Map(news.map((e) => [e.id, stems(e.title)]));
  const countriesOk = (a: IntelligenceEvent, b: IntelligenceEvent) => !a.countryCodes.length || !b.countryCodes.length || a.countryCodes.some((c) => b.countryCodes.includes(c));
  const matches = (a: IntelligenceEvent, b: IntelligenceEvent) => {
    if (publisherOf(a) === publisherOf(b) || !countriesOk(a, b)) return false;
    const sa = storyOf.get(a.id);
    if (sa && sa === storyOf.get(b.id)) return true;
    let shared = 0;
    const wb = words.get(b.id)!;
    for (const w of words.get(a.id)!) if (wb.has(w) && ++shared >= STRONG_SHARED) return true;
    return false;
  };

  const stats = new Map<string, { leading: number; confirmed: number; strikeLeading: number; strikeConfirmed: number; pending: number; hours: number[] }>();
  for (let i = 0; i < news.length; i++) {
    const e = news[i];
    if (at(e) < from) continue;
    // Leading: nothing matching from another publisher in the 48 hours before.
    let led = true;
    for (let j = i - 1; j >= 0 && at(e) - at(news[j]) <= CONFIRM_HOURS * H; j--) {
      if (matches(news[j], e)) {
        led = false;
        break;
      }
    }
    if (!led) continue;
    const s = stats.get(e.sourceId) ?? { leading: 0, confirmed: 0, strikeLeading: 0, strikeConfirmed: 0, pending: 0, hours: [] };
    stats.set(e.sourceId, s);
    if (now - at(e) < CONFIRM_HOURS * H) {
      s.pending++;
      continue;
    }
    let confirmedAt: number | null = null;
    for (let j = i + 1; j < news.length && at(news[j]) - at(e) <= CONFIRM_HOURS * H; j++) {
      if (matches(e, news[j])) {
        confirmedAt = at(news[j]);
        break;
      }
    }
    const strike = isStrikeNews(e);
    s.leading++;
    if (strike) s.strikeLeading++;
    if (confirmedAt !== null) {
      s.confirmed++;
      if (strike) s.strikeConfirmed++;
      s.hours.push((confirmedAt - at(e)) / H);
    }
  }
  const sources: SourceRecord[] = [...stats]
    .map(([sourceId, s]) => ({ sourceId, publisher: getSource(sourceId)?.organization ?? sourceId, leading: s.leading, confirmed: s.confirmed, strikeLeading: s.strikeLeading, strikeConfirmed: s.strikeConfirmed, pending: s.pending, medianHoursToConfirm: median(s.hours) }))
    .sort((a, b) => b.leading + b.pending - (a.leading + a.pending));
  return { computedAt: new Date(now).toISOString(), windowDays, sources, judgedFrom: new Date(from).toISOString() };
}
