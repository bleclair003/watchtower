import type { IntelligenceEvent } from '../types.ts';
import { getRegion } from '../regions.ts';
import { isNews } from '../changes.ts';
import { WIDESPREAD_GROUND_STOPS, isAirspaceHeadline, isFaaRecord, tfrActive } from '../faa.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { evidenceOf, inRegion, levelFromScore, meter, newest, plural, within } from './util.ts';

/** FAA notices that appeared within this many days count as new. */
const NEW_NOTICE_DAYS = 14;
const AIRPORT_MAX_AGE_H = 3;

/**
 * Airspace (Phase 17), per region:
 *  - FAA notices for US flights abroad (prohibitions, advisories) for the region's countries or seas that
 *    appeared in the last 14 days: 3 each (max 6); standing notices are listed but not scored;
 *  - headlines about airspace closures, suspended flights, GPS jamming or no-fly zones (72 h):
 *    1 publisher 1, 2–3 publishers 2, 4+ publishers 3;
 *  - United States only: ground stops and ground delay programs with a cause other than weather,
 *    volume or runway work (2 each, max 4); 8+ airports in ground stops at once (+3). Active VIP and
 *    security flight restrictions are shown, not scored (dozens are routine).
 * Score → level: 1 LOW, 2 GUARDED, 4 ELEVATED, 6 HIGH.
 */
export function airspaceMeter(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const short = getRegion(regionId)?.shortCode ?? regionId;
  const r = events.filter((e) => inRegion(e, regionId));
  const components: MeterComponent[] = [];
  const notes: string[] = [];
  let score = 0;
  const readingParts: string[] = [];

  // FAA notices for US civil aviation abroad.
  const areas = (input.airspaceNotices?.areas ?? []).filter((a) => a.regionIds.includes(regionId));
  if (regionId !== 'united-states') {
    const fresh = areas.flatMap((a) => a.docs.filter((d) => d.firstSeen && now - Date.parse(d.firstSeen) <= NEW_NOTICE_DAYS * 86_400_000).map((d) => ({ a, d })));
    score += Math.min(6, fresh.length * 3);
    components.push({
      label: `New FAA notices for US flights (${NEW_NOTICE_DAYS} d)`,
      value: fresh.length ? fresh.map((x) => x.a.name).join(', ') : '0',
      active: fresh.length > 0,
    });
    components.push({
      label: 'Standing FAA bans and advisories',
      value: areas.length ? areas.map((a) => `${a.name} (${a.level})`).join(', ') : 'none',
      active: false,
      note: 'context only, not scored',
    });
    if (fresh.length) readingParts.push(`${plural(fresh.length, 'new FAA notice')} for US flights (${[...new Set(fresh.map((x) => x.a.name))].join(', ')})`);
  }

  // Headlines.
  const heads = r.filter((e) => !isFaaRecord(e) && isNews(e) && within(e, now, 72) && isAirspaceHeadline(e.title));
  const publishers = new Set(heads.map((e) => e.sourceId)).size;
  score += publishers >= 4 ? 3 : publishers >= 2 ? 2 : publishers;
  components.push({ label: 'Headlines: airspace closures, suspended flights, GPS jamming (72 h)', value: heads.length ? `${heads.length} from ${plural(publishers, 'publisher')}` : '0', active: heads.length > 0 });
  if (heads.length) readingParts.push(`${plural(heads.length, 'headline')} about airspace or flight disruption`);

  // United States: airport programs and flight restrictions.
  let usRecords: IntelligenceEvent[] = [];
  if (regionId === 'united-states') {
    const st = input.airportStatus && now - Date.parse(input.airportStatus.fetchedAt) <= AIRPORT_MAX_AGE_H * 3_600_000 ? input.airportStatus : null;
    if (st) {
      const notable = st.events.filter((e) => (e.kind === 'ground-stop' || e.kind === 'ground-delay') && e.notable);
      const stops = st.events.filter((e) => e.kind === 'ground-stop');
      const widespread = stops.length >= WIDESPREAD_GROUND_STOPS;
      score += Math.min(4, notable.length * 2) + (widespread ? 3 : 0);
      components.push({
        label: 'Ground stops and delay programs not caused by weather or volume',
        value: notable.length ? notable.map((e) => `${e.code} (${e.condition})`).join(', ') : '0',
        active: notable.length > 0,
      });
      components.push({ label: 'Airports in ground stops now', value: String(stops.length), active: widespread, note: `${WIDESPREAD_GROUND_STOPS}+ at once scores` });
      if (notable.length) readingParts.push(`${plural(notable.length, 'ground stop or delay program')} not caused by weather (${notable.map((e) => e.code).join(', ')})`);
      if (widespread) readingParts.push(`${stops.length} airports in ground stops at once`);
    } else {
      components.push({ label: 'FAA airport status', value: 'no recent reading', active: false });
    }
    const tfrs = input.tfrs?.items ?? [];
    const active = tfrs.filter((t) => tfrActive(t, now));
    const vip = active.filter((t) => t.type === 'VIP');
    components.push({ label: 'Active FAA flight restrictions (VIP · security · special)', value: `${vip.length} · ${active.filter((t) => t.type === 'SECURITY').length} · ${active.filter((t) => t.type === 'SPECIAL').length}`, active: false, note: 'context only: dozens are routine' });
    usRecords = r.filter((e) => e.sourceId === 'faa-airport-status' && within(e, now, 24));
    notes.push('Ground stops for weather, traffic volume or runway work are routine and not scored. Restrictions without times count as active.');
  } else {
    notes.push('FAA notices are the US regulator\'s bans and advisories for US airlines and pilots; other countries\' aviation authorities are not read.');
  }

  const level = levelFromScore(score, [1, 2, 4, 6]);
  const noticeRecords = r.filter((e) => e.sourceId === 'faa-airspace-notices' && within(e, now, NEW_NOTICE_DAYS * 24));
  const evidence = evidenceOf([...noticeRecords, ...usRecords, ...heads], (e) => (e.sourceId === 'faa-airspace-notices' ? 'FAA notice' : e.sourceId === 'faa-airport-status' ? 'FAA airport status' : 'headline'));
  return meter({
    id: `airspace.${regionId}`,
    kind: 'airspace',
    family: 'topic',
    name: `${short} airspace`,
    regionId,
    level,
    value: score,
    reading: readingParts.length ? `${readingParts.join('; ')}.` : 'No airspace closures, new FAA notices or unusual ground stops in the sources.',
    components,
    evidence,
    asOf:
      newest([...noticeRecords, ...usRecords, ...heads]) ??
      areas.flatMap((a) => a.docs.map((d) => d.firstSeen)).filter((x): x is string => !!x).sort().pop() ??
      (regionId === 'united-states' ? (input.airportStatus?.fetchedAt ?? null) : null),
    baseline: 'none',
    notes,
  });
}
