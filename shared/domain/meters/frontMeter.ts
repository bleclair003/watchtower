import { sectorName } from '../ukraineFront.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { meter } from './util.ts';
import { compare, describe, signalsOf, trendOf } from '../anomaly.ts';

const MIN_DAYS = 7;

/**
 * Ukraine front intensity (Phase 21; scored as in Phase 24): the latest full day's combat engagements
 * (Ukraine's General Staff) against the 14 days before it, in typical spreads from their median —
 * 1 LOW, 1.5 GUARDED, 2 ELEVATED, 3 HIGH. A steady rise over the last 10 days (trend test) lifts it to at
 * least GUARDED; an unusual drop is shown but never raises it. The war is intense every day: the meter
 * shows change, not the absolute level. Needs 7 earlier days.
 */
export function frontMeter(input: MeterInput): Meter {
  const base = { id: 'front.eastern-europe', kind: 'front' as const, family: 'topic' as const, name: 'Ukraine front intensity', regionId: 'eastern-europe' };
  const full = (input.ukraineFront?.reports ?? []).filter((r) => r.fullDay && r.total !== null);
  const latest = full[0];
  if (!latest) return meter({ ...base, level: null, label: 'NO DATA', value: null, reading: 'No General Staff report read yet.', components: [], evidence: [], asOf: null, baseline: 'none', notes: [] });
  const prior = full.slice(1, 15);
  const mean = prior.length ? prior.reduce((a, r) => a + (r.total ?? 0), 0) / prior.length : null;
  const ratio = mean ? Math.round(((latest.total ?? 0) / mean) * 100) / 100 : null;
  const building = prior.length < MIN_DAYS;
  const a = compare(latest.total ?? 0, prior.map((r) => r.total ?? 0), { kind: 'measure', minSamples: MIN_DAYS });
  const trend = trendOf(full.slice(0, 10).map((r) => r.total ?? 0).reverse());
  const s = a.score ?? 0;
  const fromScore = s >= 3 ? 4 : s >= 2 ? 3 : s >= 1.5 ? 2 : s >= 1 ? 1 : 0;
  const level = Math.max(fromScore, trend.direction === 'rising' ? 2 : 0) as 0 | 1 | 2 | 3 | 4;
  // Sector with the biggest rise against its own recent mean (at least 5 attacks).
  const rises = Object.entries(latest.sectors)
    .map(([s, n]) => {
      const vals = prior.map((r) => r.sectors[s] ?? 0);
      const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      return { s, n, m, r: m > 0 ? n / m : null };
    })
    .filter((x) => x.n >= 5 && x.r !== null && x.r >= 1.5)
    .sort((a, b) => (b.r ?? 0) - (a.r ?? 0));
  const top = Object.entries(latest.sectors).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const components: MeterComponent[] = [
    { label: `Combat engagements on ${latest.day}`, value: `${latest.total}${a.status === 'ok' ? ` (${describe(a)})` : ''}`, active: s >= 1.5 || a.direction === 'drop' },
    { label: `Mean of the ${prior.length} days before`, value: mean === null ? '—' : String(Math.round(mean)), active: false },
    { label: 'Trend over the last 10 days', value: trend.status === 'ok' ? `${trend.direction}${trend.slope ? ` (${trend.slope > 0 ? '+' : ''}${trend.slope} a day)` : ''}` : 'needs 5 days', active: trend.direction === 'rising' || trend.direction === 'falling', note: 'Mann–Kendall test, 95%' },
    { label: 'Busiest sectors', value: top.map(([s, n]) => `${sectorName(s)} ${n}`).join(', ') || '—', active: false },
    { label: 'Sectors well above their recent mean', value: rises.length ? rises.map((x) => `${sectorName(x.s)} ${x.n} (usual ${Math.round(x.m)})`).join(', ') : 'none', active: rises.length > 0 },
  ];
  return meter({
    ...base,
    level: building ? null : level,
    label: building ? 'BUILDING BASELINE' : undefined,
    value: a.score ?? ratio,
    reading: `${latest.total} combat engagements on ${latest.day}${mean !== null ? ` against a ${prior.length}-day mean of ${Math.round(mean)} (${ratio}×${a.status === 'ok' ? `; ${describe(a)}` : ''})` : ''}${top[0] ? `; most in ${sectorName(top[0][0])} (${top[0][1]})` : ''}.`,
    components,
    evidence: [{ title: `General Staff update for ${latest.day}`, url: latest.url, at: latest.asOf, why: 'source report' }],
    asOf: latest.asOf,
    baseline: building ? 'building' : 'ok',
    signals: signalsOf('Combat engagements in Ukraine (daily)', 'front', a, trend),
    notes: ['Ukraine’s General Staff figures (one side), read from Ukrinform’s English reports; per-sector counts are parsed from text and approximate. The war is intense every day: this meter shows change against the previous two weeks.'],
  });
}
