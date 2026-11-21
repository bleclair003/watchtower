import { getRegion } from '../regions.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { levelFromScore, meter, plural } from './util.ts';

/**
 * People and groups (per region): the most-mentioned tracked actors over 72 hours, which are rising
 * against their usual level (after 14 days), and new names first seen in the last 7 days.
 * Points: 2 per rising actor, 0.5 per new name (max 3 names) — 0.5 / 2 / 4 / 6.
 */
export function actorsMeter(input: MeterInput, regionId: string): Meter {
  const snap = input.actors;
  const actors = (snap?.actors ?? []).filter((x) => x.regionIds.includes(regionId) && x.last7d > 0);
  const names = (snap?.newNames ?? []).filter((n) => n.regionIds.includes(regionId));
  const rising = actors.filter((x) => x.rising);
  const score = rising.length * 2 + Math.min(3, names.length) * 0.5;
  const building = actors.every((x) => x.usual72h === null);
  const components: MeterComponent[] = [
    ...actors.slice(0, 6).map((x) => ({
      label: x.name,
      value: `${x.last72h} in 72 h${x.usual72h !== null ? ` (usual ${x.usual72h})` : ''} · ${x.last7d} in 7 d`,
      active: x.rising,
      note: x.rising ? 'rising' : undefined,
    })),
    ...names.slice(0, 4).map((n) => ({ label: `New name: ${n.name}`, value: `${n.mentions} headlines, ${plural(n.publishers, 'publisher')}`, active: true, note: `first seen ${n.firstSeen.slice(0, 10)}` })),
  ];
  const short = getRegion(regionId)?.shortCode ?? regionId;
  return meter({
    id: `actors.${regionId}`,
    kind: 'actors',
    family: 'topic',
    name: `${short} people and groups`,
    regionId,
    level: snap ? levelFromScore(score, [0.5, 2, 4, 6]) : null,
    value: snap ? score : null,
    label: snap ? (rising.length ? `${rising.length} RISING` : names.length ? `${names.length} NEW NAME${names.length > 1 ? 'S' : ''}` : actors.length ? `${actors.length} TRACKED` : 'NONE NAMED') : 'NO DATA',
    reading: !snap
      ? 'Not computed yet.'
      : `${actors.length ? `Most named in 72 h: ${actors.slice(0, 3).map((x) => `${x.name} (${x.last72h})`).join(', ')}.` : 'No tracked actor named in 7 days.'}${rising.length ? ` Rising: ${rising.map((x) => x.name).join(', ')}.` : ''}${names.length ? ` New names: ${names.slice(0, 3).map((n) => n.name).join(', ')}.` : ''}`,
    components,
    evidence: names.slice(0, 3).map((n) => ({ title: n.sample.title, url: n.sample.url, at: n.firstSeen, why: `new name: ${n.name}` })),
    asOf: snap?.computedAt ?? null,
    baseline: building ? 'building' : 'ok',
    notes: [
      'Tracked people and groups are a curated list (shared/domain/actors.ts). New names are capitalised word runs in sentence-case headlines (BBC, Al Jazeera, UN News, NPR, Defense News, Military Times), minus places, institutions and tracked actors, shown after 2 headlines: candidates, not identifications.',
    ],
  });
}
