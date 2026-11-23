import { describe, expect, it } from 'vitest';
import { buildScorecard, pct, validateFeedback, validateMissed, MIN_REVIEWED, type MissedIncident } from './scorecard.ts';
import type { AlertRecord, AlertSeverity, FeedbackVerdict } from './types.ts';
import type { CollectionRun } from '../types.ts';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const H = 3_600_000;
let n = 0;
const alert = (p: { rule?: string; v?: number; sev?: AlertSeverity; verdict?: FeedbackVerdict | null; hoursAgo?: number } = {}): AlertRecord => ({
  id: `a${++n}`,
  ruleId: p.rule ?? 'r1',
  ruleName: `Rule ${p.rule ?? 'r1'}`,
  ruleVersion: p.v ?? 1,
  severity: p.sev ?? 'ADVISORY',
  title: 'Invented alert',
  body: '',
  regionIds: [],
  url: '',
  evidenceEventIds: [],
  dedupeKey: `k${n}`,
  createdAt: new Date(NOW - (p.hoursAgo ?? 1) * H).toISOString(),
  acknowledged: false,
  acknowledgedAt: null,
  dismissed: false,
  dismissedAt: null,
  delivery: { discord: 'sent', at: null, error: null },
  feedback: p.verdict ? { verdict: p.verdict, note: '', at: new Date(NOW).toISOString() } : null,
});
const missed = (p: Partial<MissedIncident> = {}): MissedIncident => ({
  id: 'm1',
  title: 'Invented incident',
  occurredAt: '2026-11-20T08:00Z',
  kind: 'missed',
  lateHours: null,
  regionIds: ['red-sea'],
  category: 'maritime',
  url: '',
  note: '',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
  version: 1,
  ...p,
});
const run = (hoursAgo: number, errors: string[] = [], p: Partial<CollectionRun> = {}): CollectionRun => ({
  id: `run${hoursAgo}`,
  startedAt: new Date(NOW - hoursAgo * H).toISOString(),
  finishedAt: null,
  trigger: 'schedule',
  recordsFetched: 0,
  recordsImported: 0,
  recordsRejected: 0,
  duplicatesSuppressed: 0,
  errors: errors.map((sourceId) => ({ sourceId, message: 'x' })),
  ...p,
});

describe('alert scorecard', () => {
  it('counts verdicts, useful and false-positive shares, and only alerts inside the window', () => {
    const sc = buildScorecard({
      now: NOW,
      windowDays: 30,
      alerts: [
        alert({ verdict: 'useful' }),
        alert({ verdict: 'useful', sev: 'CRITICAL' }),
        alert({ verdict: 'false-positive', sev: 'WARNING' }),
        alert({ verdict: 'irrelevant' }),
        alert(),
        alert({ verdict: 'useful', hoursAgo: 31 * 24 }), // outside the window
      ],
      missed: [],
      runs: null,
    });
    expect(sc.alerts).toBe(5);
    expect(sc.reviewed).toEqual({ n: 4, of: 5, share: 0.8 });
    expect(sc.verdicts).toEqual({ useful: 2, irrelevant: 1, 'false-positive': 1, miscategorised: 0 });
    expect(sc.useful.share).toBe(0.5);
    expect(sc.falsePositive).toEqual({ n: 1, of: 4, share: 0.25 });
    expect(sc.highUseful).toEqual({ n: 1, of: 2, share: 0.5 });
    expect(sc.bySeverity.map((s) => [s.severity, s.reviewed])).toEqual([['CRITICAL', 1], ['WARNING', 1], ['ADVISORY', 2]]);
    expect(sc.enoughReviews).toBe(4 >= MIN_REVIEWED);
    expect(sc.runs).toBeNull();
    expect(pct(sc.useful)).toBe('50%');
    expect(pct({ n: 0, of: 0, share: null })).toBe('—');
  });

  it('scores each rule, lists the versions behind its alerts and flags noisy rules first', () => {
    const alerts = [
      ...['useful', 'irrelevant', 'irrelevant', 'irrelevant', 'false-positive', 'irrelevant'].map((v, i) =>
        alert({ rule: 'noisy', v: i < 3 ? 1 : 2, verdict: v as FeedbackVerdict }),
      ),
      ...Array.from({ length: 8 }, () => alert({ rule: 'busy', verdict: 'useful' })),
      alert({ rule: 'quiet', verdict: 'irrelevant' }),
    ];
    const sc = buildScorecard({ now: NOW, windowDays: 30, alerts, missed: [], runs: null });
    expect(sc.rules.map((r) => [r.ruleId, r.noisy])).toEqual([['noisy', true], ['busy', false], ['quiet', false]]);
    expect(sc.rules[0].versions).toEqual([1, 2]);
    expect(sc.rules[0].useful).toEqual({ n: 1, of: 6, share: 1 / 6 });
    // One irrelevant review is too few to call a rule noisy.
    expect(sc.rules[2].noisy).toBe(false);
  });

  it('summarises missed and late incidents by region and category, with the median lateness', () => {
    const sc = buildScorecard({
      now: NOW,
      windowDays: 30,
      alerts: [],
      missed: [
        missed(),
        missed({ id: 'm2', kind: 'late', lateHours: 4, regionIds: ['red-sea', 'middle-east'], category: 'aviation' }),
        missed({ id: 'm3', kind: 'late', lateHours: 10, regionIds: [] }),
        missed({ id: 'm4', occurredAt: '2026-09-01T00:00Z' }), // outside
      ],
      runs: null,
    });
    expect(sc.missed).toMatchObject({ total: 3, missed: 1, late: 2, medianLateHours: 7 });
    expect(sc.missed.byRegion).toEqual([
      { regionId: 'red-sea', count: 2 },
      { regionId: 'middle-east', count: 1 },
      { regionId: 'none', count: 1 },
    ]);
    expect(sc.missed.byCategory[0]).toEqual({ category: 'maritime', count: 2 });
  });

  it('measures collector runs: clean share and the sources that failed most, ignoring local and evaluate-only runs', () => {
    const runs = [run(1), run(2, ['ais']), run(3, ['ais', 'ais', 'nga']), run(4), run(5, [], { trigger: 'local', errors: [{ sourceId: 'x', message: 'x' }] }), run(6, [], { mode: 'evaluate-only' }), run(24 * 8, ['old'])];
    const sc = buildScorecard({ now: NOW, windowDays: 30, alerts: [], missed: [], runs, runDays: 7 });
    expect(sc.runs).toEqual({ days: 7, count: 4, expected: 168, clean: { n: 2, of: 4, share: 0.5 }, failingSources: [{ sourceId: 'ais', runs: 2 }, { sourceId: 'nga', runs: 1 }] });
  });
});

describe('feedback and missed-incident validation', () => {
  it('accepts a known verdict with a short note', () => {
    expect(validateFeedback({ verdict: 'useful', note: '', at: '2026-11-23T12:00:00.000Z' })).toEqual([]);
    expect(validateFeedback({ verdict: 'great' as FeedbackVerdict, note: 'x'.repeat(501), at: 'yesterday' })).toHaveLength(3);
  });

  it('checks a missed incident before it is saved', () => {
    expect(validateMissed(missed(), NOW)).toEqual([]);
    expect(validateMissed(missed({ kind: 'late', lateHours: 2.5 }), NOW)).toEqual([]);
    expect(validateMissed(missed({ kind: 'late', lateHours: null }), NOW)).toHaveLength(1);
    expect(validateMissed(missed({ lateHours: 3 }), NOW)).toHaveLength(1);
    expect(validateMissed(missed({ title: ' ' }), NOW)).toHaveLength(1);
    expect(validateMissed(missed({ occurredAt: '2026-12-25T00:00Z' }), NOW)).toEqual(['When it happened is in the future.']);
    expect(validateMissed(missed({ url: 'javascript:alert(1)' }), NOW)).toHaveLength(1);
    expect(validateMissed(missed({ regionIds: ['atlantis'] }), NOW)).toEqual(['Unknown region.']);
  });
});
