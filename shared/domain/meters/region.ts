import type { IntelligenceEvent } from '../types.ts';
import { getRegion } from '../regions.ts';
import { buildStories } from '../stories/stories.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent, MeterEvidence, MeterLevel } from './types.ts';
import {
  isCurrencyStress,
  isDirectedOutage,
  isDprkLaunch,
  isDprkNuclearTest,
  isDrawdown,
  isAdvisoryRaise,
  isFcdoSecurityUpdate,
  isFcdoUpdate,
  isFireCluster,
  isFleetMove,
  isFmsContract,
  isNews,
  isNotableAircraft,
  isPoliticalNews,
  isSecurityTfr,
  isStrikeNews,
  isUnscMeeting,
  advisoryLevel,
  aircraftClass,
} from './signals.ts';
import { at, evidenceOf, inRegion, levelFromScore, meter, newest, plural, usualLevel, within } from './util.ts';

const short = (r: string) => getRegion(r)?.shortCode ?? r;

/** Big-deck ships (carriers, amphibious assault ships) the latest USNI tracker places in a region. */
export function bigDecksIn(input: MeterInput, regionId: string): { name: string; hull: string; area: string }[] {
  return (input.fleet?.areas ?? [])
    .filter((a) => a.regionIds.includes(regionId))
    .flatMap((a) => a.ships.filter((s) => ['CVN', 'LHA', 'LHD'].includes(s.hullType)).map((s) => ({ name: s.name, hull: s.hull, area: a.name })));
}

/** Chokepoints in a region and their latest status. */
export const stressedStraits = (input: MeterInput, regionId: string) =>
  (input.chokepoints?.items ?? []).filter((c) => c.regionId === regionId && ['reduced', 'severe', 'sudden-drop'].includes(c.status));

/** Watch-region countries whose IDP count rose 20% or more on the previous year (UNHCR). */
export function displacementRises(input: MeterInput, countries: string[]): { country: string; from: number; to: number }[] {
  return (input.displacement?.rows ?? [])
    .filter((r) => countries.includes(r.country) && r.previous && r.previous.idps > 0 && r.latest.idps >= 10_000 && r.latest.idps / r.previous.idps >= 1.2)
    .map((r) => ({ country: r.country, from: r.previous!.idps, to: r.latest.idps }));
}

const publishers = (events: IntelligenceEvent[]) => new Set(events.map((e) => e.sourceId)).size;

// ---------------------------------------------------------------- 1. escalation ladder

const RUNGS = ['NONE', 'RHETORIC', 'POSTURE', 'KINETIC', 'CONSEQUENCES'] as const;

/**
 * Escalation ladder: which rungs are active in the last 72 hours (consequences: 14 days).
 *  1 rhetoric      — 3+ military/diplomatic news reports, or a UNSC meeting on the region
 *  2 posture       — tanker/airlift/ISR/bomber aircraft, a big-deck ship present or arriving, an
 *                    embassy drawdown, a travel-advisory raise, a security flight restriction (US)
 *  3 kinetic       — strike/attack headlines from 2+ publishers (or 4+ from one), an outage attributed to a
 *                    government order or military action, a DPRK launch or nuclear test
 *  4 consequences  — chokepoint traffic severely reduced or falling fast, or currency stress
 *                    (annual displacement figures are left to the humanitarian meter)
 * The reading is the highest active rung; the others are listed. Fire detections are shown as
 * supporting evidence only (farm and forest fires look the same from orbit).
 */
export function escalationLadder(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const r72 = events.filter((e) => inRegion(e, regionId) && within(e, now, 72));
  const r14d = events.filter((e) => inRegion(e, regionId) && within(e, now, 14 * 24));

  const rhetoric = r72.filter((e) => isPoliticalNews(e) || isUnscMeeting(e));
  const rhetoricOn = r72.filter(isPoliticalNews).length >= 3 || r72.some(isUnscMeeting);

  const posture = r72.filter((e) => isNotableAircraft(e) || isDrawdown(e) || isAdvisoryRaise(e) || isFleetMove(e) || (regionId === 'united-states' && isSecurityTfr(e)));
  const decks = bigDecksIn(input, regionId);
  const postureOn = posture.length > 0 || decks.length > 0;

  const strikes = r72.filter(isStrikeNews);
  const hardKinetic = r72.filter((e) => isDirectedOutage(e) || isDprkLaunch(e) || isDprkNuclearTest(e));
  // Domestic US headlines about violence are crime and policy, not military action: hard signals only there.
  const kineticOn = (regionId !== 'united-states' && (publishers(strikes) >= 2 || strikes.length >= 4)) || hardKinetic.length > 0;
  const fires = r72.filter(isFireCluster);

  const currency = r14d.filter(isCurrencyStress);
  const straits = stressedStraits(input, regionId).filter((s) => s.status !== 'reduced');
  const consequenceOn = currency.length > 0 || straits.length > 0;

  const on = [false, rhetoricOn, postureOn, kineticOn, consequenceOn];
  const top = Math.max(0, on.lastIndexOf(true)) as 0 | 1 | 2 | 3 | 4;
  const active = RUNGS.filter((_, i) => i > 0 && on[i] && i !== top);

  const components: MeterComponent[] = [
    { label: '1 Rhetoric', value: `${plural(r72.filter(isPoliticalNews).length, 'report')}, ${plural(r72.filter(isUnscMeeting).length, 'UNSC meeting')}`, active: rhetoricOn },
    { label: '2 Posture', value: [`${plural(posture.filter(isNotableAircraft).length, 'aircraft sighting')}`, `${plural(decks.length, 'big deck')}`, posture.filter(isDrawdown).length ? plural(posture.filter(isDrawdown).length, 'drawdown') : '', posture.filter(isAdvisoryRaise).length ? plural(posture.filter(isAdvisoryRaise).length, 'advisory raise') : ''].filter(Boolean).join(', '), active: postureOn },
    { label: '3 Kinetic', value: `${plural(strikes.length, 'strike report')} (${plural(publishers(strikes), 'publisher')})${hardKinetic.length ? `, ${hardKinetic.length} hard signal(s)` : ''}${fires.length ? ` · ${plural(fires.length, 'new fire cluster')} (supporting only)` : ''}`, active: kineticOn },
    { label: '4 Consequences', value: [straits.map((s) => `${s.name} ${s.status}`).join(', '), currency.length ? plural(currency.length, 'currency-stress record') : ''].filter(Boolean).join('; ') || 'none', active: consequenceOn },
  ];

  const evidence: MeterEvidence[] = [
    ...(on[3] ? evidenceOf([...hardKinetic, ...strikes], (e) => (isStrikeNews(e) ? 'strike report' : 'hard kinetic signal'), 3) : []),
    ...(on[2] ? evidenceOf(posture, () => 'posture', 2) : []),
    ...decks.slice(0, 1).map((d) => ({ title: `${d.name} (${d.hull}) — ${d.area}`, url: input.fleet?.url, at: input.fleet?.asOf, why: 'big deck in region (USNI)' })),
    ...(on[4] ? evidenceOf(currency, () => 'currency stress', 1) : []),
    ...straits.slice(0, 1).map((s) => ({ title: `${s.name}: ${s.status} (7-day mean ${s.mean7?.toFixed(1) ?? '—'} a day)`, at: s.latestDate ?? undefined, why: 'chokepoint traffic' })),
    ...(top <= 1 ? evidenceOf(rhetoric, () => 'rhetoric', 3) : []),
  ].slice(0, 6);

  return meter({
    id: `escalation.${regionId}`,
    kind: 'escalation',
    family: 'region',
    name: `${short(regionId)} escalation ladder`,
    regionId,
    level: top as MeterLevel,
    label: `RUNG ${top} · ${RUNGS[top]}`,
    value: top,
    reading: top === 0 ? 'No rung active in the last 72 hours.' : `Highest rung: ${RUNGS[top].toLowerCase()}${active.length ? ` (also: ${active.map((a) => a.toLowerCase()).join(', ')})` : ''}.`,
    components,
    evidence,
    asOf: newest([...r72, ...currency]),
    baseline: 'none',
    notes: [
      'Rungs describe the kind of activity in the sources, not its scale. Consequences look back 14 days; the rest 72 hours.',
      ...(regionId === 'united-states' ? ['In the US region only hard signals (attributed outages) count as kinetic: domestic headlines about violence are crime and policy.'] : []),
    ],
  });
}

// ---------------------------------------------------------------- 2. evacuation risk

/**
 * Evacuation risk: the signals that usually come before a non-combatant evacuation.
 * Points (14 days): ordered departure 3, authorized departure or suspended operations 2,
 * an advisory raise 1 (standing Level 4 advisories are listed but not scored: many are years old), UK security-related advice updates 0.5
 * each (max 1), 3+ airlift aircraft sightings in 72 h 1, currency stress 1.
 */
export function evacuationRisk(input: MeterInput, regionId: string): Meter {
  const { now, events } = input;
  const r = events.filter((e) => inRegion(e, regionId));
  const d14 = r.filter((e) => within(e, now, 14 * 24));
  const drawdowns = d14.filter(isDrawdown);
  const raises = d14.filter(isAdvisoryRaise);
  // Current level per country: the newest advisory record for it.
  const latestLevel = new Map<string, { level: number; e: IntelligenceEvent }>();
  for (const e of [...r].sort((a, b) => at(a) - at(b))) {
    const lv = advisoryLevel(e);
    if (lv !== null && e.countryCodes[0]) latestLevel.set(e.countryCodes[0], { level: lv, e });
  }
  const level4 = [...latestLevel].filter(([, v]) => v.level === 4);
  const fcdo = d14.filter((e) => within(e, now, 7 * 24) && isFcdoSecurityUpdate(e));
  const airlift = r.filter((e) => within(e, now, 72) && isNotableAircraft(e) && aircraftClass(e) === 'airlift');
  const currency = d14.filter(isCurrencyStress);

  let score = 0;
  for (const e of drawdowns) score += String(e.metadata?.postureChange) === 'ordered-departure' ? 3 : 2;
  score += raises.length ? 1 : 0;
  score += Math.min(1, fcdo.length * 0.5);
  score += airlift.length >= 3 ? 1 : 0;
  score += currency.length ? 1 : 0;
  const level = levelFromScore(score, [0.5, 2, 4, 6]);

  return meter({
    id: `evacuation.${regionId}`,
    kind: 'evacuation',
    family: 'region',
    name: `${short(regionId)} evacuation risk`,
    regionId,
    level,
    value: Math.round(score * 10) / 10,
    reading: drawdowns.length ? `${plural(drawdowns.length, 'embassy drawdown')} in 14 days.` : level === 0 ? 'No evacuation-type signals.' : `Score ${Math.round(score * 10) / 10}: no embassy drawdown, other signals present.`,
    components: [
      { label: 'Embassy drawdowns (14 d)', value: String(drawdowns.length), active: drawdowns.length > 0 },
      { label: 'Level 4 countries (standing)', value: level4.length ? level4.map(([c]) => c).join(', ') : 'none', note: 'listed, not scored: many have been Level 4 for years' },
      { label: 'Advisory raises (14 d)', value: String(raises.length), active: raises.length > 0 },
      { label: 'UK security advice updates (7 d)', value: `${fcdo.length} of ${d14.filter((e) => within(e, now, 7 * 24) && isFcdoUpdate(e)).length}`, active: fcdo.length > 0 },
      { label: 'Airlift sightings (72 h)', value: String(airlift.length), active: airlift.length >= 3 },
      { label: 'Currency stress (14 d)', value: String(currency.length), active: currency.length > 0 },
    ],
    evidence: evidenceOf([...drawdowns, ...raises, ...fcdo, ...currency], (e) => (isDrawdown(e) ? 'embassy drawdown' : isAdvisoryRaise(e) ? 'advisory raised' : isFcdoUpdate(e) ? 'UK advice update' : 'currency stress')),
    asOf: newest(d14),
    baseline: 'none',
    notes: ['Embassy drawdowns are the strongest signal; the rest only add context. UK advice updates count only when the change note mentions security, tension or departure.'],
  });
}

// ---------------------------------------------------------------- 3. quiet buildup vs noise

const isPostureSignal = (regionId: string) => (e: IntelligenceEvent) =>
  isNotableAircraft(e) || isFleetMove(e) || isDrawdown(e) || isAdvisoryRaise(e) || isFmsContract(e) || (regionId === 'united-states' && isSecurityTfr(e));

/**
 * News volume against hard posture signals over 72 hours, each relative to its usual level:
 *  - posture ≥ 2× usual and news < 1.5×  → QUIET BUILDUP
 *  - both ≥ 2×                            → CONFIRMED SURGE
 *  - news ≥ 2× and posture < 1.2×         → NOISE (coverage without movement)
 *  - otherwise                            → IN LINE
 * Withheld until 14 days of history exist.
 */
export function buildupVsNoise(input: MeterInput, regionId: string): Meter {
  const { now, events, historyStart } = input;
  const news = usualLevel(events, (e) => inRegion(e, regionId) && isNews(e), now, 72, historyStart, 14, 3);
  const posture = usualLevel(events, (e) => inRegion(e, regionId) && isPostureSignal(regionId)(e), now, 72, historyStart, 14, 1);
  const base = { id: `buildup.${regionId}`, kind: 'buildup' as const, family: 'region' as const, name: `${short(regionId)} buildup vs noise`, regionId };
  const components: MeterComponent[] = [
    { label: 'News reports (72 h)', value: news.usual === null ? String(news.current) : `${news.current} (usual ${news.usual}, ${news.ratio}×)`, active: (news.ratio ?? 0) >= 2 },
    { label: 'Posture signals (72 h)', value: posture.usual === null ? String(posture.current) : `${posture.current} (usual ${posture.usual}, ${posture.ratio}×)`, active: (posture.ratio ?? 0) >= 2 },
  ];
  const postureEvents = events.filter((e) => inRegion(e, regionId) && within(e, now, 72) && isPostureSignal(regionId)(e));
  if (news.status === 'building' || posture.status === 'building') {
    return meter({ ...base, level: null, label: 'BUILDING BASELINE', value: null, reading: `${news.current} news reports and ${posture.current} posture signals in 72 h; usual levels need 14 days of history.`, components, evidence: evidenceOf(postureEvents, () => 'posture signal', 3), asOf: newest(postureEvents), baseline: 'building', notes: ['Posture signals: notable military aircraft, fleet moves, embassy drawdowns, advisory raises, FMS contracts (and US security flight restrictions).'] });
  }
  const n = news.ratio!;
  const p = posture.ratio!;
  const [label, level, reading] =
    p >= 2 && n < 1.5 && posture.current >= 2
      ? (['QUIET BUILDUP', 3, 'Posture signals well above usual while news coverage is not.'] as const)
      : p >= 2 && n >= 2 && posture.current >= 2
        ? (['CONFIRMED SURGE', 4, 'Both posture signals and news coverage are well above usual.'] as const)
        : n >= 2 && p < 1.2
          ? (['NOISE', 1, 'News coverage well above usual without matching posture signals.'] as const)
          : (['IN LINE', 0, 'News and posture signals are near their usual levels.'] as const);
  return meter({ ...base, level, label, value: Math.round((p - n) * 10) / 10, reading, components, evidence: evidenceOf(postureEvents, () => 'posture signal', 4), asOf: newest(postureEvents), baseline: 'ok', notes: ['Value = posture ratio minus news ratio: positive means movement without matching coverage.'] });
}

/** Stories in a region over 72 hours (shared by the corroboration meter). */
export function regionStories(input: MeterInput, regionId: string) {
  const news = input.events.filter((e) => inRegion(e, regionId) && within(e, input.now, 72) && isNews(e));
  return { news, stories: buildStories(news) };
}
