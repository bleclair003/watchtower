// @vitest-environment node
/** Phase 24: usual-level scores in the meters and the convergence (unusual readings) meter. */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { MeterInput } from '../../shared/domain/meters/input.ts';
import type { IndicatorEvaluation } from '../../shared/domain/indicators/types.ts';
import type { Meter } from '../../shared/domain/meters/types.ts';
import { usualLevel, levelFromUsual } from '../../shared/domain/meters/util.ts';
import { convergence } from '../../shared/domain/meters/convergence.ts';
import { informationBlackout } from '../../shared/domain/meters/topics.ts';
import { INDICATOR_CATALOG } from '../../shared/domain/indicators/catalog.ts';

const NOW = Date.parse('2026-12-20T14:00:00Z');
const H = 3_600_000;
const DAY = 24 * H;
let n = 0;
function ev(hoursAgo: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = `a${++n}`;
  const t = new Date(NOW - hoursAgo * H).toISOString();
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title: 'Item', category: 'military', regionIds: ['middle-east'], countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t,
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}
/** `perDay` events a day for `days` days before the last 24 h, then `today` in the last 24 h. */
const series = (perDay: number[], today: number) => [
  ...perDay.flatMap((k, d) => Array.from({ length: k }, (_, i) => ev(24 + d * 24 + 1 + i * 0.5))),
  ...Array.from({ length: today }, (_, i) => ev(1 + i * 0.2)),
];

describe('usual level with a typical spread', () => {
  const start = NOW - 21 * DAY - 2 * H;
  it('scores a jump against a steady series as very unusual', () => {
    const u = usualLevel(series(Array(20).fill(10), 30), () => true, NOW, 24, start);
    expect(u.anomaly?.status).toBe('ok');
    expect(u.anomaly!.score!).toBeGreaterThanOrEqual(3);
    expect(levelFromUsual(u, [0.01, 1.5, 2, 3])).toBe(4);
  });
  it('treats the same jump against a jumpy series as ordinary', () => {
    const jumpy = [2, 25, 4, 30, 6, 18, 3, 28, 10, 22, 5, 27, 8, 19, 4, 26, 9, 21, 3, 24];
    const u = usualLevel(series(jumpy, 30), () => true, NOW, 24, start);
    expect(u.anomaly!.direction).toBe('normal');
  });
  it('detects a drop in reporting from a busy region', () => {
    const events = series(Array(20).fill(20), 2);
    const m = informationBlackout({ now: NOW, events, historyStart: start, sourceStatus: [], regionScores: [], scoreHistory: [] }, 'middle-east');
    expect(m.components.find((c) => c.label === 'Records in 24 h')?.active).toBe(true);
    expect(m.signals?.[0]).toMatchObject({ kind: 'drop', group: 'volume' });
  });
});

describe('convergence', () => {
  const base: MeterInput = { now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [] };
  const m = (kind: Meter['kind'], signals: Meter['signals'], baseline: Meter['baseline'] = 'ok'): Meter => ({
    id: `${kind}.middle-east`, kind, family: 'topic', name: kind, regionId: 'middle-east', level: 1, label: '', value: null, reading: '', components: [], evidence: [], asOf: null, baseline, notes: [], signals,
  });
  const ind = INDICATOR_CATALOG.find((d) => d.regionId === 'middle-east' && d.baseline)!;
  const evaluation = (score: number): IndicatorEvaluation =>
    ({ indicatorId: ind.id, regionId: 'middle-east', state: 'ELEVATED', reason: '', evaluatedAt: '', configVersion: 1, matchedCount: 9, distinctSources: 2, elevatedAt: 6, triggeredAt: 8, baseline: { status: 'sufficient', meanPerWindow: 3, historyDays: 28, method: 'robust', median: 3, spread: 2, score, samples: 25 }, evidenceEventIds: [], stateSince: '', lastTriggeredAt: null }) as IndicatorEvaluation;

  it('builds until some detector knows its usual level', () => {
    expect(convergence(base, 'middle-east', [m('air-surge', [], 'building')]).label).toBe('BUILDING BASELINE');
  });
  it('counts independent groups, not every signal', () => {
    const meters = [
      m('air-surge', [{ label: 'Aircraft', group: 'aircraft', kind: 'spike', score: 3.1 }]),
      m('buildup', [
        { label: 'Posture', group: 'posture', kind: 'spike', score: 2.4 },
        { label: 'News', group: 'news', kind: 'spike', score: 2.2 },
      ]),
      m('blackout', [{ label: 'News again', group: 'news', kind: 'spike', score: 2.0 }]),
    ];
    const c = convergence({ ...base, indicatorEvaluations: [evaluation(2.5), evaluation(1.2)] }, 'middle-east', meters);
    expect(c.value).toBe(4); // aircraft, posture, news, one indicator family
    expect(c.level).toBe(4);
    expect(c.reading).toMatch(/Aircraft unusually high/);
  });
  it('says all normal when scored detectors see nothing', () => {
    const c = convergence(base, 'middle-east', [m('air-surge', [])]);
    expect([c.label, c.level]).toEqual(['ALL NORMAL', 0]);
  });
});
