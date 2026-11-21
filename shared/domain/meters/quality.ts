import { getRegion } from '../regions.ts';
import { INDICATOR_CATALOG } from '../indicators/catalog.ts';
import { computeHealth } from '../health.ts';
import { getSource } from '../sources.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent, MeterLevel } from './types.ts';
import { regionStories } from './region.ts';
import { DAY, meter, plural } from './util.ts';

const short = (r: string) => getRegion(r)?.shortCode ?? r;

// ---------------------------------------------------------------- 19. corroboration (per region)

/** Share of a region's stories over 72 hours confirmed by several publishers or an official source. */
export function corroboration(input: MeterInput, regionId: string): Meter {
  const { news, stories } = regionStories(input, regionId);
  const grouped = new Set(stories.flatMap((s) => s.memberIds));
  // Reports in no story are stories of one report from one publisher.
  const singles = news.filter((e) => !grouped.has(e.id)).length;
  const total = stories.length + singles;
  const multi = stories.filter((s) => s.corroboration === 'multi-source').length;
  const official = stories.filter((s) => s.corroboration === 'official').length;
  const share = total ? Math.round(((multi + official) / total) * 100) : null;
  return meter({
    id: `corroboration.${regionId}`,
    kind: 'corroboration',
    family: 'quality',
    name: `${short(regionId)} corroboration`,
    regionId,
    level: null,
    label: share === null ? 'NO STORIES' : `${share}% CORROBORATED`,
    value: share,
    reading: share === null ? 'No news stories in 72 hours.' : `${multi + official} of ${plural(total, 'story', 'stories')} confirmed by several publishers or an official source.${share < 30 ? ' Read single-source reports with care.' : ''}`,
    components: [
      { label: 'Stories (72 h)', value: String(total), note: 'a single report counts as a story of one' },
      { label: 'Several publishers', value: String(multi), active: multi > 0 },
      { label: 'Includes an official source', value: String(official), active: official > 0 },
      { label: 'Single publisher', value: String(total - multi - official) },
    ],
    evidence: [],
    asOf: stories.reduce<string | null>((m, s) => (!m || s.lastAt > m ? s.lastAt : m), null),
    baseline: 'none',
    notes: ['A story groups reports that share place and topic words; corroboration means several outlets, not independent confirmation of facts.'],
  });
}

// ---------------------------------------------------------------- 20. visibility (per region)

/** Known blind spots, stated so the meters are read with them in mind. */
export const KNOWN_GAPS: Record<string, string[]> = {
  'middle-east': ['No AIS coverage in the Gulf (aisstream has no receivers there).', 'ADS-B shows only aircraft that broadcast.'],
  'eastern-europe': ['ADS-B shows only aircraft that broadcast; Russian military aircraft rarely do.'],
  'taiwan-strait': ['No AIS coverage in the Taiwan Strait.', 'No UNHCR figures for Taiwan.', 'PLA aircraft do not broadcast ADS-B.'],
  'korean-peninsula': ['DPRK launches come from Yonhap headlines only.', 'No market rate for the North Korean won.'],
  'south-china-sea': ['No AIS coverage of the South China Sea.'],
  'red-sea': ['No AIS coverage in the Red Sea.', 'Somalia and Eritrea are thinly covered by the news sources.'],
  'united-states': ['US military aircraft over the US are mostly routine training.'],
  'global-cyber': ['Only public US government warnings (CISA) and outage monitors.'],
};

/** How much of a region WATCHTOWER can see now: relevant sources online, data lag, known gaps. */
export function visibility(input: MeterInput, regionId: string): Meter {
  const { now } = input;
  const ids = [...new Set(INDICATOR_CATALOG.filter((d) => d.regionId === regionId && !d.experimental).flatMap((d) => d.requiredSourceIds))];
  const rows = ids.map((id) => {
    const st = input.sourceStatus.find((s) => s.sourceId === id);
    const health = st ? computeHealth(st, getSource(id)?.pollIntervalMinutes ?? null, now) : 'NOT_CONFIGURED';
    return { id, name: getSource(id)?.name ?? id, health };
  });
  const online = rows.filter((r) => r.health === 'ONLINE').length;
  const share = rows.length ? Math.round((online / rows.length) * 100) : null;
  const lags: MeterComponent[] = [];
  if (input.fleet && ['middle-east', 'red-sea', 'taiwan-strait', 'south-china-sea', 'korean-peninsula', 'eastern-europe'].includes(regionId)) {
    lags.push({ label: 'USNI fleet tracker', value: `${Math.floor((now - Date.parse(`${input.fleet.asOf}T12:00:00Z`)) / DAY)} days old`, note: 'weekly' });
  }
  const straits = (input.chokepoints?.items ?? []).filter((c) => c.regionId === regionId);
  if (straits.length && input.chokepoints?.latestDate) lags.push({ label: 'Strait traffic (PortWatch)', value: `${Math.floor((now - Date.parse(`${input.chokepoints.latestDate}T12:00:00Z`)) / DAY)} days behind` });
  const down = rows.filter((r) => r.health !== 'ONLINE');
  const level: MeterLevel = share === null ? null : share >= 90 ? 0 : share >= 75 ? 1 : share >= 50 ? 2 : share >= 25 ? 3 : 4;
  return meter({
    id: `visibility.${regionId}`,
    kind: 'visibility',
    family: 'quality',
    name: `${short(regionId)} visibility`,
    regionId,
    level,
    label: share === null ? 'NO SOURCES' : `${share}% SOURCES ONLINE`,
    value: share,
    reading: share === null ? 'No sources mapped to this region.' : `${online} of ${rows.length} sources for this region online${down.length ? `; not online: ${down.slice(0, 4).map((r) => `${r.name} (${r.health.toLowerCase().replace('_', ' ')})`).join(', ')}${down.length > 4 ? '…' : ''}` : ''}.`,
    components: [
      { label: 'Sources online', value: `${online} / ${rows.length}`, active: online === rows.length },
      ...lags,
      ...(KNOWN_GAPS[regionId] ?? []).map((g): MeterComponent => ({ label: 'Known gap', value: g })),
    ],
    evidence: [],
    asOf: new Date(now).toISOString(),
    baseline: 'none',
    notes: ['Level here means blindness: QUIET = we see nearly everything, HIGH = most sources for the region are down. Sources are those the region’s indicators need.'],
  });
}
