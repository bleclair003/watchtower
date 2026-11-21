import type { IntelligenceEvent } from '../types.ts';
import { getRegion } from '../regions.ts';
import { isNews } from '../changes.ts';
import { US_LEVEL_STEPS, isPowerCutInternetOutage, isPowerHeadline } from '../powerOutages.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { evidenceOf, inRegion, levelFromScore, meta, meter, newest, plural, within } from './util.ts';

const fmt = (n: number) => n.toLocaleString('en-US');
/** A US outage reading older than this is not used. */
const ODIN_MAX_AGE_H = 3;
const OUTAGE_FEEDS = new Set(['cloudflare-radar-outages', 'ioda-outages', 'odin-power-outages']);

/**
 * Power outages (Phase 16), per region:
 *  - internet outages Cloudflare attributes to a power cut, started in the last 72 hours or still
 *    ongoing (started within 14 days): nationwide 3 each, regional 1 (max 2);
 *  - news headlines about power cuts, blackouts or attacks on the power system (72 h): 1 publisher 1,
 *    2–3 publishers 2, 4+ publishers 3;
 *  - United States only: customers without power from ODIN; the largest state sets a level of its own
 *    (5k LOW, 25k GUARDED, 100k ELEVATED, 500k HIGH) and the meter shows the higher of the two.
 * Score → level: 1 LOW, 2 GUARDED, 4 ELEVATED, 6 HIGH.
 */
export function powerOutageMeter(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const short = getRegion(regionId)?.shortCode ?? regionId;
  const r = events.filter((e) => inRegion(e, regionId));
  const cuts = r.filter((e) => isPowerCutInternetOutage(e) && (within(e, now, 72) || (!meta(e, 'endedAt') && within(e, now, 14 * 24))));
  const nationwide = cuts.filter((e) => String(meta(e, 'outageType') ?? '').toUpperCase() === 'NATIONWIDE');
  // Headlines only: the outage feeds' own records (whose titles say "power outage") are counted above.
  const heads = r.filter((e) => !OUTAGE_FEEDS.has(e.sourceId) && isNews(e) && within(e, now, 72) && isPowerHeadline(e.title));
  const publishers = new Set(heads.map((e) => e.sourceId)).size;
  const headScore = publishers >= 4 ? 3 : publishers >= 2 ? 2 : publishers;
  const score = nationwide.length * 3 + Math.min(2, cuts.length - nationwide.length) + headScore;
  let level = levelFromScore(score, [1, 2, 4, 6]);

  const components: MeterComponent[] = [
    { label: 'Internet outages from power cuts (72 h or ongoing)', value: nationwide.length ? `${cuts.length} (${nationwide.length} nationwide)` : String(cuts.length), active: cuts.length > 0 },
    { label: 'Headlines about power cuts (72 h)', value: heads.length ? `${heads.length} from ${plural(publishers, 'publisher')}` : '0', active: heads.length > 0 },
  ];
  const notes = ['Outside the US there is no free live outage feed: this meter reads internet outages that Cloudflare attributes to power cuts and news headlines.'];
  let usReading: string | null = null;
  const odinRecords: IntelligenceEvent[] = [];
  if (regionId === 'united-states') {
    const odin = input.powerOutages;
    const fresh = odin && now - Date.parse(odin.fetchedAt) <= ODIN_MAX_AGE_H * 3_600_000 ? odin : null;
    if (fresh) {
      const top = fresh.states[0];
      const odinLevel = top ? levelFromScore(top.out, US_LEVEL_STEPS) : 0;
      if (odinLevel > level) level = odinLevel;
      usReading = top ? `${fmt(fresh.totalOut)} US customers without power at reporting utilities; most in ${top.name} (${fmt(top.out)}).` : 'No customers without power at the utilities reporting to ODIN.';
      components.push({
        label: `Customers without power (ODIN, ${fresh.utilitiesReporting} utilities)`,
        value: top ? `${fmt(fresh.totalOut)} · ${top.name} ${fmt(top.out)}` : '0',
        active: odinLevel > 0,
        note: 'largest state sets its own level: 5k / 25k / 100k / 500k',
      });
      odinRecords.push(...r.filter((e) => e.sourceId === 'odin-power-outages' && within(e, now, 24)));
    } else {
      components.push({ label: 'Customers without power (ODIN)', value: 'no recent reading', active: false });
    }
    notes.push('US counts come only from utilities that report to ODIN (DOE / Oak Ridge National Laboratory), so they are a floor, not the national total. ODIN gives no causes.');
  }

  const evidence = evidenceOf([...odinRecords, ...cuts, ...heads], (e) => (e.sourceId === 'odin-power-outages' ? 'ODIN state total' : isPowerCutInternetOutage(e) ? 'internet outage from a power cut' : 'headline'));
  const reading =
    usReading ??
    (nationwide.length
      ? `${plural(nationwide.length, 'nationwide internet outage')} caused by power cuts${heads.length ? `, and ${plural(heads.length, 'headline')} about power cuts` : ''}.`
      : cuts.length || heads.length
        ? `${plural(cuts.length, 'internet outage')} from power cuts and ${plural(heads.length, 'headline')} about power cuts in 72 h.`
        : 'No power cuts in the sources.');
  return meter({
    id: `power.${regionId}`,
    kind: 'power',
    family: 'topic',
    name: `${short} power outages`,
    regionId,
    level,
    value: level,
    reading,
    components,
    evidence,
    asOf: newest([...odinRecords, ...cuts, ...heads]) ?? (regionId === 'united-states' ? (input.powerOutages?.fetchedAt ?? null) : null),
    baseline: 'none',
    notes,
  });
}
