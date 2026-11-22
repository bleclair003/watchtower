// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import { matches, validateCondition, describeCondition, type Condition } from './conditions.ts';
import { INDICATOR_CATALOG, validateCatalog, getIndicator } from './catalog.ts';
import { evaluateIndicator, evaluateAll, requiredLookbackHours, MAX_EVIDENCE } from './evaluate.ts';
import { appendScoreHistory, bandFor, computeRegionScore, scoreDelta24h, SOURCE_CAP_SHARE } from './rai.ts';
import type { IndicatorDefinition, IndicatorEvaluation } from './types.ts';

const NOW = Date.parse('2026-12-20T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
let n = 0;

function ev(p: Partial<IntelligenceEvent> = {}, hoursAgo = 1): IntelligenceEvent {
  const id = `e${String(++n).padStart(4, '0')}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'cisa-kev', sourceName: 'x', sourceClass: 'official',
    sourceUrl: 'https://example.gov', title: 'Item', category: 'cyber', regionIds: ['global-cyber'], countryCodes: [],
    publishedAt: new Date(NOW - hoursAgo * H).toISOString(), collectedAt: new Date(NOW - hoursAgo * H).toISOString(),
    credibility: 'official', verificationStatus: 'unreviewed', locationPrecision: 'none', ...p,
  };
}

function status(sourceId: string, p: Partial<SourceStatus> = {}): SourceStatus {
  return {
    sourceId, health: 'ONLINE', lastAttemptAt: new Date(NOW - H).toISOString(), lastSuccessAt: new Date(NOW - H).toISOString(),
    lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null,
    firstSuccessAt: new Date(NOW - 90 * D).toISOString(), ...p,
  };
}

const simple = (p: Partial<IndicatorDefinition> = {}): IndicatorDefinition => ({
  id: 'test.simple', name: 'Test', description: '', family: 'cyber', regionId: 'global-cyber', requiredSourceIds: ['cisa-kev'],
  match: { field: 'sourceId', op: 'eq', value: 'cisa-kev' }, windowHours: 72,
  elevated: { countAtLeast: 2 }, triggered: { countAtLeast: 4 }, baseline: null,
  weight: 2, severity: 'medium', experimental: false, enabled: true, configVersion: 1, rationale: '', ...p,
});

describe('condition language', () => {
  const e = ev({ regionIds: ['red-sea', 'middle-east'], title: 'Yemen — Level 4', metadata: { change: 'Raised', advisoryLevel: 4 } });

  it('evaluates leaves, arrays, case-insensitive strings and numbers', () => {
    expect(matches({ field: 'regionIds', op: 'contains', value: 'red-sea' }, e)).toBe(true);
    expect(matches({ field: 'regionIds', op: 'eq', value: 'korean-peninsula' }, e)).toBe(false);
    expect(matches({ field: 'metadata.change', op: 'eq', value: 'raised' }, e)).toBe(true);
    expect(matches({ field: 'metadata.advisoryLevel', op: 'gte', value: 4 }, e)).toBe(true);
    expect(matches({ field: 'metadata.advisoryLevel', op: 'lte', value: 3 }, e)).toBe(false);
    expect(matches({ field: 'title', op: 'contains', value: 'LEVEL 4' }, e)).toBe(true);
    expect(matches({ field: 'category', op: 'in', value: ['maritime', 'cyber'] }, e)).toBe(true);
    expect(matches({ field: 'metadata.subtype', op: 'exists' }, e)).toBe(false);
    expect(matches({ field: 'regionIds', op: 'neq', value: 'red-sea' }, e)).toBe(false);
  });

  it('combines with all / any / not', () => {
    const c: Condition = { all: [{ field: 'category', op: 'eq', value: 'cyber' }, { not: { any: [{ field: 'sourceId', op: 'eq', value: 'x' }, { field: 'sourceId', op: 'eq', value: 'y' }] } }] };
    expect(matches(c, e)).toBe(true);
    expect(describeCondition(c)).toBe('category = cyber AND NOT (sourceId = x OR sourceId = y)');
  });

  it('rejects unknown fields, operators, executable-looking input and malformed groups', () => {
    expect(validateCondition({ field: 'title', op: 'contains', value: 'x' })).toEqual([]);
    expect(validateCondition({ field: 'constructor', op: 'eq', value: 1 })[0]).toMatch(/unknown field/);
    expect(validateCondition({ field: 'title', op: 'regex', value: '.*' })[0]).toMatch(/unknown operator/);
    expect(validateCondition({ field: 'title', op: 'eq', value: 'x', code: 'alert(1)' })[0]).toMatch(/unexpected keys/);
    expect(validateCondition({ all: [] })[0]).toMatch(/non-empty/);
    expect(validateCondition({ field: 'metadata.advisoryLevel', op: 'gte', value: '4' })[0]).toMatch(/needs a number/);
    expect(validateCondition('sourceId == x')[0]).toMatch(/must be an object/);
    // Inherited property names must not resolve to field readers.
    expect(matches({ field: 'toString' as never, op: 'exists' }, ev())).toBe(false);
  });
});

describe('catalog', () => {
  it('is structurally valid', () => {
    expect(validateCatalog(INDICATOR_CATALOG)).toEqual([]);
  });

  it('covers every geographic watch region plus global cyber, and keeps experiments isolated', () => {
    const regions = new Set(INDICATOR_CATALOG.filter((d) => !d.experimental).map((d) => d.regionId));
    expect([...regions].sort()).toEqual(
      ['eastern-europe', 'global-cyber', 'korean-peninsula', 'middle-east', 'red-sea', 'south-china-sea', 'taiwan-strait', 'united-states'].sort(),
    );
    const pizza = getIndicator('experimental.pentagon-pizza')!;
    expect(pizza).toMatchObject({ experimental: true, weight: 0 });
  });

  it('detects bad definitions', () => {
    const bad = [simple({ id: 'a', elevated: { countAtLeast: 5 } }), simple({ id: 'a', requiredSourceIds: ['nope'] }), simple({ id: 'b', experimental: true })];
    const problems = validateCatalog(bad);
    expect(problems.some((p) => /elevated threshold exceeds/.test(p))).toBe(true);
    expect(problems.some((p) => /duplicate id/.test(p))).toBe(true);
    expect(problems.some((p) => /unknown source nope/.test(p))).toBe(true);
    expect(problems.some((p) => /weight 0/.test(p))).toBe(true);
  });

  it('reports the longest lookback needed', () => {
    expect(requiredLookbackHours([simple(), simple({ baseline: { days: 28, triggerRatio: 2, elevatedRatio: 1 } })])).toBe(72 + 28 * 24);
  });
});

describe('evaluateIndicator — data availability (unknown is never "normal")', () => {
  it('DISABLED when disabled', () => {
    expect(evaluateIndicator(simple({ enabled: false }), [], [status('cisa-kev')], NOW).state).toBe('DISABLED');
  });

  it('DATA_UNAVAILABLE when a required source has never been collected', () => {
    const r = evaluateIndicator(simple(), [ev(), ev(), ev(), ev()], [], NOW);
    expect(r.state).toBe('DATA_UNAVAILABLE');
    expect(r.matchedCount).toBe(0);
    const r2 = evaluateIndicator(simple(), [], [status('cisa-kev', { lastSuccessAt: null })], NOW);
    expect(r2.state).toBe('DATA_UNAVAILABLE');
  });

  it('UNKNOWN when a required source is OFFLINE or STALE, even with zero matches', () => {
    expect(evaluateIndicator(simple(), [], [status('cisa-kev', { consecutiveFailures: 3 })], NOW).state).toBe('UNKNOWN');
    const stale = status('cisa-kev', { lastSuccessAt: new Date(NOW - 20 * H).toISOString(), lastAttemptAt: new Date(NOW - 20 * H).toISOString() });
    expect(evaluateIndicator(simple(), [], [stale], NOW).state).toBe('UNKNOWN');
  });

  it('a DEGRADED-but-recently-successful source still evaluates', () => {
    expect(evaluateIndicator(simple(), [], [status('cisa-kev', { consecutiveFailures: 1 })], NOW).state).toBe('NORMAL');
  });
});

describe('evaluateIndicator — thresholds and evidence', () => {
  const st = [status('cisa-kev'), status('cisa-advisories')];

  it('NORMAL / ELEVATED / TRIGGERED by count in window; window boundary is exclusive', () => {
    expect(evaluateIndicator(simple(), [ev()], st, NOW).state).toBe('NORMAL');
    expect(evaluateIndicator(simple(), [ev(), ev()], st, NOW).state).toBe('ELEVATED');
    const four = [ev({}, 1), ev({}, 10), ev({}, 50), ev({}, 71)];
    const r = evaluateIndicator(simple(), four, st, NOW);
    expect(r).toMatchObject({ state: 'TRIGGERED', matchedCount: 4, distinctSources: 1, triggeredAt: 4 });
    expect(evaluateIndicator(simple(), [...four.slice(0, 3), ev({}, 72)], st, NOW).state).toBe('ELEVATED');
  });

  it('ignores non-matching events and de-duplicates by content hash', () => {
    const dup = ev();
    const r = evaluateIndicator(simple(), [dup, { ...dup, id: 'copy' }, ev({ sourceId: 'cisa-advisories' })], st, NOW);
    expect(r.matchedCount).toBe(1);
  });

  it('honours distinct-source requirements (independent corroboration)', () => {
    const def = simple({ match: { field: 'category', op: 'eq', value: 'cyber' }, requiredSourceIds: ['cisa-kev', 'cisa-advisories'], triggered: { countAtLeast: 2, distinctSourcesAtLeast: 2 } });
    expect(evaluateIndicator(def, [ev(), ev(), ev()], st, NOW).state).toBe('ELEVATED');
    expect(evaluateIndicator(def, [ev(), ev({ sourceId: 'cisa-advisories' })], st, NOW).state).toBe('TRIGGERED');
  });

  it('records newest-first evidence, capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ev({}, i + 1));
    const r = evaluateIndicator(simple(), many, st, NOW);
    expect(r.evidenceEventIds).toHaveLength(MAX_EVIDENCE);
    expect(r.evidenceEventIds[0]).toBe(many[0].id);
  });

  it('carries stateSince and lastTriggeredAt across runs', () => {
    const four = [ev(), ev(), ev(), ev()];
    const first = evaluateIndicator(simple(), four, st, NOW);
    expect(first.lastTriggeredAt).toBe(new Date(NOW).toISOString());
    const later = evaluateIndicator(simple(), four, st, NOW + H, first);
    expect(later.stateSince).toBe(first.stateSince);
    expect(later.lastTriggeredAt).toBe(first.lastTriggeredAt);
    const calm = evaluateIndicator(simple(), [], st, NOW + 2 * H, later);
    expect(calm.state).toBe('NORMAL');
    expect(calm.lastTriggeredAt).toBe(first.lastTriggeredAt);
    expect(calm.stateSince).toBe(new Date(NOW + 2 * H).toISOString());
  });
});

describe('evaluateIndicator — baselines', () => {
  const def = simple({ baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 } });

  it('raises thresholds when the source is normally busy', () => {
    // ~2 matching events per 72 h window over the previous 28 days.
    const history = Array.from({ length: 18 }, (_, i) => ev({}, 72 + 2 + i * 36));
    const current = [ev(), ev(), ev(), ev()];
    const r = evaluateIndicator(def, [...history, ...current], [status('cisa-kev')], NOW);
    expect(r.baseline.status).toBe('sufficient');
    expect(r.baseline.meanPerWindow).toBeGreaterThan(1.5);
    expect(r.triggeredAt).toBeGreaterThan(4);
    expect(r.state).not.toBe('TRIGGERED');
  });

  it('sets thresholds from the median and typical spread of earlier windows (Phase 24)', () => {
    // Steady: one event a day for 28 days (3 per 72 h window). 7 in 72 h is unusual, 9 very unusual.
    const steady = Array.from({ length: 28 }, (_, i) => ev({}, 72 + 12 + i * 24));
    const now7 = Array.from({ length: 7 }, () => ev());
    const r = evaluateIndicator(def, [...steady, ...now7], [status('cisa-kev')], NOW);
    expect(r.baseline.method).toBe('robust');
    expect(r.baseline.median).toBe(3);
    expect(r.baseline.samples).toBeGreaterThanOrEqual(20);
    expect(r.elevatedAt).toBe(7); // 3 + 2 × √3
    expect(r.triggeredAt).toBe(9); // 3 + 3 × √3
    expect(r.state).toBe('ELEVATED');
    expect(r.reason).toMatch(/Usually 3 per window/);
    // A burst in the past does not raise the bar much (the median ignores it).
    const burst = Array.from({ length: 30 }, () => ev({}, 72 + 24 * 10));
    const r2 = evaluateIndicator(def, [...steady, ...burst, ...now7], [status('cisa-kev')], NOW);
    expect(r2.elevatedAt).toBeLessThanOrEqual(8);
  });

  it('does not apply a baseline built on too little history, and says so', () => {
    const young = status('cisa-kev', { firstSuccessAt: new Date(NOW - 12 * H).toISOString() }); // 0.5 d + 30 d backfill < 31 d needed
    const r = evaluateIndicator(def, [ev(), ev(), ev(), ev()], [young], NOW);
    expect(r.baseline.status).toBe('insufficient-history');
    expect(r.triggeredAt).toBe(4);
    expect(r.state).toBe('TRIGGERED');
    expect(r.reason).toMatch(/Baseline not applied/);
  });
});

describe('evaluateAll transitions', () => {
  it('reports transitions only when state changes', () => {
    const st = [status('cisa-kev')];
    const a = evaluateAll([simple()], [ev(), ev()], st, NOW);
    expect(a.transitions).toEqual([expect.objectContaining({ from: null, to: 'ELEVATED' })]);
    const b = evaluateAll([simple()], [ev(), ev()], st, NOW + H, a.evaluations);
    expect(b.transitions).toEqual([]);
    const c = evaluateAll([simple()], [], st, NOW + 2 * H, b.evaluations);
    expect(c.transitions).toEqual([expect.objectContaining({ from: 'ELEVATED', to: 'NORMAL' })]);
  });
});

describe('Regional Activity Index', () => {
  const evalOf = (id: string, state: IndicatorEvaluation['state']) => ({ indicatorId: id, state }) as IndicatorEvaluation;
  const a = simple({ id: 'r.a', regionId: 'red-sea', requiredSourceIds: ['state-travel-advisories'], weight: 3, severity: 'high' });
  const b = simple({ id: 'r.b', regionId: 'red-sea', requiredSourceIds: ['state-travel-advisories'], weight: 2, severity: 'medium' });
  const c = simple({ id: 'r.c', regionId: 'red-sea', requiredSourceIds: ['cisa-kev'], weight: 2, severity: 'medium' });
  const x = simple({ id: 'r.x', regionId: 'red-sea', experimental: true, weight: 0 });

  it('is N/E (null) when nothing can be evaluated — never 0', () => {
    const s = computeRegionScore('red-sea', [a, b], [evalOf('r.a', 'UNKNOWN'), evalOf('r.b', 'DATA_UNAVAILABLE')], NOW);
    expect(s).toMatchObject({ score: null, band: null, coverage: 0 });
  });

  it('is 0 / BASELINE with full coverage when all evaluable indicators are normal', () => {
    const s = computeRegionScore('red-sea', [a, b, c], [evalOf('r.a', 'NORMAL'), evalOf('r.b', 'NORMAL'), evalOf('r.c', 'NORMAL')], NOW);
    expect(s).toMatchObject({ score: 0, band: 'BASELINE', coverage: 1, activeIndicators: 0 });
  });

  it('scores from weights, severities and states, with a transparent breakdown', () => {
    const s = computeRegionScore('red-sea', [a, b, c], [evalOf('r.a', 'NORMAL'), evalOf('r.b', 'NORMAL'), evalOf('r.c', 'TRIGGERED')], NOW);
    // max = 3×2 + 2×1.5 + 2×1.5 = 12; points = 3 → 25
    expect(s.score).toBe(25);
    expect(s.band).toBe('INCREASED');
    expect(s.contributions.find((x) => x.indicatorId === 'r.c')).toMatchObject({ raw: 3, applied: 3, capped: false });
  });

  it('caps the share any single source can contribute', () => {
    const s = computeRegionScore('red-sea', [a, b, c], [evalOf('r.a', 'TRIGGERED'), evalOf('r.b', 'TRIGGERED'), evalOf('r.c', 'NORMAL')], NOW);
    // state source raw = 9 of max 12 → capped at 0.6 × 12 = 7.2 → 60
    expect(s.score).toBe(Math.round(SOURCE_CAP_SHARE * 100));
    expect(s.contributions.filter((x) => x.capped)).toHaveLength(2);
  });

  it('excludes experimental indicators and reports partial coverage', () => {
    const s = computeRegionScore('red-sea', [a, b, x], [evalOf('r.a', 'TRIGGERED'), evalOf('r.b', 'UNKNOWN'), evalOf('r.x', 'TRIGGERED')], NOW);
    expect(s.coverage).toBe(0.5);
    expect(s.contributions.map((x) => x.indicatorId)).toEqual(['r.a']);
  });

  it('maps bands at the documented boundaries', () => {
    expect([0, 19, 20, 39, 40, 59, 60, 79, 80, 100].map(bandFor)).toEqual([
      'BASELINE', 'BASELINE', 'INCREASED', 'INCREASED', 'ELEVATED', 'ELEVATED', 'SIGNIFICANT', 'SIGNIFICANT', 'EXCEPTIONAL', 'EXCEPTIONAL',
    ]);
  });

  it('computes 24 h change only from a real comparable point', () => {
    let hist = appendScoreHistory([], [{ regionId: 'red-sea', score: 10 } as never], NOW - 24 * H);
    hist = appendScoreHistory(hist, [{ regionId: 'red-sea', score: 15 } as never], NOW - H);
    expect(scoreDelta24h(hist, 'red-sea', 30, NOW)).toBe(20);
    expect(scoreDelta24h(hist, 'red-sea', 30, NOW + 10 * H)).toBeNull();
    expect(scoreDelta24h(hist, 'red-sea', null, NOW)).toBeNull();
  });
});

describe('catalog semantics', () => {
  it('non-routine CISA indicator ignores KEV announcements (no double-counted evidence) and guidance', () => {
    const def = getIndicator('global-cyber.cisa-nonroutine')!;
    const cisa = (title: string, subtype: string) => ev({ sourceId: 'cisa-advisories', title, metadata: { subtype, routine: false } });
    expect(matches(def.match, cisa('Critical Java Vulnerability Requires Immediate Patching', 'alert'))).toBe(true);
    expect(matches(def.match, cisa('CISA Adds Four Known Exploited Vulnerabilities to Catalog', 'alert'))).toBe(false); // legacy record
    expect(matches(def.match, cisa('CISA Adds One Known Exploited Vulnerability to Catalog', 'kev-announcement'))).toBe(false);
    expect(matches(def.match, cisa('Post-Quantum Questions to Ask Your Vendors', 'guidance'))).toBe(false);
    expect(matches(def.match, cisa('Joint advisory: actor TTPs', 'joint-advisory'))).toBe(true);
  });
});
