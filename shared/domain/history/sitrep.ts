import type { IntelligenceEvent, SourceStatus } from '../types.ts';
import { WATCH_REGIONS, getRegion } from '../regions.ts';
import { getIndicator, INDICATOR_CATALOG } from '../indicators/catalog.ts';
import type { IndicatorEvaluation, IndicatorTransition, RegionScore, ScoreHistoryPoint } from '../indicators/types.ts';
import type { AlertRecord } from '../alerts/types.ts';
import type { Incident } from '../incidents/types.ts';
import { mdInline, mdUrl, UNTRUSTED_SOURCE_NOTICE } from '../markdown.ts';
import { AIRCRAFT_ROLE_LABEL, isRoutineSighting, type AircraftRole } from '../aircraft.ts';

/**
 * SITREP — Situation Report (PDD §12).
 *
 * Fully DETERMINISTIC: every line is derived from recorded data and cites its
 * records; nothing is inferred or invented. The Markdown form doubles as the
 * "Export Intelligence Context" packet for analysis in Claude.
 */
export interface SitrepItem {
  text: string;
  at?: string | null;
  url?: string;
  eventIds?: string[];
}

export interface SitrepSection {
  key: string;
  title: string;
  items: SitrepItem[];
  empty: string;
}

export interface Sitrep {
  from: string;
  to: string;
  generatedAt: string;
  sections: SitrepSection[];
  limitations: string[];
}

export interface SitrepInput {
  from: number;
  to: number;
  now: number;
  events: IntelligenceEvent[];
  evaluations: IndicatorEvaluation[];
  transitions: IndicatorTransition[];
  currentScores: RegionScore[];
  scoreHistory: ScoreHistoryPoint[];
  alerts: AlertRecord[];
  sourceStatus: SourceStatus[];
  incidents: Incident[];
  /** True when events came from a bounded query that may have been truncated. */
  eventsTruncated?: boolean;
}

const inWindow = (iso: string | null | undefined, from: number, to: number) => !!iso && Date.parse(iso) >= from && Date.parse(iso) <= to;
const evTime = (e: IntelligenceEvent) => e.publishedAt ?? e.collectedAt;
const name = (id: string) => getIndicator(id)?.name ?? id;
const region = (id: string) => getRegion(id)?.name ?? id;

function eventItem(e: IntelligenceEvent, suffix = ''): SitrepItem {
  return { text: `${e.title}${suffix} — ${e.sourceName}`, at: evTime(e), url: e.sourceUrl || undefined, eventIds: [e.id] };
}

/**
 * Military-aircraft sightings (v0.62.0): one aircraft on ADS-B is not a development. Only exceptional ones
 * are listed (bombers, airborne command posts, government VIP transports). Tankers, airlift and surveillance
 * aircraft count through the air-activity indicators instead, as a volume against the usual level.
 */
const isAircraftSighting = (e: IntelligenceEvent) => e.sourceId === 'adsb-military' && e.metadata?.subtype === 'military-aircraft-sighting';

function isSignificant(e: IntelligenceEvent): string | null {
  const m = e.metadata ?? {};
  if (isAircraftSighting(e)) {
    if (isRoutineSighting(e)) return null;
    const role = m.aircraftRole as AircraftRole | undefined;
    return role && AIRCRAFT_ROLE_LABEL[role] ? `${AIRCRAFT_ROLE_LABEL[role].toLowerCase()}` : 'bomber';
  }
  if (m.change === 'raised') return 'advisory level raised';
  if (m.change === 'new') return 'new advisory';
  if (m.change === 'lowered') return 'advisory level lowered';
  if (m.knownRansomwareUse === true) return 'ransomware-linked exploitation';
  if (['alert', 'joint-advisory', 'analysis-report'].includes(String(m.subtype)) && !/known exploited vulnerabilit/i.test(e.title)) {
    return 'non-routine cyber advisory';
  }
  return null;
}

/** Score closest to `t` within `tolerance`, or null. */
function scoreNear(history: ScoreHistoryPoint[], regionId: string, t: number, tolerance: number): number | null {
  let best: ScoreHistoryPoint | null = null;
  for (const p of history) {
    const d = Math.abs(Date.parse(p.at) - t);
    if (d <= tolerance && (!best || d < Math.abs(Date.parse(best.at) - t))) best = p;
  }
  const v = best?.scores[regionId];
  return typeof v === 'number' ? v : null;
}

export function buildSitrep(input: SitrepInput): Sitrep {
  const { from, to } = input;
  const published = input.events.filter((e) => inWindow(evTime(e), from, to)).sort((a, b) => evTime(b).localeCompare(evTime(a)));
  const lateCollected = input.events.filter((e) => inWindow(e.collectedAt, from, to) && !inWindow(evTime(e), from, to));
  const official = published.filter((e) => e.sourceClass === 'official').length;
  const transitionsIn = input.transitions.filter((t) => inWindow(t.at, from, to));
  const triggeredNow = input.evaluations.filter((e) => e.state === 'TRIGGERED');
  const elevatedNow = input.evaluations.filter((e) => e.state === 'ELEVATED');
  const alertsIn = input.alerts.filter((a) => inWindow(a.createdAt, from, to));
  const tolerance = Math.max(4 * 3_600_000, (to - from) * 0.1);

  // 1. Executive summary — counts and facts only.
  const exec: SitrepItem[] = [
    { text: `${published.length} record(s) published in the period (${official} official, ${published.length - official} other).` },
    ...(lateCollected.length
      ? [{ text: `${lateCollected.length} older record(s) were first collected in the period (backfill); they are not counted as new developments.` }]
      : []),
    {
      text: `Indicators now: ${triggeredNow.length} TRIGGERED, ${elevatedNow.length} ELEVATED. ${transitionsIn.length} state change(s) recorded in the period.`,
    },
    {
      text:
        input.currentScores.filter((s) => s.score !== null && s.score >= 40).map((s) => `${region(s.regionId)} ${s.score}`).join('; ') ||
        'No region at or above RAI 40 (Elevated).',
    },
    { text: `${alertsIn.length} alert(s) created in the period.` },
  ];

  // 2. Significant developments.
  const cited = new Set(input.evaluations.filter((e) => e.state === 'TRIGGERED' || e.state === 'ELEVATED').flatMap((e) => e.evidenceEventIds));
  const routineAir = new Set(published.filter((e) => isRoutineSighting(e)).map((e) => e.id));
  const significant = [
    // Heavy air activity: one line per active air indicator, not one per aircraft.
    ...input.evaluations
      .filter((ev) => (ev.state === 'TRIGGERED' || ev.state === 'ELEVATED') && ev.evidenceEventIds.some((id) => routineAir.has(id)))
      .map((ev) => ({
        text: `${name(ev.indicatorId)}: ${ev.state}, ${ev.matchedCount} aircraft against a usual level that puts ELEVATED at ${ev.elevatedAt} [heavy air activity]`,
        at: ev.stateSince,
        eventIds: ev.evidenceEventIds,
      })),
    ...published
      .map((e) => ({ e, why: isSignificant(e) ?? (cited.has(e.id) && !routineAir.has(e.id) ? 'cited by an active indicator' : null) }))
      .filter((x) => x.why)
      .map((x) => eventItem(x.e, ` [${x.why}]`)),
  ];

  // 3. Regional activity changes.
  const regional: SitrepItem[] = WATCH_REGIONS.map((r) => {
    const cur = input.currentScores.find((s) => s.regionId === r.id);
    const start = scoreNear(input.scoreHistory, r.id, from, tolerance);
    const now = cur?.score ?? null;
    const cov = cur ? `, coverage ${Math.round(cur.coverage * 100)}%` : '';
    if (now === null) return { text: `${r.name}: RAI not evaluable (no usable data)${cov}.` };
    if (start === null) return { text: `${r.name}: RAI ${now} (${cur!.band})${cov}; no recorded score near the period start to compare.` };
    const d = now - start;
    return { text: `${r.name}: RAI ${start} → ${now} (${d > 0 ? '+' : ''}${d})${cov}.` };
  });

  // 4. New official warnings (State Dept advisory changes).
  const warnings = published
    .filter((e) => e.sourceId === 'state-travel-advisories' && ['raised', 'new', 'lowered'].includes(String(e.metadata?.change)))
    .map((e) => eventItem(e));

  // 5. Indicator changes.
  const indicators = transitionsIn
    .filter((t) => t.to === 'TRIGGERED' || t.to === 'ELEVATED' || t.from === 'TRIGGERED')
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((t) => ({ text: `${name(t.indicatorId)}: ${t.from ?? 'NEW'} → ${t.to}. ${t.reason}`, at: t.at, eventIds: t.evidenceEventIds }));

  // 6. Conflicting or unverified reporting.
  const unverified: SitrepItem[] = [
    // Aircraft sightings are sensor readings, not reports to corroborate.
    ...published.filter((e) => (e.credibility === 'unverified' || e.credibility === 'single-source') && !isAircraftSighting(e)).map((e) => eventItem(e, ` [${e.credibility}]`)),
    ...input.incidents.flatMap((i) =>
      i.evidence
        .filter((l) => l.assessment === 'disputed')
        .map((l) => ({ text: `Disputed in dossier “${i.title}”: ${l.event.title}${l.note ? ` — ${l.note}` : ''}`, url: l.event.sourceUrl || undefined })),
    ),
  ];

  // 7. Sources requiring attention.
  const sources = input.sourceStatus
    .filter((s) => s.health !== 'ONLINE' && s.health !== 'NOT_CONFIGURED')
    .map((s) => ({ text: `${s.sourceId}: ${s.health}${s.lastError ? ` — ${s.lastError}` : ''}`, at: s.lastSuccessAt }));

  // 8. Outstanding questions — generated from gaps in the data, not speculation.
  const questions: SitrepItem[] = [
    ...triggeredNow.map((e) => ({ text: `What explains “${name(e.indicatorId)}” being TRIGGERED, and is it corroborated by an independent source?`, eventIds: e.evidenceEventIds })),
    ...input.currentScores.filter((s) => s.coverage < 1).map((s) => ({ text: `${region(s.regionId)}: which indicators lack data (coverage ${Math.round(s.coverage * 100)}%)?` })),
    ...input.incidents
      .filter((i) => i.status === 'developing' && i.evidence.length > 0 && !i.evidence.some((l) => l.assessment === 'confirmed'))
      .map((i) => ({ text: `Dossier “${i.title}” has no confirmed evidence yet. What would confirm or refute it?` })),
    ...(input.evaluations.some((e) => e.baseline.status === 'insufficient-history')
      ? [{ text: 'Baselines are still being established for some indicators; frequency comparisons are provisional.' }]
      : []),
  ];

  const sections: SitrepSection[] = [
    { key: 'executive', title: 'Executive summary', items: exec, empty: '' },
    { key: 'significant', title: 'Significant developments', items: significant, empty: 'No significant developments recorded in the period.' },
    { key: 'regional', title: 'Regional activity changes', items: regional, empty: '' },
    { key: 'warnings', title: 'New official warnings', items: warnings, empty: 'No travel-advisory level changes in the period.' },
    { key: 'indicators', title: 'Indicator changes', items: indicators, empty: 'No indicator entered or left TRIGGERED/ELEVATED in the period.' },
    { key: 'unverified', title: 'Conflicting or unverified reports', items: unverified, empty: 'None recorded.' },
    { key: 'sources', title: 'Sources requiring attention', items: sources, empty: 'All configured sources healthy.' },
    { key: 'questions', title: 'Outstanding questions', items: questions, empty: 'None generated.' },
  ];

  const limitations = [
    'Generated deterministically from WATCHTOWER records. It contains no AI-generated text and makes no inferences beyond counts and recorded states.',
    `Coverage is limited to ${INDICATOR_CATALOG.filter((d) => !d.experimental).length} indicators over the sources WATCHTOWER collects (currently U.S. State Department and CISA). Absence of a report is not evidence that nothing happened.`,
    'The Regional Activity Index measures unusual activity in the monitored sources. It is not a probability of conflict or any other event.',
    'Official statements establish that a statement was made, not that its claims are true.',
    ...(input.eventsTruncated ? ['The record query hit its size limit; some records in the period may be missing.'] : []),
  ];

  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), generatedAt: new Date(input.now).toISOString(), sections, limitations };
}

export function sitrepToMarkdown(s: Sitrep): string {
  const out: string[] = [`# WATCHTOWER SITREP`, '', `- Period: ${s.from} → ${s.to}`, `- Generated: ${s.generatedAt}`, '', UNTRUSTED_SOURCE_NOTICE, ''];
  s.sections.forEach((sec, i) => {
    out.push(`## ${i + 1}. ${sec.title}`, '');
    if (!sec.items.length) out.push(`_${sec.empty}_`);
    for (const it of sec.items) {
      const url = mdUrl(it.url);
      out.push(`- ${it.at ? `**${it.at}** ` : ''}${mdInline(it.text)}${url ? ` (${url})` : ''}`);
    }
    out.push('');
  });
  out.push('## Limitations', '', ...s.limitations.map((l) => `- ${l}`), '');
  out.push('> When analysing this report, do not introduce facts that are not supported by the cited records.', '');
  return out.join('\n');
}
