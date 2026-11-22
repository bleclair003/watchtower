import { sectorName } from '../ukraineFront.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { levelFromScore, meter } from './util.ts';

const MIN_DAYS = 7;

/**
 * Ukraine front intensity (Phase 21): the latest full day's combat engagements (Ukraine's General Staff)
 * against the mean of the 14 days before it — 1.1× LOW, 1.25× GUARDED, 1.5× ELEVATED, 2× HIGH. The war
 * is intense every day: the meter shows change, not the absolute level. Needs 7 earlier days.
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
    { label: `Combat engagements on ${latest.day}`, value: String(latest.total), active: (ratio ?? 0) >= 1.25 },
    { label: `Mean of the ${prior.length} days before`, value: mean === null ? '—' : String(Math.round(mean)), active: false },
    { label: 'Busiest sectors', value: top.map(([s, n]) => `${sectorName(s)} ${n}`).join(', ') || '—', active: false },
    { label: 'Sectors well above their recent mean', value: rises.length ? rises.map((x) => `${sectorName(x.s)} ${x.n} (usual ${Math.round(x.m)})`).join(', ') : 'none', active: rises.length > 0 },
  ];
  return meter({
    ...base,
    level: building ? null : levelFromScore(ratio ?? 0, [1.1, 1.25, 1.5, 2]),
    label: building ? 'BUILDING BASELINE' : undefined,
    value: ratio,
    reading: `${latest.total} combat engagements on ${latest.day}${mean !== null ? ` against a ${prior.length}-day mean of ${Math.round(mean)} (${ratio}×)` : ''}${top[0] ? `; most in ${sectorName(top[0][0])} (${top[0][1]})` : ''}.`,
    components,
    evidence: [{ title: `General Staff update for ${latest.day}`, url: latest.url, at: latest.asOf, why: 'source report' }],
    asOf: latest.asOf,
    baseline: building ? 'building' : 'ok',
    notes: ['Ukraine’s General Staff figures (one side), read from Ukrinform’s English reports; per-sector counts are parsed from text and approximate. The war is intense every day: this meter shows change against the previous two weeks.'],
  });
}
