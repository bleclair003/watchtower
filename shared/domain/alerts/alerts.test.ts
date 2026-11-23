// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../types.ts';
import type { IndicatorTransition, RegionScore } from '../indicators/types.ts';
import { evaluateRule, previewRule, validateAlertRule, type AlertContext } from './evaluate.ts';
import { CATALOG_VERSION } from '../indicators/catalog.ts';
import type { AlertRule } from './types.ts';

const NOW = Date.parse('2026-12-20T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

function ev(id: string, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  return {
    id, contentHash: `h-${id}`, dataOrigin: 'live', sourceId: 'state-travel-advisories', sourceName: 'State', sourceClass: 'official',
    sourceUrl: `https://travel.state.gov/${id}`, title: `Event ${id}`, summary: 'S', category: 'diplomatic', regionIds: ['red-sea'],
    countryCodes: ['YE'], publishedAt: iso(NOW - 3_600_000), collectedAt: iso(NOW), credibility: 'official',
    verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}

const rule = (p: Partial<AlertRule> = {}): AlertRule => ({
  id: 'r1', name: 'Red Sea advisories', enabled: true, severity: 'WARNING',
  trigger: { kind: 'event', match: { field: 'regionIds', op: 'contains', value: 'red-sea' } },
  notify: { discord: true }, cooldownMinutes: 60, version: 1, createdAt: iso(NOW - 86_400_000), updatedAt: iso(NOW - 86_400_000), ...p,
});

// By default the rule (created a day ago) has already seen a previous evaluation an hour ago.
const ctx = (p: Partial<AlertContext> = {}): AlertContext => ({
  now: NOW, newEvents: [], transitions: [], previousScores: [], currentScores: [], currentEvaluations: [], previousEvaluatedAt: iso(NOW - 3_600_000), ...p,
});

const score = (regionId: string, s: number | null): RegionScore => ({
  regionId, score: s, band: s === null ? null : s >= 40 ? 'ELEVATED' : 'BASELINE', coverage: 1, activeIndicators: 0,
  contributions: [{ indicatorId: 'x', name: 'Advisory raised', state: 'TRIGGERED', weight: 3, severity: 'high', raw: 6, applied: 6, capped: false }],
  evaluatedAt: iso(NOW),
});

describe('validateAlertRule', () => {
  it('accepts well-formed rules of each kind', () => {
    expect(validateAlertRule(rule())).toEqual([]);
    expect(validateAlertRule(rule({ trigger: { kind: 'indicator', indicatorIds: ['red-sea.advisory-raised'], states: ['TRIGGERED'] } }))).toEqual([]);
    expect(validateAlertRule(rule({ trigger: { kind: 'rai', regionId: 'red-sea', atLeast: 40 } }))).toEqual([]);
  });

  it('rejects malformed rules with specific reasons', () => {
    expect(validateAlertRule(rule({ name: '' }))[0]).toMatch(/name/);
    expect(validateAlertRule(rule({ severity: 'PANIC' as never }))[0]).toMatch(/severity/);
    expect(validateAlertRule(rule({ cooldownMinutes: -5 }))[0]).toMatch(/cooldown/);
    expect(validateAlertRule(rule({ trigger: { kind: 'event', match: { field: 'eval', op: 'eq', value: 1 } as never } }))[0]).toMatch(/unknown field/);
    expect(validateAlertRule(rule({ trigger: { kind: 'indicator', indicatorIds: ['nope'], states: ['TRIGGERED'] } }))[0]).toMatch(/unknown indicator/);
    expect(validateAlertRule(rule({ trigger: { kind: 'rai', regionId: 'atlantis', atLeast: 140 } }))).toHaveLength(2);
    expect(validateAlertRule(rule({ trigger: { kind: 'script', code: 'x' } as never }))[0]).toMatch(/unknown trigger/);
    expect(validateAlertRule(rule({ id: '../../etc' }))[0]).toMatch(/invalid id/);
  });
});

describe('event rules', () => {
  it('fire once per new matching event, with the source link and a content-based dedupe key', () => {
    const out = evaluateRule(rule(), ctx({ newEvents: [ev('a'), ev('b', { regionIds: ['korean-peninsula'] })] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Event a', url: 'https://travel.state.gov/a', dedupeKey: 'event:h-a', severity: 'WARNING', evidenceEventIds: ['a'], ruleVersion: 1, catalogVersion: CATALOG_VERSION });
  });

  it('ignore events collected before the rule existed, and disabled rules', () => {
    const r = rule({ createdAt: iso(NOW + 1000) });
    expect(evaluateRule(r, ctx({ newEvents: [ev('a')] }))).toEqual([]);
    expect(evaluateRule(rule({ enabled: false }), ctx({ newEvents: [ev('a')] }))).toEqual([]);
  });

  it('nothing new → nothing fires', () => {
    expect(evaluateRule(rule(), ctx())).toEqual([]);
  });
});

describe('indicator rules', () => {
  const tr = (to: IndicatorTransition['to'], from: IndicatorTransition['from'] = 'NORMAL'): IndicatorTransition => ({
    indicatorId: 'red-sea.advisory-raised', regionId: 'red-sea', from, to, at: iso(NOW), reason: '1 matching', evidenceEventIds: ['e1'], configVersion: 1,
  });
  const r = rule({ trigger: { kind: 'indicator', indicatorIds: ['red-sea.advisory-raised'], states: ['TRIGGERED'] } });

  it('fire on entry into a watched state only', () => {
    const out = evaluateRule(r, ctx({ transitions: [tr('TRIGGERED'), tr('ELEVATED')] }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('REDSEA travel advisory raised: NORMAL → TRIGGERED');
    expect(out[0].evidenceEventIds).toEqual(['e1']);
    expect(evaluateRule(r, ctx({ transitions: [tr('NORMAL', 'TRIGGERED')] }))).toEqual([]);
  });
});

describe('RAI rules', () => {
  const r = rule({ trigger: { kind: 'rai', regionId: 'red-sea', atLeast: 40 } });

  it('fire on upward crossing only', () => {
    expect(evaluateRule(r, ctx({ previousScores: [score('red-sea', 20)], currentScores: [score('red-sea', 45)] }))).toHaveLength(1);
    expect(evaluateRule(r, ctx({ previousScores: [score('red-sea', 45)], currentScores: [score('red-sea', 50)] }))).toEqual([]);
    expect(evaluateRule(r, ctx({ previousScores: [score('red-sea', 50)], currentScores: [score('red-sea', 30)] }))).toEqual([]);
  });

  it('never fire from an N/E score, and treat a first evaluation above threshold as a crossing', () => {
    expect(evaluateRule(r, ctx({ previousScores: [score('red-sea', 20)], currentScores: [score('red-sea', null)] }))).toEqual([]);
    const first = evaluateRule(r, ctx({ previousScores: [], currentScores: [score('red-sea', 60)] }));
    expect(first[0].title).toMatch(/RAI 60 .* crossed 40/);
    expect(first[0].body).toMatch(/not a probability/);
  });
});

describe('first look: rules created since the previous evaluation', () => {
  const fresh = { createdAt: iso(NOW - 600_000), updatedAt: iso(NOW - 600_000) };
  const evaluation = {
    indicatorId: 'red-sea.advisory-raised', regionId: 'red-sea', state: 'TRIGGERED' as const, reason: '1 matching', evaluatedAt: iso(NOW),
    configVersion: 1, matchedCount: 1, distinctSources: 1, elevatedAt: 1, triggeredAt: 1,
    baseline: { status: 'not-configured' as const, meanPerWindow: null, historyDays: 0 }, evidenceEventIds: ['e1'],
    lastTriggeredAt: iso(NOW - 7_200_000), stateSince: iso(NOW - 7_200_000),
  };

  it('an indicator already in a watched state alerts once, keyed to when the state began', () => {
    const r = rule({ ...fresh, trigger: { kind: 'indicator', indicatorIds: ['red-sea.advisory-raised'], states: ['TRIGGERED'] } });
    const out = evaluateRule(r, ctx({ currentEvaluations: [evaluation] }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('REDSEA travel advisory raised: TRIGGERED');
    expect(out[0].dedupeKey).toBe(`indicator:red-sea.advisory-raised:TRIGGERED:${iso(NOW - 7_200_000)}`);
    // The same state reported later as a "transition" would carry the same key → no duplicate.
  });

  it('an RAI already above threshold alerts once; an old rule needs a real crossing', () => {
    const r = rule({ ...fresh, trigger: { kind: 'rai', regionId: 'red-sea', atLeast: 40 } });
    expect(evaluateRule(r, ctx({ previousScores: [score('red-sea', 50)], currentScores: [score('red-sea', 50)] }))).toHaveLength(1);
    const old = rule({ trigger: { kind: 'rai', regionId: 'red-sea', atLeast: 40 } });
    expect(evaluateRule(old, ctx({ previousScores: [score('red-sea', 50)], currentScores: [score('red-sea', 50)] }))).toEqual([]);
  });
});

describe('previewRule (test mode)', () => {
  it('reports what would match without side effects', () => {
    const p = previewRule(rule(), { events: [ev('a'), ev('old', { publishedAt: iso(NOW - 30 * 86_400_000) })], evaluations: [], scores: [], now: NOW, lookbackHours: 168 });
    expect(p.matches).toEqual(['Event a']);
    expect(p.note).toMatch(/NEW event/);
  });
});
