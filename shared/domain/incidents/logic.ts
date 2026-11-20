import type { IntelligenceEvent } from '../types.ts';
import { EVENT_CATEGORIES } from '../types.ts';
import { getRegion } from '../regions.ts';
import { getIndicator } from '../indicators/catalog.ts';
import {
  EVIDENCE_ASSESSMENTS,
  INCIDENT_STATUSES,
  LIMITS,
  type EvidenceLink,
  type Incident,
  type LinkedEventRecord,
} from './types.ts';

// ---------------------------------------------------------------- records --

export function toLinkedEvent(e: IntelligenceEvent): LinkedEventRecord {
  return {
    eventId: e.id,
    title: e.title,
    sourceId: e.sourceId,
    sourceName: e.sourceName,
    sourceClass: e.sourceClass,
    sourceUrl: e.sourceUrl,
    category: e.category,
    credibility: e.credibility,
    regionIds: [...e.regionIds],
    countryCodes: [...e.countryCodes],
    publishedAt: e.publishedAt,
    occurredAt: e.occurredAt ?? null,
    collectedAt: e.collectedAt,
    dataOrigin: e.dataOrigin,
  };
}

export function newIncidentId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/** A new dossier, optionally seeded from one event. */
export function createIncident(now: string, seed?: IntelligenceEvent): Incident {
  return {
    id: newIncidentId(),
    title: seed ? seed.title.replace(/^\[SIMULATED\]\s*/, '').slice(0, LIMITS.title) : 'Untitled incident',
    summary: '',
    status: 'developing',
    category: seed?.category ?? 'official',
    regionIds: seed ? seed.regionIds.filter((r) => getRegion(r)).slice(0, LIMITS.regions) : [],
    evidence: seed ? [{ event: toLinkedEvent(seed), assessment: 'unconfirmed', addedAt: now, note: '' }] : [],
    notes: [],
    linkedIncidentIds: [],
    indicatorIds: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** Adds evidence unless already linked (by event id). Returns the same object if nothing changed. */
export function addEvidence(incident: Incident, e: IntelligenceEvent, now: string): Incident {
  if (incident.evidence.some((l) => l.event.eventId === e.id)) return incident;
  if (incident.evidence.length >= LIMITS.evidence) throw new Error(`A dossier holds at most ${LIMITS.evidence} evidence records.`);
  return { ...incident, evidence: [...incident.evidence, { event: toLinkedEvent(e), assessment: 'unconfirmed', addedAt: now, note: '' }] };
}

// ------------------------------------------------------------- validation --

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const isStr = (v: unknown, max: number, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;

/** Full validation (Firestore rules check the outer shape; this checks everything). */
export function validateIncident(x: unknown): string[] {
  if (!x || typeof x !== 'object') return ['incident must be an object'];
  const i = x as Partial<Incident>;
  const p: string[] = [];
  if (typeof i.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(i.id)) p.push('invalid id');
  if (!isStr(i.title, LIMITS.title, 1) || !i.title!.trim()) p.push(`title must be 1–${LIMITS.title} characters`);
  if (!isStr(i.summary, LIMITS.summary)) p.push(`summary must be at most ${LIMITS.summary} characters`);
  if (!INCIDENT_STATUSES.includes(i.status as never)) p.push('invalid status');
  if (!EVENT_CATEGORIES.includes(i.category as never)) p.push('invalid category');
  if (!Array.isArray(i.regionIds) || i.regionIds.length > LIMITS.regions || i.regionIds.some((r) => !getRegion(r))) p.push('invalid regions');
  if (!Array.isArray(i.evidence) || i.evidence.length > LIMITS.evidence) p.push(`at most ${LIMITS.evidence} evidence records`);
  else {
    const seen = new Set<string>();
    i.evidence.forEach((l, n) => {
      if (!l || !l.event || typeof l.event.eventId !== 'string') return p.push(`evidence[${n}]: missing event`);
      if (seen.has(l.event.eventId)) p.push(`evidence[${n}]: duplicate event`);
      seen.add(l.event.eventId);
      if (!EVIDENCE_ASSESSMENTS.includes(l.assessment)) p.push(`evidence[${n}]: invalid assessment`);
      if (!isStr(l.note, LIMITS.evidenceNote)) p.push(`evidence[${n}]: note too long`);
      if (!isStr(l.event.title, 400, 1)) p.push(`evidence[${n}]: missing title`);
    });
  }
  if (!Array.isArray(i.notes) || i.notes.length > LIMITS.notes) p.push(`at most ${LIMITS.notes} notes`);
  else i.notes.forEach((n, k) => !isStr(n?.text, LIMITS.noteText, 1) && p.push(`notes[${k}]: text must be 1–${LIMITS.noteText} characters`));
  if (!Array.isArray(i.linkedIncidentIds) || i.linkedIncidentIds.length > LIMITS.linkedIncidents || i.linkedIncidentIds.includes(i.id as string)) {
    p.push('invalid linked incidents');
  }
  if (!Array.isArray(i.indicatorIds) || i.indicatorIds.length > LIMITS.indicators || i.indicatorIds.some((id) => !getIndicator(id))) {
    p.push('invalid indicators');
  }
  if (!isStr(i.createdAt, 40) || !ISO.test(i.createdAt!) || !isStr(i.updatedAt, 40) || !ISO.test(i.updatedAt!)) p.push('invalid timestamps');
  if (!Number.isInteger(i.version) || i.version! < 1) p.push('invalid version');
  return p;
}

// --------------------------------------------------------------- timeline --

export type TimelineBasis = 'occurred' | 'published' | 'collected';

export interface TimelineEntry {
  link: EvidenceLink;
  /** The time used for ordering (falls back when the chosen basis is unknown). */
  at: string;
  basisUsed: TimelineBasis;
  /** Hours between publication and WATCHTOWER collection (null if unknown). */
  collectionLagHours: number | null;
  /** Hours between reported occurrence and publication (null if unknown). */
  reportingLagHours: number | null;
}

const hoursBetween = (a: string | null, b: string | null) =>
  a && b ? Math.round(((Date.parse(b) - Date.parse(a)) / 3_600_000) * 10) / 10 : null;

/**
 * Chronology that keeps the three times distinct (PDD §9.2): when the event
 * reportedly happened, when the source published, when WATCHTOWER collected.
 * Entries whose chosen time is unknown fall back to the next-best time and
 * say so — they are never silently placed at an invented moment.
 */
export function buildTimeline(evidence: EvidenceLink[], basis: TimelineBasis): TimelineEntry[] {
  return evidence
    .map((link) => {
      const e = link.event;
      const order: TimelineBasis[] =
        basis === 'occurred' ? ['occurred', 'published', 'collected'] : basis === 'published' ? ['published', 'collected'] : ['collected'];
      const pick = (b: TimelineBasis) => (b === 'occurred' ? e.occurredAt : b === 'published' ? e.publishedAt : e.collectedAt);
      const basisUsed = order.find((b) => pick(b)) ?? 'collected';
      return {
        link,
        at: pick(basisUsed) ?? e.collectedAt,
        basisUsed,
        collectionLagHours: hoursBetween(e.publishedAt, e.collectedAt),
        reportingLagHours: hoursBetween(e.occurredAt, e.publishedAt),
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.link.event.eventId.localeCompare(b.link.event.eventId));
}

// ------------------------------------------------------- related records --

const STOP = new Set(
  // Generic words plus feed boilerplate (advisory level labels, KEV/ICS prefixes) that would otherwise link unrelated records.
  ('the a an of to in on for and or by with from at as is are was were be this that it its into over after before not do does ' +
    'level travel advisory reissued unchanged raised lowered new exercise normal precautions increased caution reconsider ' +
    'cisa kev added ics simulated').split(' '),
);

export function titleTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export interface RelatedSuggestion {
  event: IntelligenceEvent;
  score: number;
  reasons: string[];
}

/**
 * Deterministic relatedness, explainable by its reasons: shared title terms
 * (Jaccard), shared country, shared region, same category, and time proximity
 * to the dossier's evidence. No machine learning; every suggestion says why.
 */
export function suggestRelated(incident: Incident, candidates: IntelligenceEvent[], limit = 15): RelatedSuggestion[] {
  const linked = new Set(incident.evidence.map((l) => l.event.eventId));
  const tokens = new Set<string>();
  for (const t of [incident.title, ...incident.evidence.map((l) => l.event.title)]) titleTokens(t).forEach((w) => tokens.add(w));
  const countries = new Set(incident.evidence.flatMap((l) => l.event.countryCodes));
  const regions = new Set([...incident.regionIds, ...incident.evidence.flatMap((l) => l.event.regionIds)]);
  const times = incident.evidence.map((l) => Date.parse(l.event.publishedAt ?? l.event.collectedAt));

  const out: RelatedSuggestion[] = [];
  for (const e of candidates) {
    if (linked.has(e.id)) continue;
    const reasons: string[] = [];
    let score = 0;
    const et = titleTokens(e.title);
    const shared = [...et].filter((w) => tokens.has(w));
    if (shared.length) {
      const jaccard = shared.length / new Set([...et, ...tokens]).size;
      score += 3 * jaccard + 0.5 * Math.min(shared.length, 4);
      reasons.push(`shared terms: ${shared.slice(0, 4).join(', ')}`);
    }
    const cc = e.countryCodes.filter((c) => countries.has(c));
    if (cc.length) {
      score += 1.5;
      reasons.push(`same country: ${cc.join(', ')}`);
    }
    const rr = e.regionIds.filter((r) => regions.has(r));
    if (rr.length) {
      score += 1;
      reasons.push(`same region: ${rr.map((r) => getRegion(r)?.shortCode ?? r).join(', ')}`);
    }
    if (e.category === incident.category) score += 0.5;
    if (times.length) {
      const t = Date.parse(e.publishedAt ?? e.collectedAt);
      const nearest = Math.min(...times.map((x) => Math.abs(x - t))) / 86_400_000;
      if (nearest <= 3) {
        score += 1 - nearest / 3;
        reasons.push(`within ${Math.max(1, Math.round(nearest))} d of linked evidence`);
      }
    }
    // Require a substantive link (terms or country), not just same region/time.
    if (shared.length || cc.length) out.push({ event: e, score: Math.round(score * 100) / 100, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.event.id.localeCompare(b.event.id)).slice(0, limit);
}

// ----------------------------------------------------------------- export --

const ASSESSMENT_LABEL = { confirmed: 'CONFIRMED', unconfirmed: 'UNCONFIRMED', disputed: 'DISPUTED', context: 'CONTEXT' } as const;

/**
 * Markdown evidence packet for an incident — suitable for pasting into Claude
 * (PDD §12.2 "Export Intelligence Context"). Contains only recorded evidence and
 * operator notes, each with its source link, plus explicit analytical caveats.
 */
export function incidentToMarkdown(incident: Incident, exportedAt: string): string {
  const lines: string[] = [];
  const timeline = buildTimeline(incident.evidence, 'occurred');
  lines.push(`# WATCHTOWER dossier: ${incident.title}`, '');
  lines.push(`- Status: ${incident.status.toUpperCase()}`);
  lines.push(`- Regions: ${incident.regionIds.map((r) => getRegion(r)?.name ?? r).join(', ') || 'none'}`);
  lines.push(`- Category: ${incident.category}`);
  lines.push(`- Opened: ${incident.createdAt} · Updated: ${incident.updatedAt} · Exported: ${exportedAt}`);
  lines.push(`- Evidence records: ${incident.evidence.length}`, '');
  lines.push('> Analytical caveats: an official statement establishes that a statement was made, not that its claims are true.');
  lines.push('> Assessments below are the operator’s, not the sources’. Do not introduce facts not supported by the cited records.', '');
  if (incident.summary.trim()) lines.push('## Operator summary', '', incident.summary.trim(), '');
  lines.push('## Timeline (by reported occurrence; falls back to publication, then collection)', '');
  for (const t of timeline) {
    const e = t.link.event;
    lines.push(
      `- **${t.at}** (${t.basisUsed}) · [${ASSESSMENT_LABEL[t.link.assessment]}] ${e.title}`,
      `  - Source: ${e.sourceName} (${e.sourceClass}, credibility: ${e.credibility})${e.sourceUrl ? ` — ${e.sourceUrl}` : ''}`,
      `  - Occurred: ${e.occurredAt ?? 'not stated'} · Published: ${e.publishedAt ?? 'not stated'} · Collected: ${e.collectedAt}`,
      ...(e.dataOrigin !== 'live' ? [`  - Data origin: ${e.dataOrigin.toUpperCase()} (not live collection)`] : []),
      ...(t.link.note.trim() ? [`  - Operator note: ${t.link.note.trim()}`] : []),
    );
  }
  if (!timeline.length) lines.push('_No evidence linked._');
  lines.push('');
  if (incident.notes.length) {
    lines.push('## Analyst notes', '');
    for (const n of [...incident.notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) lines.push(`- ${n.createdAt}: ${n.text.trim()}`);
    lines.push('');
  }
  if (incident.indicatorIds.length) {
    lines.push('## Related indicators', '', ...incident.indicatorIds.map((id) => `- ${getIndicator(id)?.name ?? id} (${id})`), '');
  }
  return lines.join('\n');
}
