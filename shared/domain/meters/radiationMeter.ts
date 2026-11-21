import { NETWORK_LABEL, ratioOf } from '../radiation.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { evidenceOf, levelFromScore, meter, newest, plural, within } from './util.ts';

const RAD_SOURCES = new Set(['bfs-odl', 'stuk-radiation', 'epa-radnet']);

/**
 * Radiation (Phase 18), global: stations of the German (BfS), Finnish (STUK) and US (EPA RadNet)
 * networks against their own usual level.
 *  - a high station (≥ 0.5 µSv/h and ≥ 0.3 above usual): 4 each;
 *  - an alerting cluster (3+ raised stations within 100 km, or a raised RadNet monitor): 3 each;
 *  - other raised stations: 0.5 each (max 1) — usually rain washing radon products down.
 * Score → level: 1 LOW, 2 GUARDED, 4 ELEVATED, 6 HIGH. Withheld while usual levels build.
 */
export function radiationMeter(input: MeterInput): Meter {
  const rad = input.radiation;
  const base = { id: 'radiation', kind: 'radiation' as const, family: 'topic' as const, name: 'Radiation (Germany, Finland, US)', regionId: null };
  if (!rad || !rad.networks.length) {
    return meter({ ...base, level: null, label: 'NO DATA', value: null, reading: 'No radiation network has been read yet.', components: [], evidence: [], asOf: null, baseline: 'none', notes: [] });
  }
  const high = rad.flagged.filter((s) => s.status === 'high');
  const alerts = rad.clusters.filter((c) => c.alert);
  const loose = rad.clusters.filter((c) => !c.alert).reduce((a, c) => a + c.stations.length, 0);
  const score = high.length * 4 + alerts.length * 3 + Math.min(1, loose * 0.5);
  const building = rad.networks.every((n) => n.withBaseline < n.stations / 2);
  const components: MeterComponent[] = rad.networks.map((n) => {
    const raised = rad.flagged.filter((s) => s.network === n.network);
    return {
      label: `${NETWORK_LABEL[n.network]}: ${n.stations} stations${n.median !== null ? `, median ${n.median.toFixed(3)} µSv/h` : ''}`,
      value: raised.length ? `${raised.length} above usual (max ${raised[0].value.toFixed(3)}${ratioOf(raised[0]) ? `, ${ratioOf(raised[0])}×` : ''})` : n.withBaseline < n.stations / 2 ? `usual levels building (${n.withBaseline}/${n.stations})` : 'all usual',
      active: raised.length > 0,
    };
  });
  const records = input.events.filter((e) => RAD_SOURCES.has(e.sourceId) && within(e, input.now, 24));
  const reading = high.length
    ? `${plural(high.length, 'station')} at a high level (${high.map((s) => `${s.name}, ${s.value.toFixed(3)} µSv/h`).join('; ')}).`
    : alerts.length
      ? `${plural(alerts.length, 'group')} of stations above their usual level (${alerts.map((c) => `${NETWORK_LABEL[c.network]} near ${c.stations[0].name}`).join('; ')}).`
      : loose
        ? `${plural(loose, 'station')} briefly above usual, not in a group — most often rain.`
        : 'All stations at their usual level.';
  return meter({
    ...base,
    level: building && !high.length ? null : levelFromScore(score, [1, 2, 4, 6]),
    label: building && !high.length ? 'BUILDING BASELINE' : undefined,
    value: score,
    reading,
    components,
    evidence: evidenceOf(records, () => 'station group above usual'),
    asOf: newest(records) ?? rad.networks.map((n) => n.fetchedAt).sort().pop() ?? null,
    baseline: building ? 'building' : 'ok',
    notes: [
      'Each station is compared with its own usual level (a running average of its normal readings). Rain raises readings for a few hours by washing natural radon products down, so single stations count for little.',
      'US: 16 EPA RadNet monitors, read two per run (each about every four hours). Germany and Finland are not watch regions; they are early warning for a release in Eastern Europe.',
    ],
  });
}
