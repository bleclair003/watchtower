import { REGULAR_DAY_SHARE, REGULAR_MIN_DAYS, sourceCadence } from '../quietSources.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { levelFromScore, meter, plural } from './util.ts';

/** Missing regulars (global): sources that normally publish daily and have gone quiet while still reachable. */
export function quietMeter(input: MeterInput): Meter {
  const all = sourceCadence(input.events, input.sourceStatus, input.now, input.historyStart);
  const regular = all.filter((s) => s.status === 'regular');
  const quiet = regular.filter((s) => s.quiet).sort((a, b) => (b.hoursSinceNew ?? 0) - (a.hoursSinceNew ?? 0));
  const building = all.length > 0 && all.every((s) => s.status === 'building');
  const components: MeterComponent[] = [
    ...quiet.map((s) => ({ label: s.name, value: `nothing new for ${s.hoursSinceNew} h`, active: true, note: `usually ${s.usualPerDay} a day; quiet after ${s.quietAfterHours} h` })),
    ...regular
      .filter((s) => !s.quiet)
      .sort((a, b) => b.usualPerDay - a.usualPerDay)
      .slice(0, 10)
      .map((s) => ({ label: s.name, value: `last new ${s.hoursSinceNew} h ago`, note: `usually ${s.usualPerDay} a day` })),
  ];
  return meter({
    id: 'quiet',
    kind: 'quiet',
    family: 'quality',
    name: 'Missing regulars',
    regionId: null,
    level: building ? null : levelFromScore(quiet.length, [1, 2, 3, 5]),
    label: building ? 'BUILDING' : quiet.length ? `${quiet.length} QUIET` : 'ALL POSTING',
    value: building ? null : quiet.length,
    reading: building
      ? `Which sources publish every day is learned from ${REGULAR_MIN_DAYS} days of history.`
      : quiet.length
        ? `${plural(quiet.length, 'source')} that normally ${quiet.length === 1 ? 'publishes' : 'publish'} every day ${quiet.length === 1 ? 'has' : 'have'} gone quiet while still reachable: ${quiet.map((s) => s.name).join(', ')}.`
        : `All ${plural(regular.length, 'daily source')} have published within their usual gap.`,
    components,
    evidence: [],
    asOf: new Date(input.now).toISOString(),
    baseline: building ? 'building' : 'ok',
    notes: [
      `Regular = new items on ${Math.round(REGULAR_DAY_SHARE * 100)}% of days or more. Quiet = nothing new for longer than 24 hours or three times its usual gap, whichever is longer, while the source still loads (failures are shown in source health).`,
      'A quiet official feed can mean a holiday, a website change or a deliberate silence; check the source.',
    ],
  });
}
