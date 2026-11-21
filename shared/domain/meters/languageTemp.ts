import type { IntelligenceEvent } from '../types.ts';
import { getRegion } from '../regions.ts';
import { scoreHeadline, temperature } from '../language.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent, MeterEvidence, MeterLevel } from './types.ts';
import { isNews } from './signals.ts';
import { BASELINE_DAYS, DAY, at, inRegion, levelFromScore, meter, newest } from './util.ts';

export const MIN_HEADLINES = 5;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

/**
 * Language temperature (per region): the tone of the region's news headlines over 72 hours,
 * from −100 (calming) to +100 (escalating), with a day-by-day breakdown. Word lists:
 * shared/domain/language.ts. Compared with the region's usual temperature once 14 days of history exist.
 */
export function languageTemperature(input: MeterInput, regionId: string): Meter {
  const { now, events, historyStart } = input;
  const news = events.filter((e) => inRegion(e, regionId) && isNews(e) && at(e) <= now + 3_600_000);
  const scored = news.map((e) => ({ e, s: scoreHeadline(e.title) }));
  const recent = scored.filter(({ e }) => at(e) >= now - 72 * 3_600_000);
  const temp = temperature(recent.map((x) => x.s.score));
  const ready = historyStart !== null && now - historyStart >= BASELINE_DAYS * DAY;
  const earlier = scored.filter(({ e }) => at(e) < now - 72 * 3_600_000);
  const usual = ready && earlier.length >= 10 ? temperature(earlier.map((x) => x.s.score)) : null;
  const delta = usual === null ? null : temp - usual;

  // Day by day (UTC), last 7 days, newest first.
  const days: MeterComponent[] = [];
  for (let d = 0; d < 7; d++) {
    const end = now - d * DAY;
    const day = scored.filter(({ e }) => at(e) > end - DAY && at(e) <= end);
    if (!day.length) continue;
    const label = d === 0 ? 'Last 24 h' : `${new Date(end - DAY).toISOString().slice(5, 10)}`;
    days.push({ label, value: `${signed(temperature(day.map((x) => x.s.score)))} (${day.length} headline${day.length === 1 ? '' : 's'})`, active: temperature(day.map((x) => x.s.score)) >= 25 });
  }
  // Most frequent listed words in the window.
  const counts = new Map<string, number>();
  for (const { s } of recent) for (const w of [...s.escalation, ...s.deescalation.map((d) => `calm: ${d}`)]) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, n]) => `${w} ×${n}`).join(', ');

  const raw: MeterLevel = recent.length === 0 ? null : delta !== null ? (delta <= 0 ? 0 : levelFromScore(delta, [5, 15, 30, 45])) : temp <= 0 ? 0 : levelFromScore(temp, [10, 25, 40, 60]);
  // A handful of headlines swings easily: below 5, the level is capped at GUARDED.
  const few = recent.length > 0 && recent.length < MIN_HEADLINES;
  const level: MeterLevel = raw !== null && few ? (Math.min(raw, 2) as MeterLevel) : raw;
  const heated = [...recent].sort((a, b) => b.s.score - a.s.score || at(b.e) - at(a.e));
  const calm = [...recent].filter((x) => x.s.score < 0).sort((a, b) => a.s.score - b.s.score);
  const ev = (x: { e: IntelligenceEvent; s: ReturnType<typeof scoreHeadline> }): MeterEvidence => ({
    title: x.e.title,
    url: x.e.sourceUrl,
    at: x.e.publishedAt ?? x.e.collectedAt,
    why: `${signed(x.s.score)}: ${[...x.s.escalation, ...x.s.deescalation.map((d) => `calm: ${d}`)].join(', ') || 'no listed words'}`,
  });
  const short = getRegion(regionId)?.shortCode ?? regionId;
  return meter({
    id: `language.${regionId}`,
    kind: 'language',
    family: 'topic',
    name: `${short} language temperature`,
    regionId,
    level,
    label: recent.length ? `${signed(temp)}°${delta !== null ? ` (${signed(delta)} VS USUAL)` : ''}` : 'NO HEADLINES',
    value: recent.length ? temp : null,
    reading: !recent.length
      ? 'No news headlines about the region in 72 hours.'
      : `${recent.length} headline${recent.length === 1 ? '' : 's'} in 72 h average ${signed(temp)} on a −100 (calming) to +100 (escalating) scale${usual !== null ? `; the usual level is ${signed(usual)}` : ''}.${top ? ` Most frequent: ${top}.` : ''}${few && raw !== null && raw > 2 ? ` Only ${recent.length}: level capped at GUARDED.` : few ? ` Only ${recent.length} headlines.` : ''}`,
    components: days,
    evidence: [...heated.filter((x) => x.s.score > 0).slice(0, 4).map(ev), ...calm.slice(0, 1).map(ev)],
    asOf: newest(recent.map((x) => x.e)),
    baseline: ready ? 'ok' : 'building',
    notes: [
      'Word lists with weights in shared/domain/language.ts (open, adjustable). "Ceasefire collapses" or "talks stall" count as escalation.',
      'Headlines only, English only: tone, not facts. A region with few headlines swings easily.',
    ],
  });
}
