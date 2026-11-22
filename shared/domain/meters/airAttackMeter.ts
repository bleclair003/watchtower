import { interceptRate } from '../airAttacks.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterLevel } from './types.ts';
import { meter } from './util.ts';
import { compare, describe, signalsOf, trendOf } from '../anomaly.ts';

const MIN_NIGHTS = 7;

/**
 * Air attacks on Ukraine (Phase 22; scored as in Phase 24): last night's drones and missiles (Ukrainian
 * Air Force) against the previous 14 nights, in typical spreads from their median — 1 LOW, 1.5 GUARDED,
 * 2 ELEVATED, 3 HIGH — and a large missile salvo on its own: 40+ missiles ELEVATED, 80+ HIGH. A steady
 * rise over the last 10 nights lifts it to at least GUARDED. Ukraine's figures (one side).
 */
export function airAttackMeter(input: MeterInput): Meter {
  const base = { id: 'air-attacks.eastern-europe', kind: 'air-attacks' as const, family: 'topic' as const, name: 'Air attacks on Ukraine', regionId: 'eastern-europe' };
  const nights = input.ukraineFront?.air ?? [];
  const last = nights[0];
  if (!last) return meter({ ...base, level: null, label: 'NO DATA', value: null, reading: 'No Air Force report read yet.', components: [], evidence: [], asOf: null, baseline: 'none', notes: [] });
  const size = (r: typeof last) => (r.drones ?? 0) + (r.missiles ?? 0);
  const prior = nights.slice(1, 15);
  const mean = prior.length ? prior.reduce((a, r) => a + size(r), 0) / prior.length : null;
  const ratio = mean ? Math.round((size(last) / mean) * 100) / 100 : null;
  const salvo: MeterLevel = (last.missiles ?? 0) >= 80 ? 4 : (last.missiles ?? 0) >= 40 ? 3 : 0;
  const building = prior.length < MIN_NIGHTS;
  const a = compare(size(last), prior.map(size), { kind: 'measure', minSamples: MIN_NIGHTS });
  const trend = trendOf(nights.slice(0, 10).map(size).reverse());
  const s = a.score ?? 0;
  const fromRatio = building ? 0 : Math.max(s >= 3 ? 4 : s >= 2 ? 3 : s >= 1.5 ? 2 : s >= 1 ? 1 : 0, trend.direction === 'rising' ? 2 : 0);
  const level = Math.max(fromRatio, salvo) as Exclude<MeterLevel, null>;
  const rate = interceptRate(last);
  return meter({
    ...base,
    level: building && !salvo ? null : level,
    label: building && !salvo ? 'BUILDING BASELINE' : undefined,
    value: a.score ?? ratio,
    reading: `Night to ${last.day}: ${last.drones ?? '?'} drones and ${last.missiles ?? 0} missiles${a.status === 'ok' ? ` against a usual ${Math.round(a.centre!)} (median of ${prior.length} nights; ${describe(a)})` : mean !== null ? ` against a ${prior.length}-night mean of ${Math.round(mean)}` : ''}${rate !== null ? `; ${Math.round(rate * 100)}% shot down or suppressed` : ''}.`,
    components: [
      { label: 'Drones launched', value: String(last.drones ?? '—'), active: false },
      { label: 'Missiles launched (ballistic)', value: `${last.missiles ?? '—'}${last.ballistic ? ` (${last.ballistic})` : ''}`, active: salvo > 0, note: '40+ in a night raises the meter on its own' },
      { label: `Mean of the ${prior.length} nights before`, value: mean === null ? '—' : String(Math.round(mean)), active: fromRatio > 0 },
      { label: 'Trend over the last 10 nights', value: trend.status === 'ok' ? `${trend.direction}${trend.slope ? ` (${trend.slope > 0 ? '+' : ''}${trend.slope} a night)` : ''}` : 'needs 5 nights', active: trend.direction === 'rising' || trend.direction === 'falling', note: 'Mann–Kendall test, 95%' },
      { label: 'Shot down or suppressed', value: rate === null ? '—' : `${Math.round(rate * 100)}%`, active: false },
      { label: 'Locations hit', value: last.hitLocations === null ? '—' : String(last.hitLocations), active: false },
    ],
    evidence: [{ title: `Air Force report, night to ${last.day}`, url: last.url, at: `${last.day}T06:00:00.000Z`, why: 'source report' }],
    asOf: `${last.day}T06:00:00.000Z`,
    baseline: building ? 'building' : 'ok',
    signals: signalsOf('Drones and missiles launched at Ukraine (nightly)', 'air-attacks', a, trend),
    notes: ['Ukrainian Air Force figures (one side), read from Ukrinform’s English reports and parsed from text; a night is counted once its morning report appears.'],
  });
}
