import type { IntelligenceEvent } from '../types.ts';
import { WATCH_REGIONS, getRegion } from '../regions.ts';
import { CHOKEPOINTS } from '../chokepoints.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent, MeterLevel } from './types.ts';
import {
  aircraftClass,
  isCisaAlert,
  isCurrencyStress,
  isDirectedOutage,
  isDprkLaunch,
  isDprkNuclearTest,
  isFireCluster,
  isFmsContract,
  isKev,
  isMilitaryLaunch,
  isNews,
  isNotableAircraft,
  isOilRise,
  isOngoingOutage,
  isRansomwareKev,
  isSanctionsDesignation,
  isSecurityTfr,
  isSevereDisasterAlert,
  isUnscDivided,
  isUnscFailedDraft,
  isUnscMeeting,
  isAdvisoryRaise,
  isFcdoSecurityUpdate,
  isWhoReport,
} from './signals.ts';
import { bigDecksIn, displacementRises, stressedStraits } from './region.ts';
import { DAY, H, evidenceOf, fmtUsd, fmtUsual, inRegion, levelFromScore, levelFromUsual, meta, meter, newest, plural, usualFor, within } from './util.ts';
import { describe, signalsOf } from '../anomaly.ts';

const short = (r: string) => getRegion(r)?.shortCode ?? r;
const count = (events: IntelligenceEvent[], pred: (e: IntelligenceEvent) => boolean) => events.filter(pred).length;

// ---------------------------------------------------------------- 4. air surge (per region)

/**
 * Tanker, airlift, ISR and bomber sightings in a region over 72 hours against the usual level.
 * Tankers and airlift rising together is the classic sign of an operation being prepared.
 */
export function airSurge(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const pred = (e: IntelligenceEvent) => inRegion(e, regionId) && isNotableAircraft(e);
  const u = usualFor(input, `air.${regionId}`, pred, 72, 14, 1);
  const recent = events.filter((e) => pred(e) && within(e, now, 72));
  const by = (c: string) => recent.filter((e) => aircraftClass(e) === c).length;
  const together = by('tanker') > 0 && by('airlift') > 0;
  const level: MeterLevel = u.status === 'building' ? null : u.current === 0 ? 0 : levelFromUsual(u, [0.01, 1.5, 2, 3]);
  return meter({
    id: `air-surge.${regionId}`,
    kind: 'air-surge',
    family: 'topic',
    name: `${short(regionId)} air surge`,
    regionId,
    level,
    label: u.status === 'building' ? `${u.current} IN 72 H` : undefined,
    value: u.status === 'building' ? u.current : u.ratio,
    reading: u.status === 'building' ? `${plural(u.current, 'notable military aircraft sighting')} in 72 h; the usual level needs 14 days of history.` : `${u.current} sightings in 72 h against a usual ${u.usual} (${u.ratio}×${u.anomaly?.status === 'ok' ? `; ${describe(u.anomaly)}` : ''})${together ? '; tankers and airlift together' : ''}.`,
    components: ['tanker', 'airlift', 'isr', 'bomber'].map((c): MeterComponent => ({ label: c === 'isr' ? 'ISR' : c[0].toUpperCase() + c.slice(1), value: String(by(c)), active: by(c) > 0 })),
    evidence: evidenceOf(recent, (e) => aircraftClass(e)),
    asOf: newest(recent),
    baseline: u.status,
    baselineBasis: u.basis?.text ?? null,
    signals: signalsOf('Military aircraft sightings', 'aircraft', u.anomaly),
    notes: ['Only aircraft that broadcast ADS-B and are marked military by the network; many military flights do not broadcast.'],
  });
}

// ---------------------------------------------------------------- 5. naval presence (global)

/** Big-deck ships per watch region (latest USNI tracker), strait status and sanctioned ships seen. */
export function navalPresence(input: MeterInput): Meter {
  const rows = WATCH_REGIONS.filter((r) => r.id !== 'global-cyber').map((r) => ({ r, decks: bigDecksIn(input, r.id) }));
  const most = Math.max(0, ...rows.map((x) => x.decks.length));
  const total = rows.reduce((s, x) => s + x.decks.length, 0);
  const sightings = input.sanctionedShips?.sightings ?? [];
  const fleet = input.fleet;
  const stale = fleet ? (input.now - Date.parse(`${fleet.asOf}T12:00:00Z`)) / DAY > 10 : true;
  return meter({
    id: 'naval',
    kind: 'naval',
    family: 'topic',
    name: 'Naval presence',
    regionId: null,
    level: fleet ? (Math.min(4, most) as MeterLevel) : null,
    label: fleet ? `${total} BIG DECKS` : 'NO DATA',
    value: fleet ? total : null,
    reading: fleet ? `${plural(total, 'carrier or amphibious assault ship')} in watch regions (USNI, ${fleet.asOf}); most in one region: ${most}.${stale ? ' Tracker more than 10 days old.' : ''}` : 'No USNI fleet tracker loaded.',
    components: [
      ...rows.filter((x) => x.decks.length).map((x): MeterComponent => ({ label: short(x.r.id), value: x.decks.map((d) => `${d.hull} (${d.area})`).join(', '), active: true })),
      ...(input.chokepoints?.items ?? []).map((c): MeterComponent => ({ label: c.name, value: c.status, active: c.status !== 'normal' && c.status !== 'insufficient-data', note: `7-day mean ${c.mean7?.toFixed(1) ?? '—'} transits a day` })),
      { label: 'Sanctioned ships seen (48 h)', value: String(sightings.length), active: sightings.length > 0, note: 'Baltic and North Sea only' },
    ],
    evidence: [
      ...(fleet ? [{ title: fleet.title, url: fleet.url, at: fleet.publishedAt, why: 'USNI News Fleet and Marine Tracker' }] : []),
      ...sightings.slice(0, 2).map((s) => ({ title: `Sanctioned vessel seen: ${s.listedName}${s.imo ? ` (IMO ${s.imo})` : ''}`, at: s.seenAt, why: `AIS, ${s.lists.join('/')}` })),
    ],
    asOf: fleet?.asOf ?? null,
    baseline: 'none',
    notes: ['The USNI tracker is weekly and approximate (named sea areas, not positions). Level = most big decks in any one region.'],
  });
}

// ---------------------------------------------------------------- 6. maritime risk (per strait)

/**
 * Per chokepoint: transit status (reduced 2, sudden drop or severe 3), maritime news naming the
 * strait in 7 days (+1 for 2 or more), an oil price rise in 7 days (+1 for Gulf and Red Sea routes).
 */
export function maritimeRisk(input: MeterInput): Meter[] {
  const { now, events } = input;
  const oil = events.filter((e) => within(e, now, 7 * 24) && isOilRise(e));
  return CHOKEPOINTS.map((cp) => {
    const reading = input.chokepoints?.items.find((c) => c.id === cp.id) ?? null;
    const words = cp.name.replace(/^(Strait of|The)\s+/i, '').split(' ')[0];
    const re = new RegExp(`\\b${words}\\b`, 'i');
    const news = events.filter((e) => within(e, now, 7 * 24) && isNews(e) && re.test(e.title));
    const statusPts = !reading ? 0 : reading.status === 'reduced' ? 2 : reading.status === 'severe' || reading.status === 'sudden-drop' ? 3 : 0;
    const oilPts = oil.length && ['hormuz', 'bab-el-mandeb', 'suez'].includes(cp.id) ? 1 : 0;
    const score = statusPts + (news.length >= 2 ? 1 : 0) + oilPts;
    return meter({
      id: `maritime.${cp.id}`,
      kind: 'maritime',
      family: 'topic',
      name: `${cp.name} maritime risk`,
      regionId: cp.regionId,
      level: reading ? (Math.min(4, score) as MeterLevel) : null,
      value: reading ? score : null,
      reading: reading ? `Transits ${reading.status}${reading.mean7 !== null ? ` (${reading.mean7.toFixed(1)} a day over 7 days)` : ''}; ${plural(news.length, 'news report')} naming it in 7 days.` : 'No PortWatch data loaded.',
      components: [
        { label: 'Transit status', value: reading?.status ?? '—', active: statusPts > 0, note: reading?.latestDate ? `data to ${reading.latestDate}` : undefined },
        { label: 'News naming it (7 d)', value: String(news.length), active: news.length >= 2 },
        { label: 'Oil price rise (7 d)', value: oil.length ? 'yes' : 'no', active: oilPts > 0 },
      ],
      evidence: evidenceOf(news, () => 'names the strait', 4),
      asOf: reading?.latestDate ?? null,
      baseline: 'none',
      notes: ['PortWatch transit counts run about 6 days behind.'],
    });
  });
}

// ---------------------------------------------------------------- 7. sanctions pressure (global)

/** New designations per target country (US, EU, UK lists) over 7 and 30 days, plus sanctioned ships seen. */
export function sanctionsPressure(input: MeterInput): Meter {
  const { now, events } = input;
  const recent = events.filter((e) => isSanctionsDesignation(e) && within(e, now, 30 * 24));
  const per = new Map<string, { week: number; month: number }>();
  for (const e of recent) {
    const n = Number(meta(e, 'count') ?? 1);
    for (const c of e.countryCodes.length ? e.countryCodes : ['?']) {
      const v = per.get(c) ?? { week: 0, month: 0 };
      v.month += n;
      if (within(e, now, 7 * 24)) v.week += n;
      per.set(c, v);
    }
  }
  const ranked = [...per].sort((a, b) => b[1].week - a[1].week || b[1].month - a[1].month);
  const topWeek = ranked[0]?.[1].week ?? 0;
  const weekTotal = recent.filter((e) => within(e, now, 7 * 24)).reduce((s, e) => s + Number(meta(e, 'count') ?? 1), 0);
  const ships = input.sanctionedShips?.sightings.length ?? 0;
  return meter({
    id: 'sanctions',
    kind: 'sanctions',
    family: 'topic',
    name: 'Sanctions pressure',
    regionId: null,
    level: levelFromScore(topWeek, [1, 5, 20, 50]),
    value: weekTotal,
    label: `${weekTotal} IN 7 D`,
    reading: ranked.length ? `${weekTotal} new designations in 7 days; most against ${ranked[0][0] === '?' ? 'no stated country' : ranked[0][0]} (${topWeek}).` : 'No new designations in 30 days.',
    components: [
      ...ranked.slice(0, 6).map(([c, v]): MeterComponent => ({ label: c === '?' ? 'No country stated' : c, value: `${v.week} (7 d) · ${v.month} (30 d)`, active: v.week > 0 })),
      { label: 'Sanctioned ships seen (48 h)', value: String(ships), active: ships > 0, note: 'AIS, Baltic and North Sea only' },
    ],
    evidence: evidenceOf(recent, (e) => String(meta(e, 'list') ?? '').toUpperCase()),
    asOf: newest(recent),
    baseline: 'none',
    notes: ['Country = address, nationality or sanctions programme as the list gives it; designations with neither are counted under "no country stated".', 'The EU list is read once a day, the UK list every 6 hours, OFAC every run.'],
  });
}

// ---------------------------------------------------------------- 8. arms flow (global)

/** Munitions contract dollars and FMS in 7 days, BIS export rules and congressional arms-sale challenges in 30 days. */
export function armsFlow(input: MeterInput): Meter {
  const { now, events } = input;
  const contracts = events.filter((e) => e.sourceId === 'dod-contracts' && within(e, now, 7 * 24));
  const munitions = contracts.filter((e) => meta(e, 'munitions') === true);
  const munitionsUsd = munitions.reduce((s, e) => s + Number(meta(e, 'amountUsd') ?? 0), 0);
  const fms = contracts.filter(isFmsContract);
  const fmsCountries = [...new Set(fms.flatMap((e) => meta<string[]>(e, 'fmsCountries') ?? []))];
  const bis = events.filter((e) => within(e, now, 30 * 24) && e.sourceId === 'federal-register' && meta(e, 'fedregKind') === 'export-controls');
  const challenges = events.filter((e) => within(e, now, 30 * 24) && e.sourceId === 'congress' && meta(e, 'congressKind') === 'arms-sale-disapproval');
  const level = levelFromScore(munitionsUsd, [1, 1e9, 5e9, 15e9]);
  return meter({
    id: 'arms',
    kind: 'arms',
    family: 'topic',
    name: 'Arms flow',
    regionId: null,
    level,
    label: munitionsUsd ? `${fmtUsd(munitionsUsd)} MUNITIONS` : undefined,
    value: Math.round(munitionsUsd / 1e6),
    reading: `${fmtUsd(munitionsUsd)} in munitions contracts and ${plural(fms.length, 'FMS contract')} in 7 days${fmsCountries.length ? ` (${fmsCountries.join(', ')})` : ''}; ${plural(bis.length, 'export-control rule')} and ${plural(challenges.length, 'arms-sale challenge')} in 30 days.`,
    components: [
      { label: 'Munitions contracts (7 d)', value: `${munitions.length} · ${fmtUsd(munitionsUsd)}`, active: munitions.length > 0 },
      { label: 'FMS contracts (7 d)', value: fmsCountries.length ? `${fms.length} · ${fmsCountries.join(', ')}` : '0', active: fms.length > 0 },
      { label: 'BIS export rules (30 d)', value: String(bis.length), active: bis.length > 0 },
      { label: 'Arms-sale challenges in Congress (30 d)', value: String(challenges.length), active: challenges.length > 0 },
    ],
    evidence: evidenceOf([...munitions, ...fms, ...challenges, ...bis], (e) => (e.sourceId === 'dod-contracts' ? (meta(e, 'ceiling') ? 'contract ceiling' : 'contract') : e.sourceId)),
    asOf: newest([...contracts, ...bis, ...challenges]),
    baseline: 'none',
    notes: ['Contract values are as announced; some are ceilings (maximum possible value) and are labelled so. Level from munitions dollars in 7 days ($1B, $5B, $15B).'],
  });
}

// ---------------------------------------------------------------- 9. Washington attention (global)

const WASHINGTON_WEIGHTS: [string, (e: IntelligenceEvent) => boolean, number][] = [
  ['War powers resolutions', (e) => e.sourceId === 'congress' && meta(e, 'congressKind') === 'war-powers', 3],
  ['NTAS bulletins or alerts', (e) => e.sourceId === 'dhs-ntas', 3],
  ['National emergencies declared', (e) => e.sourceId === 'federal-register' && meta(e, 'fedregKind') === 'national-emergency-declared', 2],
  ['Presidential security documents', (e) => e.sourceId === 'federal-register' && ['presidential-action', 'executive-order'].includes(String(meta(e, 'fedregKind'))), 1],
  ['Terrorist designations', (e) => e.sourceId === 'federal-register' && meta(e, 'fedregKind') === 'terrorist-designation', 1],
  ['Floor votes on security measures', (e) => e.sourceId === 'congress' && meta(e, 'floorVote') != null && meta(e, 'congressKind') !== 'hearing', 1],
  ['Security-committee hearings', (e) => e.sourceId === 'congress' && meta(e, 'congressKind') === 'hearing', 0.5],
];

/** Weighted count of Washington's security actions over 7 days. */
export function washingtonAttention(input: MeterInput): Meter {
  const { now, events } = input;
  const recent = events.filter((e) => within(e, now, 7 * 24) || (e.occurredAt && Date.parse(e.occurredAt) <= now && Date.parse(e.occurredAt) >= now - 7 * DAY && e.sourceId === 'congress'));
  let score = 0;
  const components = WASHINGTON_WEIGHTS.map(([label, pred, w]): MeterComponent => {
    const n = count(recent, pred);
    score += n * w;
    return { label, value: String(n), active: n > 0, note: `×${w}` };
  });
  const matched = recent.filter((e) => WASHINGTON_WEIGHTS.some(([, p]) => p(e)));
  return meter({
    id: 'washington',
    kind: 'washington',
    family: 'topic',
    name: 'Washington attention',
    regionId: null,
    level: levelFromScore(score, [1, 3, 6, 10]),
    value: score,
    reading: `Weighted score ${score} from ${plural(matched.length, 'action')} in 7 days.`,
    components,
    evidence: evidenceOf(matched),
    asOf: newest(matched),
    baseline: 'none',
    notes: ['Counts what the Federal Register, Congress.gov and DHS publish; classified actions and statements are not included.'],
  });
}

// ---------------------------------------------------------------- 10. diplomatic temperature (per region)

/**
 * 14 days: UNSC meetings on the region (1 each), divided votes (2), failed drafts or vetoes (3),
 * US advisory raises (2), UK security-related advice updates (0.5, at most 2 in total).
 */
export function diplomaticTemperature(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const r = events.filter((e) => inRegion(e, regionId) && within(e, now, 14 * 24));
  const parts: [string, IntelligenceEvent[], number][] = [
    ['UNSC meetings', r.filter(isUnscMeeting), 1],
    ['Divided UNSC votes', r.filter(isUnscDivided), 2],
    ['Failed drafts or vetoes', r.filter(isUnscFailedDraft), 3],
    ['US advisory raises', r.filter(isAdvisoryRaise), 2],
    ['UK security advice updates', r.filter(isFcdoSecurityUpdate), 0.5],
  ];
  // UK advice is often updated for many countries at once: capped at 2 points.
  const score = parts.reduce((s, [label, list, w]) => s + Math.min(label.startsWith('UK') ? 2 : Infinity, list.length * w), 0);
  const all = parts.flatMap(([, list]) => list);
  return meter({
    id: `diplomatic.${regionId}`,
    kind: 'diplomatic',
    family: 'topic',
    name: `${short(regionId)} diplomatic temperature`,
    regionId,
    level: levelFromScore(score, [0.5, 3, 6, 10]),
    value: score,
    reading: `Score ${score} from ${plural(all.length, 'item')} in 14 days.`,
    components: parts.map(([label, list, w]) => ({ label, value: String(list.length), active: list.length > 0, note: label.startsWith('UK') ? `×${w}, max 2` : `×${w}` })),
    evidence: evidenceOf(all),
    asOf: newest(all),
    baseline: 'none',
    notes: ['UNSC records are tagged to a region from the meeting agenda; thematic meetings are not counted.'],
  });
}

// ---------------------------------------------------------------- 11. strategic weapons (global)

const IAEA_HOT = /\b(Iran|Zaporizhzhia|enrichment|uranium|DPRK|North Korea|Yongbyon|Kursk|Chornobyl)\b/i;

/** 30 days: DPRK nuclear tests (HIGH) and missile launches, military launches, IAEA news on hot files, nuclear actions in Congress. */
export function strategicWeapons(input: MeterInput): Meter {
  const { now, events } = input;
  const d30 = events.filter((e) => within(e, now, 30 * 24));
  const tests = d30.filter(isDprkNuclearTest);
  const dprk = d30.filter(isDprkLaunch);
  const dprk7 = dprk.filter((e) => within(e, now, 7 * 24));
  const launches = d30.filter(isMilitaryLaunch);
  const iaea = d30.filter((e) => e.sourceId === 'iaea-news' && IAEA_HOT.test(e.title));
  const nuclear = d30.filter((e) => e.sourceId === 'congress' && meta(e, 'congressKind') === 'nuclear-cooperation');
  const byCountry = new Map<string, number>();
  for (const e of launches) for (const c of e.countryCodes.length ? e.countryCodes : ['?']) byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
  const level: MeterLevel = tests.length ? 4 : dprk7.length ? 3 : dprk.length || iaea.length >= 3 ? 2 : launches.length || iaea.length ? 1 : 0;
  return meter({
    id: 'strategic',
    kind: 'strategic',
    family: 'topic',
    name: 'Strategic weapons',
    regionId: null,
    level,
    value: level,
    reading: tests.length ? 'DPRK nuclear test reported in 30 days.' : `${plural(dprk.length, 'DPRK launch day')}, ${plural(launches.length, 'military or classified space launch', 'military or classified space launches')} and ${plural(iaea.length, 'IAEA item')} on Iran, Ukraine or DPRK files in 30 days.`,
    components: [
      { label: 'DPRK nuclear tests (30 d)', value: String(tests.length), active: tests.length > 0 },
      { label: 'DPRK launch days (30 d / 7 d)', value: `${dprk.length} / ${dprk7.length}`, active: dprk.length > 0 },
      { label: 'Military space launches (30 d)', value: launches.length ? [...byCountry].map(([c, n]) => `${c} ${n}`).join(', ') : '0', active: launches.length > 0 },
      { label: 'IAEA on Iran / Ukraine / DPRK (30 d)', value: String(iaea.length), active: iaea.length > 0 },
      { label: 'Nuclear cooperation actions in Congress (30 d)', value: String(nuclear.length), active: nuclear.length > 0 },
    ],
    evidence: evidenceOf([...tests, ...dprk, ...iaea, ...launches, ...nuclear]),
    asOf: newest([...tests, ...dprk, ...launches, ...iaea]),
    baseline: 'none',
    notes: ['DPRK launches come from Yonhap headlines (one record per Korea day). Space launches are not missile tests.'],
  });
}

// ---------------------------------------------------------------- 12. information blackout (per region)

/**
 * Outages attributed to a government order or military action in 72 hours (3), other ongoing
 * outages (1, max 2), and a reporting drop: region records in 24 h under 40% of the usual day
 * (with a usual day of 10+) (2).
 */
export function informationBlackout(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const r = events.filter((e) => inRegion(e, regionId));
  const directed = r.filter((e) => within(e, now, 72) && isDirectedOutage(e));
  const ongoing = r.filter((e) => within(e, now, 72) && isOngoingOutage(e) && !isDirectedOutage(e));
  const volume = usualFor(input, `volume.${regionId}`, (e) => inRegion(e, regionId), 24, 14, 1);
  // Reporting drop: unusually low against the typical spread (Phase 24), else under 40% of a usual 10+.
  const drop = volume.status === 'ok' && (volume.anomaly?.status === 'ok' ? volume.anomaly.direction === 'drop' : volume.usual! >= 10 && volume.current < 0.4 * volume.usual!);
  // New blocks of messaging apps or major sites (OONI), 7 days: 2 each, max 4.
  const newBlocks = r.filter((e) => e.sourceId === 'ooni' && within(e, now, 7 * 24) && meta(e, 'newBlock') === true);
  const score = directed.length * 3 + Math.min(2, ongoing.length) + (drop ? 2 : 0) + Math.min(4, newBlocks.length * 2);
  return meter({
    id: `blackout.${regionId}`,
    kind: 'blackout',
    family: 'topic',
    name: `${short(regionId)} information blackout`,
    regionId,
    level: levelFromScore(score, [1, 2, 3, 5]),
    value: score,
    reading: directed.length ? `${plural(directed.length, 'outage')} attributed to a government order or military action in 72 h.` : drop ? 'Reporting from the region well below its usual level.' : ongoing.length ? `${plural(ongoing.length, 'ongoing outage')} without a stated political cause.` : 'No attributed outages; reporting at its usual level.',
    components: [
      { label: 'Directed or military outages (72 h)', value: String(directed.length), active: directed.length > 0 },
      { label: 'Other ongoing outages (72 h)', value: String(ongoing.length), active: ongoing.length > 0 },
      { label: 'Records in 24 h', value: fmtUsual(volume), active: drop },
      { label: 'New app or site blocks (OONI, 7 d)', value: newBlocks.length ? newBlocks.map((e) => e.title.replace(/^OONI: /, '').split(' — ')[0]).join('; ') : '0', active: newBlocks.length > 0 },
    ],
    evidence: evidenceOf([...directed, ...ongoing]),
    asOf: newest([...directed, ...ongoing]),
    baseline: volume.status,
    baselineBasis: volume.basis?.text ?? null,
    signals: drop ? signalsOf('Records from the region (24 h)', 'volume', volume.anomaly) : [],
    notes: ['Most outages are technical or power cuts; only Cloudflare attributes causes. The reporting-drop test needs 14 days of history.'],
  });
}

// ---------------------------------------------------------------- 13. economic stress (per region)

/** 14 days: currency-stress records (2 each, max 4), stressed chokepoints in the region (2), an oil rise for Gulf and Red Sea regions (1). */
export function economicStress(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const currency = events.filter((e) => inRegion(e, regionId) && within(e, now, 14 * 24) && isCurrencyStress(e));
  const straits = stressedStraits(input, regionId);
  const oil = ['middle-east', 'red-sea'].includes(regionId) ? events.filter((e) => within(e, now, 7 * 24) && isOilRise(e)) : [];
  const score = Math.min(4, currency.length * 2) + (straits.length ? 2 : 0) + (oil.length ? 1 : 0);
  return meter({
    id: `economic.${regionId}`,
    kind: 'economic',
    family: 'topic',
    name: `${short(regionId)} economic stress`,
    regionId,
    level: levelFromScore(score, [1, 2, 4, 6]),
    value: score,
    reading: [currency.length ? plural(currency.length, 'currency-stress record') : '', straits.length ? straits.map((s) => `${s.name} ${s.status}`).join(', ') : '', oil.length ? 'oil rising' : ''].filter(Boolean).join('; ') || 'No currency, chokepoint or oil stress.',
    components: [
      { label: 'Currency stress (14 d)', value: currency.length ? [...new Set(currency.map((e) => String(meta(e, 'currency'))))].join(', ') : 'none', active: currency.length > 0 },
      { label: 'Chokepoints', value: straits.length ? straits.map((s) => `${s.name}: ${s.status}`).join(', ') : 'normal or none', active: straits.length > 0 },
      ...(['middle-east', 'red-sea'].includes(regionId) ? [{ label: 'Oil rise (7 d)', value: oil.length ? 'yes' : 'no', active: oil.length > 0 }] : []),
    ],
    evidence: evidenceOf([...currency, ...oil]),
    asOf: newest([...currency, ...oil]) ?? input.chokepoints?.latestDate ?? null,
    baseline: 'none',
    notes: ['Currency stress: 5% in a week or 10% in a month against the dollar (2% for pegs). Chokepoint data is about 6 days behind.'],
  });
}

// ---------------------------------------------------------------- 14. humanitarian strain (per region)

/** WHO reports (30 d; high-consequence 2), displacement rises (2), orange/red disaster alerts (14 d), new fire clusters (7 d, 10+). */
export function humanitarianStrain(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const region = getRegion(regionId)!;
  const r = events.filter((e) => inRegion(e, regionId));
  const who = r.filter((e) => within(e, now, 30 * 24) && isWhoReport(e));
  const disasters = r.filter((e) => within(e, now, 14 * 24) && isSevereDisasterAlert(e));
  const fires = r.filter((e) => within(e, now, 7 * 24) && isFireCluster(e));
  const displaced = displacementRises(input, region.countryCodes);
  const abroad = (input.displacement?.rows ?? []).filter((x) => region.countryCodes.includes(x.country)).reduce((s, x) => s + x.latest.refugeesAbroad + x.latest.idps, 0);
  const score = who.reduce((s, e) => s + (meta(e, 'highConsequence') ? 2 : 1), 0) + displaced.length * 2 + disasters.reduce((s, e) => s + (meta(e, 'alertLevel') === 'Red' ? 2 : 1), 0) + (fires.length >= 10 ? 1 : 0);
  return meter({
    id: `humanitarian.${regionId}`,
    kind: 'humanitarian',
    family: 'topic',
    name: `${short(regionId)} humanitarian strain`,
    regionId,
    level: levelFromScore(score, [1, 2, 4, 6]),
    value: score,
    reading: `${plural(who.length, 'WHO outbreak report')} (30 d), ${plural(disasters.length, 'orange/red disaster alert')} (14 d)${displaced.length ? `, internal displacement up in ${displaced.map((d) => d.country).join(', ')}` : ''}.`,
    components: [
      { label: 'WHO outbreak reports (30 d)', value: String(who.length), active: who.length > 0 },
      { label: 'Displacement up 20%+ on last year', value: displaced.length ? displaced.map((d) => `${d.country} ${Math.round(d.from / 1000)}k → ${Math.round(d.to / 1000)}k`).join(', ') : 'none', active: displaced.length > 0 },
      { label: 'People displaced (UNHCR, latest)', value: abroad ? `${(abroad / 1e6).toFixed(1)}M` : '—', note: 'refugees abroad plus IDPs' },
      { label: 'Orange/red disaster alerts (14 d)', value: String(disasters.length), active: disasters.length > 0 },
      { label: 'New fire clusters (7 d)', value: String(fires.length), active: fires.length >= 10, note: 'farm and forest fires look the same from orbit' },
    ],
    evidence: evidenceOf([...who, ...disasters]),
    asOf: newest([...who, ...disasters, ...fires]),
    baseline: 'none',
    notes: ['UNHCR figures are mid-year or annual; WHO reports lag the first cases.'],
  });
}

// ---------------------------------------------------------------- 15. homeland board (US)

/** 7 days: NTAS (4), security (1) and VIP (0.5) flight restrictions, FEMA declarations (30 d, 1), severe or extreme weather alerts (24 h, 0.5), ransomware-linked KEV (1). */
export function homelandBoard(input: MeterInput): Meter {
  const { now, events } = input;
  const d7 = events.filter((e) => within(e, now, 7 * 24));
  const ntas = events.filter((e) => e.sourceId === 'dhs-ntas' && (within(e, now, 30 * 24) || !meta(e, 'expires') || Date.parse(String(meta(e, 'expires'))) > now));
  const sec = d7.filter(isSecurityTfr);
  const vip = d7.filter((e) => e.sourceId === 'faa-tfr' && meta(e, 'tfrType') === 'VIP');
  const fema = events.filter((e) => within(e, now, 30 * 24) && e.sourceId === 'fema-declarations');
  const weather = events.filter((e) => within(e, now, 24) && e.sourceId === 'nws-alerts' && ['Severe', 'Extreme'].includes(String(meta(e, 'severity'))));
  const ransomware = d7.filter(isRansomwareKev);
  const score = ntas.length * 4 + sec.length + vip.length * 0.5 + fema.length + weather.length * 0.5 + ransomware.length;
  return meter({
    id: 'homeland',
    kind: 'homeland',
    family: 'topic',
    name: 'Homeland board',
    regionId: 'united-states',
    level: levelFromScore(score, [1, 4, 8, 14]),
    value: Math.round(score * 10) / 10,
    reading: `${ntas.length ? 'NTAS bulletin or alert in force. ' : ''}${plural(sec.length, 'security flight restriction')}, ${plural(fema.length, 'FEMA declaration')} (30 d), ${plural(weather.length, 'severe weather alert')} (24 h).`,
    components: [
      { label: 'NTAS bulletins or alerts', value: String(ntas.length), active: ntas.length > 0 },
      { label: 'Security flight restrictions (7 d)', value: String(sec.length), active: sec.length > 0 },
      { label: 'VIP flight restrictions (7 d)', value: String(vip.length), active: vip.length > 0 },
      { label: 'FEMA declarations (30 d)', value: String(fema.length), active: fema.length > 0 },
      { label: 'Severe or extreme weather alerts (24 h)', value: String(weather.length), active: weather.length > 0 },
      { label: 'Ransomware-linked KEV (7 d)', value: String(ransomware.length), active: ransomware.length > 0 },
    ],
    evidence: evidenceOf([...ntas, ...sec, ...fema, ...ransomware, ...weather]),
    asOf: newest([...ntas, ...sec, ...vip, ...fema, ...weather]),
    baseline: 'none',
    notes: ['VIP restrictions follow presidential travel and are routine; they are weighted low.'],
  });
}

// ---------------------------------------------------------------- 16. cyber weather (global)

/** 7 days: KEV additions (1; ransomware-linked 3), non-routine CISA alerts (2), outages from cable cuts or unknown causes in watch regions (0.5). */
export function cyberWeather(input: MeterInput): Meter {
  const { now, events } = input;
  const d7 = events.filter((e) => within(e, now, 7 * 24));
  const kev = d7.filter(isKev);
  const ransomware = kev.filter(isRansomwareKev);
  const alerts = d7.filter(isCisaAlert);
  const outages = d7.filter((e) => e.sourceId === 'cloudflare-radar-outages' && ['CABLE_CUT', 'UNKNOWN'].includes(String(meta(e, 'outageCause'))) && e.regionIds.length > 0);
  const score = kev.length + ransomware.length * 2 + alerts.length * 2 + outages.length * 0.5;
  const usual = usualFor(input, 'cyber', (e) => isKev(e) || isCisaAlert(e), 7 * 24, 21, 1);
  const LABELS = ['LOW', 'LOW', 'GUARDED', 'ELEVATED', 'HIGH'];
  // An unusual week of warnings (Phase 24) lifts the meter to at least ELEVATED.
  const spike = usual.anomaly?.direction === 'spike';
  const level = Math.max(levelFromScore(score, [0, 10, 20, 35]), spike ? 3 : 0) as Exclude<MeterLevel, null>;
  return meter({
    id: 'cyber',
    kind: 'cyber',
    family: 'topic',
    name: 'Cyber weather',
    regionId: 'global-cyber',
    level,
    label: LABELS[level],
    value: score,
    reading: `${plural(kev.length, 'exploited vulnerability', 'exploited vulnerabilities')} added (${ransomware.length} ransomware-linked) and ${plural(alerts.length, 'non-routine CISA alert')} in 7 days${usual.usual !== null ? `; usual week ${usual.usual}` : ''}.`,
    components: [
      { label: 'KEV additions (7 d)', value: String(kev.length), active: kev.length > 0 },
      { label: 'Ransomware-linked (7 d)', value: String(ransomware.length), active: ransomware.length > 0, note: '×3' },
      { label: 'Non-routine CISA alerts (7 d)', value: String(alerts.length), active: alerts.length > 0, note: '×2' },
      { label: 'Cable-cut or unexplained outages in watch regions (7 d)', value: String(outages.length), active: outages.length > 0 },
      { label: 'KEV additions and CISA alerts against a usual week', value: fmtUsual(usual), active: spike, note: 'an unusual week raises the meter to ELEVATED' },
    ],
    evidence: evidenceOf([...ransomware, ...alerts, ...kev], (e) => (isRansomwareKev(e) ? 'ransomware-linked' : e.sourceId)),
    asOf: newest(d7.filter((e) => isKev(e) || isCisaAlert(e))),
    baseline: usual.status,
    baselineBasis: usual.basis?.text ?? null,
    signals: signalsOf('Exploited vulnerabilities and CISA alerts (7 d)', 'cyber', usual.anomaly),
    notes: ['A weather-style summary of public US government cyber warnings; it says nothing about any particular network.'],
  });
}

export const HOURS = H;
