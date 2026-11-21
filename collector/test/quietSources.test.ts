// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent, SourceStatus } from '../../shared/domain/types.ts';
import { sourceCadence } from '../../shared/domain/quietSources.ts';
import { quietMeter } from '../../shared/domain/meters/quietMeter.ts';
import { buildBrief } from '../../shared/domain/brief/brief.ts';

const NOW = Date.parse('2026-12-01T12:00:00Z');
const H = 3_600_000;
let n = 0;
const item = (sourceId: string, hoursAgo: number): IntelligenceEvent => {
  const id = `e${++n}`;
  const t = new Date(NOW - hoursAgo * H).toISOString();
  return { id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: sourceId, sourceClass: 'official', sourceUrl: `https://example.test/${id}`, title: 'x', category: 'military', regionIds: [], countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'none' };
};
const ok = (sourceId: string, failing = false): SourceStatus => ({ sourceId, health: 'ONLINE', lastAttemptAt: new Date(NOW - H / 2).toISOString(), lastSuccessAt: new Date(NOW - (failing ? 5 : 0.5) * H).toISOString(), lastNewItemAt: null, consecutiveFailures: failing ? 3 : 0, parseErrors: 0, lastError: null });
// Every 3 hours for 10 days, stopping `quietFor` hours ago.
const regular = (sourceId: string, quietFor: number) => Array.from({ length: 80 }, (_, i) => item(sourceId, quietFor + i * 3)).filter((e) => Date.parse(e.collectedAt) >= NOW - 10 * 24 * H);
const START = NOW - 10 * 24 * H;

describe('missing regulars', () => {
  it('a daily source silent for longer than its usual gap (and 24 h) is quiet; one still posting is not', () => {
    const c = sourceCadence([...regular('war-gov-news', 30), ...regular('af-news', 1)], [ok('war-gov-news'), ok('af-news')], NOW, START);
    const wg = c.find((s) => s.sourceId === 'war-gov-news')!;
    expect(wg).toMatchObject({ status: 'regular', usualGapHours: 3, quietAfterHours: 24, quiet: true });
    expect(c.find((s) => s.sourceId === 'af-news')!.quiet).toBe(false);
  });

  it('irregular sources, unreachable sources and short histories are never quiet', () => {
    const sparse = [item('who-don', 30), item('who-don', 200)];
    const c = sourceCadence([...sparse, ...regular('uk-mod', 40)], [ok('who-don'), ok('uk-mod', true)], NOW, START);
    expect(c.find((s) => s.sourceId === 'who-don')!.status).toBe('irregular');
    expect(c.find((s) => s.sourceId === 'uk-mod')!).toMatchObject({ status: 'regular', reachable: false, quiet: false }); // failures belong to source health
    const short = sourceCadence(regular('war-gov-news', 30), [ok('war-gov-news')], NOW, NOW - 3 * 24 * H);
    expect(short[0].status).toBe('building');
  });

  it('meter and brief name the quiet source', () => {
    const events = [...regular('war-gov-news', 30), ...regular('af-news', 1)];
    const m = quietMeter({ now: NOW, events, historyStart: START, sourceStatus: [ok('war-gov-news'), ok('af-news')], regionScores: [], scoreHistory: [] });
    expect(m.label).toBe('1 QUIET');
    expect(m.reading).toMatch(/gone quiet while still reachable/);
    const brief = buildBrief({ generatedAt: new Date(NOW).toISOString(), events: [], sourceStatus: [], lastRun: null, totalEventsStored: 0, indicatorEvaluations: [], regionScores: [], scoreHistory: [], quietSources: [{ sourceId: 'war-gov-news', name: 'War Department news', hoursSinceNew: 30, usualPerDay: 8 }] } as never, NOW);
    expect(brief.sections.find((s) => s.title === 'Collector health')!.lines.map((l) => l.text)).toContain('War Department news: nothing new for 30 h (usually 8 a day) — reachable but quiet');
  });

  it('real records of 2026-11-21: still building (1.3 days of history)', () => {
    const events = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const snap = JSON.parse(readFileSync(new URL('./fixtures/meters-snapshot.sample.json', import.meta.url), 'utf8'));
    const start = Math.min(...events.map((e) => Date.parse(e.collectedAt)));
    const now = Math.max(...events.map((e) => Date.parse(e.collectedAt)));
    const m = quietMeter({ now, events, historyStart: start, sourceStatus: snap.sourceStatus, regionScores: [], scoreHistory: [] });
    expect(m.label).toBe('BUILDING');
  });
});
