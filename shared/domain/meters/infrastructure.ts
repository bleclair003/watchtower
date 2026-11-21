import { getRegion } from '../regions.ts';
import { INFRA_LABEL } from '../infrastructure.ts';
import { siteScore } from '../infraProximity.ts';
import type { MeterInput } from './input.ts';
import type { Meter } from './types.ts';
import { levelFromScore, meter, plural } from './util.ts';

/**
 * Infrastructure proximity (per region): critical sites with records near or naming them in 72 h.
 * Points per site: nuclear site with a fire or military record nearby 3; other site 1; named in a
 * strike headline 2 (nuclear 3); named otherwise 0.5; +1 when both near and struck.
 */
export function infrastructureMeter(input: MeterInput, regionId: string): Meter {
  const snap = input.infrastructure;
  const flagged = (snap?.flagged ?? []).filter((f) => f.regionIds.includes(regionId));
  const score = flagged.reduce((s, f) => s + siteScore(f), 0);
  const short = getRegion(regionId)?.shortCode ?? regionId;
  return meter({
    id: `infrastructure.${regionId}`,
    kind: 'infrastructure',
    family: 'topic',
    name: `${short} infrastructure proximity`,
    regionId,
    level: snap ? levelFromScore(score, [0.5, 1, 3, 6]) : null,
    value: snap ? score : null,
    reading: !snap
      ? 'Infrastructure check not run yet.'
      : flagged.length
        ? `${plural(flagged.length, 'site')} with records near or naming them in 72 h: ${flagged.slice(0, 3).map((f) => f.name).join(', ')}${flagged.length > 3 ? '…' : ''}.`
        : `None of the region's power plants, nuclear sites, refineries, dams or ports has a record near or naming it in 72 h.`,
    components: flagged.slice(0, 6).map((f) => ({
      label: `${f.name} (${INFRA_LABEL[f.type].toLowerCase()}, ${f.country})`,
      value: [f.near ? `${f.near} near` : '', f.named ? `${f.named} named` : ''].filter(Boolean).join(', '),
      active: siteScore(f) >= 1,
    })),
    evidence: flagged.flatMap((f) => f.matches.slice(0, 1).map((m) => ({ title: m.title, url: m.url, at: m.at, why: `${f.name}: ${m.how === 'near' ? `${m.km} km away` : 'names it'}${m.kind === 'fire' ? ' (fire detection)' : m.kind === 'strike' ? ' (strike report)' : ''}` }))).slice(0, 5),
    asOf: snap?.computedAt ?? null,
    baseline: 'none',
    notes: [
      'Sites: WRI Global Power Plant Database (500 MW+ and all nuclear; data to 2021) and Wikidata (nuclear plants, refineries; dams and ports with an English Wikipedia article). Some major sites are missing (e.g. Abqaiq, Kharg Island).',
      'Near = a new fire cluster or an exactly located military record within 10 km of a nuclear plant or 5 km of other sites. A fire near an industrial site can be routine (flares, field burning).',
    ],
  });
}
