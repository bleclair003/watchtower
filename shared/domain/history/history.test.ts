// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import { getIndicator, INDICATOR_CATALOG } from '../indicators/catalog.ts';
import { availableAt, collectionStart, isLateCollection, replayAt, statusesAt } from './replay.ts';
import { coActivation, dataSufficiency, episodes, scoreIndicator, simulateIndicator, type StatePoint } from './backtest.ts';
import { buildSitrep, sitrepToMarkdown, type SitrepInput } from './sitrep.ts';
import { bucketCounts } from './trends.ts';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.parse('2026-12-01T00:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

function ev(id: string, publishedAt: number, collectedAt: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'cisa-kev', sourceName: 'CISA', sourceClass: 'official', sourceUrl: `https://cisa.gov/${id}`,
    title: `Item ${id}`, category: 'cyber', regionIds: ['global-cyber'], countryCodes: [], publishedAt: iso(publishedAt), collectedAt: iso(collectedAt),
    credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'none', ...p,
  };
}

const status = (sourceId: string, first: number): SourceStatus => ({
  sourceId, health: 'ONLINE', lastAttemptAt: iso(T0 + 30 * D), lastSuccessAt: iso(T0 + 30 * D), lastNewItemAt: null,
  consecutiveFailures: 0, parseErrors: 0, lastError: null, firstSuccessAt: iso(first),
});

describe('replay is hindsight-safe', () => {
  const backfilled = ev('old', T0 - 20 * D, T0); // published long before WATCHTOWER saw it
  const live = ev('live', T0 + 2 * D, T0 + 2 * D + H);

  it('shows a record only once WATCHTOWER had collected it', () => {
    expect(availableAt([backfilled, live], T0 - 10 * D)).toEqual([]); // published, but not yet collected
    expect(availableAt([backfilled, live], T0 + D).map((e) => e.id)).toEqual(['old']);
    expect(availableAt([backfilled, live], T0 + 3 * D).map((e) => e.id)).toEqual(['old', 'live']);
    expect(isLateCollection(backfilled)).toBe(true);
    expect(isLateCollection(live)).toBe(false);
  });

  it('treats sources as uncollected before their first success', () => {
    const cur = [status('cisa-kev', T0)];
    expect(statusesAt(cur, T0 - H)).toEqual([]);
    expect(statusesAt(cur, T0 + H)[0]).toMatchObject({ health: 'ONLINE', lastSuccessAt: iso(T0 + H) });
    expect(collectionStart(cur)).toBe(T0);
  });

  it('re-runs the engine at T: before collection everything is DATA_UNAVAILABLE', () => {
    const before = replayAt(INDICATOR_CATALOG, [backfilled], [status('cisa-kev', T0)], T0 - D);
    expect(before.beforeCollection).toBe(true);
    expect(before.evaluations.every((e) => ['DATA_UNAVAILABLE', 'DISABLED'].includes(e.state))).toBe(true);
    const after = replayAt(INDICATOR_CATALOG, [backfilled], [status('cisa-kev', T0)], T0 + H);
    expect(after.evaluations.find((e) => e.indicatorId === 'global-cyber.kev-surge')!.state).toBe('NORMAL');
  });
});

describe('backtesting', () => {
  const series = (states: string[]): StatePoint[] => states.map((s, i) => ({ at: T0 + i * 6 * H, state: s as StatePoint['state'] }));

  it('finds episodes and scores them against outcomes with lead times and false alarms', () => {
    const s = series(['NORMAL', 'TRIGGERED', 'TRIGGERED', 'NORMAL', 'NORMAL', 'TRIGGERED', 'NORMAL', 'UNKNOWN']);
    expect(episodes('x', s)).toEqual([
      { indicatorId: 'x', start: T0 + 6 * H, end: T0 + 12 * H },
      { indicatorId: 'x', start: T0 + 30 * H, end: T0 + 30 * H },
    ]);
    const card = scoreIndicator('x', s, [{ id: 'o1', label: 'Outcome', at: T0 + 24 * H }, { id: 'o2', label: 'Missed', at: T0 + 10 * D }], 48);
    expect(card.hits).toEqual([{ outcomeId: 'o1', leadHours: 18 }]);
    expect(card.misses).toEqual(['o2']);
    expect(card.falseAlarms).toBe(1); // the second episode is followed by no outcome within 48 h
    expect(card.evaluableShare).toBeCloseTo(7 / 8);
  });

  it('measures co-activation between indicators', () => {
    const pairs = coActivation({ a: series(['TRIGGERED', 'TRIGGERED', 'NORMAL']), b: series(['TRIGGERED', 'NORMAL', 'NORMAL']), c: series(['NORMAL', 'NORMAL', 'NORMAL']) });
    expect(pairs).toEqual([{ a: 'a', b: 'b', jaccard: 0.5, overlapSteps: 1 }]);
  });

  it('simulates an indicator step by step using only data available at each step', () => {
    const def = getIndicator('global-cyber.kev-ransomware')!;
    const events = [ev('r1', T0 + D, T0 + D, { metadata: { knownRansomwareUse: true } }), ev('r2', T0 + D, T0 + 5 * D, { metadata: { knownRansomwareUse: true } })];
    const s = simulateIndicator(def, events, [status('cisa-kev', T0)], T0, T0 + 6 * D, 24);
    expect(s.map((p) => p.state)).toEqual(['NORMAL', 'ELEVATED', 'ELEVATED', 'ELEVATED', 'ELEVATED', 'ELEVATED', 'ELEVATED']);
    // r2 was published on day 1 but collected on day 5: it only counts from day 5 — never retroactively.
  });

  it('reports data sufficiency honestly', () => {
    expect(dataSufficiency(T0, T0 + 30 * D, T0 + 25 * D)).toEqual({ windowDays: 30, coveredDays: 5, adequate: false });
    expect(dataSufficiency(T0, T0 + 30 * D, null).coveredDays).toBe(0);
  });
});

describe('bucketCounts', () => {
  it('keeps empty buckets and ignores out-of-range records', () => {
    const b = bucketCounts([ev('a', T0 + H, T0 + H), ev('b', T0 + 2 * H, T0 + 2 * H), ev('c', T0 + 50 * H, T0 + 50 * H)], T0, T0 + 3 * D, 24);
    expect(b.map((x) => x.count)).toEqual([2, 0, 1]);
    expect(bucketCounts([ev('z', T0 - D, T0)], T0, T0 + D, 24)[0].count).toBe(0);
  });
});

describe('SITREP', () => {
  const base = (p: Partial<SitrepInput> = {}): SitrepInput => ({
    from: T0, to: T0 + D, now: T0 + D, events: [], evaluations: [], transitions: [], currentScores: [], scoreHistory: [], alerts: [], sourceStatus: [], incidents: [], ...p,
  });

  it('builds all eight sections deterministically, citing records', () => {
    const raised = ev('raised', T0 + 2 * H, T0 + 3 * H, {
      sourceId: 'state-travel-advisories', title: 'Yemen — Level 4 — RAISED', regionIds: ['red-sea'], metadata: { change: 'raised' },
    });
    const rumour = ev('rumour', T0 + 4 * H, T0 + 4 * H, { credibility: 'unverified', sourceClass: 'media' });
    const backfill = ev('backfill', T0 - 20 * D, T0 + H);
    const s = buildSitrep(base({ events: [raised, rumour, backfill] }));
    expect(s.sections.map((x) => x.key)).toEqual(['executive', 'significant', 'regional', 'warnings', 'indicators', 'unverified', 'sources', 'questions']);
    const get = (k: string) => s.sections.find((x) => x.key === k)!;
    expect(get('executive').items[0].text).toBe('2 record(s) published in the period (1 official, 1 other).');
    expect(get('executive').items[1].text).toMatch(/1 older record\(s\) were first collected/);
    expect(get('significant').items[0]).toMatchObject({ url: 'https://cisa.gov/raised', eventIds: ['raised'] });
    expect(get('warnings').items).toHaveLength(1);
    expect(get('unverified').items[0].text).toMatch(/\[unverified\]/);
    expect(s.limitations.join(' ')).toMatch(/not a probability/);
  });

  it('exports Markdown with every section, empty-state text and limitations', () => {
    const md = sitrepToMarkdown(buildSitrep(base({ eventsTruncated: true })));
    expect(md).toMatch(/^# WATCHTOWER SITREP/);
    expect(md).toContain('## 2. Significant developments');
    expect(md).toContain('_No significant developments recorded in the period._');
    expect(md).toContain('size limit');
    expect(md).toContain('do not introduce facts');
  });
});
