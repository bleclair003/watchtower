import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from './types.ts';
import type { IndicatorEvaluation, IndicatorState } from './indicators/types.ts';
import { INDICATOR_CATALOG } from './indicators/catalog.ts';
import { evaluateIndicator } from './indicators/evaluate.ts';
import { describeChange, indicatorChanges, isNotableWarning, regionChanges } from './changes.ts';

const NOW = Date.parse('2026-11-21T14:00:00Z');
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
const def = INDICATOR_CATALOG.find((d) => d.regionId === 'middle-east' && !d.experimental)!;
const exp = INDICATOR_CATALOG.find((d) => d.experimental)!;

function ev(id: string, state: IndicatorState, sinceH: number, previousState?: IndicatorState | null, indicatorId = def.id): IndicatorEvaluation {
  const e: IndicatorEvaluation = {
    indicatorId,
    regionId: INDICATOR_CATALOG.find((d) => d.id === indicatorId)!.regionId,
    state,
    reason: '',
    evaluatedAt: iso(NOW),
    configVersion: 1,
    matchedCount: 0,
    distinctSources: 0,
    elevatedAt: 1,
    triggeredAt: 2,
    baseline: { status: 'not-configured', meanPerWindow: null, historyDays: 0 },
    evidenceEventIds: [],
    lastTriggeredAt: null,
    stateSince: iso(NOW - sinceH * H),
  };
  void id;
  return previousState === undefined ? e : { ...e, previousState };
}

function news(id: string, title: string, hoursAgo: number, sourceId = 'bbc-world', extra: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  return {
    id,
    contentHash: id,
    dataOrigin: 'live',
    sourceId,
    sourceName: sourceId,
    sourceClass: 'media',
    sourceUrl: `https://example.test/${id}`,
    title,
    category: 'military',
    regionIds: ['middle-east'],
    countryCodes: ['IL'],
    publishedAt: iso(NOW - hoursAgo * H),
    occurredAt: null,
    collectedAt: iso(NOW - hoursAgo * H),
    credibility: 'single-source',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    ...extra,
  };
}

describe('indicator changes', () => {
  it('reports known transitions with direction, newest first within direction', () => {
    const out = indicatorChanges([ev('a', 'TRIGGERED', 2, 'ELEVATED'), ev('b', 'NORMAL', 5, 'ELEVATED')], NOW);
    expect(out.map((c) => [c.direction, describeChange(c)])).toEqual([
      ['up', 'ELEVATED → TRIGGERED'],
      ['down', 'ELEVATED → NORMAL'],
    ]);
  });

  it('never invents a "returned to normal" when the earlier state is unknown or the indicator is new', () => {
    expect(indicatorChanges([ev('a', 'NORMAL', 2), ev('b', 'NORMAL', 2, null), ev('c', 'DATA_UNAVAILABLE', 2, null)], NOW)).toEqual([]);
    // An active state with an unknown predecessor is still worth a line.
    expect(indicatorChanges([ev('a', 'ELEVATED', 2)], NOW).map(describeChange)).toEqual(['now ELEVATED']);
  });

  it('ignores changes older than 24 h and experimental indicators', () => {
    expect(indicatorChanges([ev('a', 'TRIGGERED', 30, 'NORMAL'), ev('b', 'TRIGGERED', 1, 'NORMAL', exp.id)], NOW)).toEqual([]);
  });

  it('evaluation records the previous state on a change and carries it while unchanged', () => {
    const first = evaluateIndicator(def, [], [], NOW - 2 * H, null);
    expect(first.previousState).toBeNull();
    const changed = evaluateIndicator(def, [], [], NOW, { ...first, state: 'ELEVATED' });
    expect(changed.previousState).toBe('ELEVATED');
    const same = evaluateIndicator(def, [], [], NOW + H, changed);
    expect(same.previousState).toBe('ELEVATED');
    expect(same.stateSince).toBe(changed.stateSince);
    // Evaluations stored before v0.32.0 have no previousState: it stays absent, never "undefined" (Firestore rejects it).
    const legacy = { ...changed } as IndicatorEvaluation;
    delete legacy.previousState;
    expect('previousState' in evaluateIndicator(def, [], [], NOW + H, legacy)).toBe(false);
  });
});

describe('region changes', () => {
  it('counts only stories whose first report is in the last 24 h', () => {
    const events = [
      news('old1', 'Israel strikes targets in southern Lebanon overnight', 30),
      news('old2', 'Israel strikes in southern Lebanon continue', 3, 'aljazeera'),
      news('new1', 'Iran announces naval exercise in Strait of Hormuz', 4),
      news('new2', 'Iran naval exercise begins near Strait of Hormuz', 2, 'aljazeera'),
    ];
    const c = regionChanges({ events, indicatorEvaluations: [], regionScores: [], scoreHistory: [] }, 'middle-east', NOW);
    expect(c.newStories.map((s) => s.reports)).toEqual([2]);
    expect(c.newStories[0].title).toMatch(/Hormuz/);
    expect(c.records).toEqual({ last24h: 3, previous24h: 1 });
    expect(c.rai).toEqual({ score: null, delta: null });
  });

  it('lists notable official warnings, including embassy drawdowns', () => {
    const drawdown = news('w1', 'Ordered departure: Embassy staff', 1, 'state-travel-advisories', { sourceClass: 'official', metadata: { postureChange: 'ordered-departure' } });
    expect(isNotableWarning(drawdown)).toBe(true);
    const c = regionChanges({ events: [drawdown], indicatorEvaluations: [], regionScores: [], scoreHistory: [] }, 'middle-east', NOW);
    expect(c.warnings.map((e: IntelligenceEvent) => e.id)).toEqual(['w1']);
  });
});

