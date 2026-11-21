// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { scoreHeadline, temperature } from '../../shared/domain/language.ts';
import { languageTemperature } from '../../shared/domain/meters/languageTemp.ts';

const s = (t: string) => scoreHeadline(t).score;

describe('headline scores', () => {
  it('acts of force score up; talk of peace scores down', () => {
    expect(s('Israel kills Hamas commander in strike on Gaza camp')).toBe(1.5);
    expect(s('Russian missiles hit Poland')).toBe(1.5);
    expect(s('Saudi-led coalition intercepts three Houthi missiles')).toBe(1.5);
    expect(s('Ceasefire agreed in Gaza after mediation')).toBeLessThan(-1);
    expect(s('Europe ready for talks with Russia on ending war in Ukraine')).toBe(-1);
  });

  it('failing peace counts as escalation', () => {
    const r = scoreHeadline('Ceasefire collapses as shelling resumes');
    expect(r.reversed).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(scoreHeadline('Talks stall over prisoner exchange').score).toBeGreaterThan(0);
    expect(scoreHeadline('Climate talks in deadlock').score).toBeGreaterThan(0);
  });

  it('equipment and topics are not acts (checked against real headlines of 2026-11-21)', () => {
    expect(s('German attack drones pass live-fire tests')).toBe(0.5); // drones only, not "attack"
    expect(s('Whiteman bomb wings earn Presidential Unit Citation')).toBe(0);
    expect(s('New tools for troops to gun down drones')).toBeLessThanOrEqual(1);
    expect(s('B-21 Raider demonstrates weapon release capability')).toBe(0);
    expect(s('Yemeni forces retreat to defend port city from Houthis')).toBe(0);
    expect(s('US missile shortages create a range problem')).toBe(0.5);
  });

  it('temperature is the mean × 50, capped ±100', () => {
    expect(temperature([2, 2, 2])).toBe(100);
    expect(temperature([1, 0, -1, 0])).toBe(0);
    expect(temperature([])).toBe(0);
  });
});

describe('meter', () => {
  const NOW = Date.parse('2026-11-21T15:00:00Z');
  let n = 0;
  const ev = (title: string, h: number): IntelligenceEvent => {
    const id = `e${++n}`;
    const t = new Date(NOW - h * 3_600_000).toISOString();
    return { id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`, title, category: 'military', regionIds: ['middle-east'], countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country' };
  };
  const run = (events: IntelligenceEvent[], historyStart: number | null = NOW - 2 * 86_400_000) =>
    languageTemperature({ now: NOW, events, historyStart, sourceStatus: [], regionScores: [], scoreHistory: [] }, 'middle-east');

  it('caps the level when there are few headlines, and shows the hottest headlines as evidence', () => {
    const few = run([ev('Israel strikes on Gaza camp kill 7', 2), ev('Missiles hit Riyadh', 3)]);
    expect(few.level).toBeLessThanOrEqual(2);
    expect(few.reading).toMatch(/Only 2: level capped/); // raw level would be HIGH
    expect(few.evidence[0].why).toMatch(/^\+/);
  });

  it('compares with the usual temperature after 14 days', () => {
    const calmPast = Array.from({ length: 20 }, (_, i) => ev('Talks on Gaza ceasefire continue', 100 + i * 12));
    const hot = Array.from({ length: 6 }, (_, i) => ev('Israeli airstrikes kill dozens in Gaza', 2 + i));
    const m = run([...calmPast, ...hot], NOW - 20 * 86_400_000);
    expect(m.baseline).toBe('ok');
    expect(m.label).toMatch(/VS USUAL/);
    expect(m.level).toBe(4);
  });

  it('runs on the real records of 2026-11-21', () => {
    const events = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const now = Math.max(...events.map((e) => Date.parse(e.collectedAt)));
    const m = languageTemperature({ now, events, historyStart: now - 2 * 86_400_000, sourceStatus: [], regionScores: [], scoreHistory: [] }, 'middle-east');
    expect(m.value).toBeGreaterThan(20);
    expect(m.evidence.length).toBeGreaterThan(0);
  });
});
