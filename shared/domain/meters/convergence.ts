import { getRegion } from '../regions.ts';
import type { AnomalySignal } from '../anomaly.ts';
import { getIndicator } from '../indicators/catalog.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterLevel } from './types.ts';
import { meter, plural } from './util.ts';

/** Indicator kinds that measure the same thing as a meter share its group, so one movement counts once. */
const SAME_AS: Record<string, string> = {
  airlift: 'aircraft',
  'strategic-air': 'aircraft',
  'media-conflict-reporting': 'news',
  'connectivity-drop': 'volume',
  'kev-surge': 'cyber',
};
const groupOf = (indicatorId: string) => {
  const kind = indicatorId.split('.').slice(1).join('.') || indicatorId;
  return SAME_AS[kind] ?? `indicator:${kind}`;
};

/**
 * Unusual readings (Phase 24): how many independent measurements in a region are unusual at the same
 * time — spikes, drops or steady trends from the meters, and indicators whose count is 2+ typical
 * spreads above usual. One thing moving is common; several unrelated things moving together is rarer and
 * worth a look. Signals are grouped (e.g. all news-based ones count once) so one story reported many
 * ways does not count many times. 1 group LOW, 2 GUARDED, 3 ELEVATED, 4+ HIGH.
 */
export function convergence(input: MeterInput, regionId: string, meters: Meter[]): Meter {
  const own = meters.filter((m) => m.regionId === regionId && m.kind !== 'convergence');
  const fromMeters: AnomalySignal[] = own.flatMap((m) => m.signals ?? []);
  const evals = (input.indicatorEvaluations ?? []).filter((e) => e.regionId === regionId && e.baseline.method === 'robust');
  const fromIndicators: AnomalySignal[] = evals
    .filter((e) => (e.baseline.score ?? 0) >= 2)
    .map((e) => {
      const def = getIndicator(e.indicatorId);
      return { label: def?.name ?? e.indicatorId, group: groupOf(e.indicatorId), kind: 'spike' as const, score: e.baseline.score! };
    });
  const signals = [...fromMeters, ...fromIndicators].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const groups = [...new Set(signals.map((s) => s.group))];
  // Detectors in the region that know their usual level (otherwise nothing could be flagged).
  const scoredMeters = own.filter((m) => m.baseline === 'ok' && m.signals !== undefined).length;
  const ready = scoredMeters + evals.length > 0;
  const level: MeterLevel = !ready ? null : (Math.min(4, groups.length) as 0 | 1 | 2 | 3 | 4);
  const short = getRegion(regionId)?.shortCode ?? regionId;
  const word = (k: AnomalySignal['kind']) => (k === 'spike' ? 'unusually high' : k === 'drop' ? 'unusually low' : k === 'rising' ? 'rising steadily' : 'falling steadily');
  return meter({
    id: `convergence.${regionId}`,
    kind: 'convergence',
    family: 'region',
    name: `${short} unusual readings`,
    regionId,
    level,
    label: !ready ? 'BUILDING BASELINE' : groups.length ? `${groups.length} UNUSUAL` : 'ALL NORMAL',
    value: ready ? groups.length : null,
    reading: !ready
      ? 'No detector in this region knows its usual level yet, so nothing can be called unusual.'
      : groups.length
        ? `${plural(groups.length, 'independent measurement')} unusual at once: ${signals.slice(0, 3).map((s) => `${s.label} ${word(s.kind)}`).join('; ')}.`
        : `All ${plural(scoredMeters + evals.length, 'scored detector')} within their normal range.`,
    components: [
      ...signals.slice(0, 8).map((s) => ({ label: s.label, value: `${word(s.kind)} (${s.kind === 'rising' || s.kind === 'falling' ? 'trend score' : 'score'} ${s.score > 0 ? '+' : ''}${s.score})`, active: true })),
      { label: 'Detectors that know their usual level', value: `${scoredMeters} meters, ${evals.length} indicators`, active: false },
    ],
    evidence: [],
    asOf: input.now ? new Date(input.now).toISOString() : null,
    baseline: ready ? 'ok' : 'building',
    notes: [
      'Score = distance from the usual level in typical spreads (median and median absolute deviation of earlier periods); 2+ is unusual, 3+ very unusual. Trends use the Mann–Kendall test at 95%.',
      'Counts independent kinds of measurement, not how alarming each is. Unusual is not the same as dangerous: holidays, outages at a source or one big news story can all move readings.',
    ],
  });
}
