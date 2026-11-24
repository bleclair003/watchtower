import { creditedAgencies } from '../stories/stories.ts';
import type { EvidenceLink, Incident } from './types.ts';

/**
 * Competing hypotheses (v0.81.0): Analysis of Competing Hypotheses (Heuer) inside a dossier.
 *
 * The operator lists a few explanations and marks each piece of evidence against each one: very consistent
 * (CC), consistent (C), neutral or not applicable (N), inconsistent (I), very inconsistent (II). The board
 * ranks explanations by the evidence AGAINST them, not for them: the explanation with the least
 * inconsistent evidence is the strongest, because consistent evidence is often consistent with several.
 *
 * Honesty rules:
 *  - one origin counts once: marks from records with the same origin (the same agency credited, or else
 *    the same source) are not added up; the origin's strongest mark counts;
 *  - evidence marked the same for every explanation is not diagnostic and is listed as such;
 *  - the ranking is recomputed from evidence assessed "confirmed" only, and a change in the leader is shown;
 *  - inconsistency that rests on unconfirmed or disputed evidence, or on single-source, unverified or
 *    experimental records, is counted separately.
 */

export const MARKS = ['CC', 'C', 'N', 'I', 'II'] as const;
export type Mark = (typeof MARKS)[number];
export const MARK_LABEL: Record<Mark, string> = {
  CC: 'Very consistent',
  C: 'Consistent',
  N: 'Neutral / not applicable',
  I: 'Inconsistent',
  II: 'Very inconsistent',
};
const AGAINST: Record<Mark, number> = { CC: 0, C: 0, N: 0, I: 1, II: 2 };
const FOR: Record<Mark, number> = { CC: 2, C: 1, N: 0, I: 0, II: 0 };

export interface Hypothesis {
  id: string;
  label: string;
  note: string;
}
export interface EvidenceMark {
  m: Mark;
  /** One line: why this record fits or does not fit the explanation. */
  why: string;
}

export const HYPOTHESIS_LIMITS = { hypotheses: 8, label: 120, note: 500, why: 200 } as const;

export function newHypothesisId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Records with the same origin: the first credited agency (AP, Reuters, TASS…), else the source. */
export function originOf(l: EvidenceLink): string {
  const agency = creditedAgencies({ title: l.event.title, summary: '' })[0];
  return agency ? `agency:${agency}` : `source:${l.event.sourceId}`;
}

const isWeak = (l: EvidenceLink) =>
  l.assessment === 'unconfirmed' || l.assessment === 'disputed' || ['single-source', 'unverified', 'experimental'].includes(l.event.credibility);

export interface HypothesisScore {
  id: string;
  label: string;
  /** Weighted evidence against (I = 1, II = 2), one origin counted once. */
  against: number;
  /** Of which from weak evidence (unconfirmed, disputed, single-source, unverified, experimental). */
  againstWeak: number;
  /** Weighted evidence for (C = 1, CC = 2), one origin counted once. */
  support: number;
  /** Records marked against this explanation at all (any mark). */
  marked: number;
}

function scoreOne(h: Hypothesis, evidence: EvidenceLink[]): HypothesisScore {
  const byOrigin = new Map<string, { against: number; weak: boolean; support: number }>();
  let marked = 0;
  for (const l of evidence) {
    const mark = l.marks?.[h.id]?.m;
    if (!mark) continue;
    marked++;
    const o = originOf(l);
    const cur = byOrigin.get(o) ?? { against: 0, weak: true, support: 0 };
    const a = AGAINST[mark];
    if (a > cur.against) {
      cur.against = a;
      cur.weak = isWeak(l);
    } else if (a === cur.against && a > 0 && !isWeak(l)) cur.weak = false;
    cur.support = Math.max(cur.support, FOR[mark]);
    byOrigin.set(o, cur);
  }
  let against = 0;
  let againstWeak = 0;
  let support = 0;
  for (const v of byOrigin.values()) {
    against += v.against;
    if (v.weak) againstWeak += v.against;
    support += v.support;
  }
  return { id: h.id, label: h.label, against, againstWeak, support, marked };
}

const rank = (scores: HypothesisScore[]) =>
  [...scores].sort((a, b) => a.against - b.against || b.support - a.support || a.label.localeCompare(b.label));

export interface Board {
  /** Least evidence against first. */
  ranking: HypothesisScore[];
  /** The same from evidence assessed "confirmed" only. */
  confirmedRanking: HypothesisScore[];
  /** True when the leader differs on confirmed evidence only (and both leaders are clear). */
  leaderChangesOnConfirmed: boolean;
  /** True when the top two are tied on evidence against. */
  tied: boolean;
  /** Evidence ids marked for two or more explanations, all with the same mark: does not help choose. */
  notDiagnostic: string[];
  /** Evidence ids not marked for any explanation. */
  unmarked: string[];
  /** Origins grouping two or more records, so they counted once: origin → record count. */
  sharedOrigins: [string, number][];
}

export function buildBoard(incident: Pick<Incident, 'evidence' | 'hypotheses'>): Board {
  const hs = incident.hypotheses ?? [];
  const evidence = incident.evidence;
  const ranking = rank(hs.map((h) => scoreOne(h, evidence)));
  const confirmedRanking = rank(hs.map((h) => scoreOne(h, evidence.filter((l) => l.assessment === 'confirmed'))));
  const clear = (r: HypothesisScore[]) => r.length >= 2 && r[0].against < r[1].against;
  const notDiagnostic: string[] = [];
  const unmarked: string[] = [];
  for (const l of evidence) {
    const marks = hs.map((h) => l.marks?.[h.id]?.m).filter((m): m is Mark => !!m);
    if (!marks.length) unmarked.push(l.event.eventId);
    else if (hs.length >= 2 && marks.length >= 2 && marks.every((m) => m === marks[0])) notDiagnostic.push(l.event.eventId);
  }
  const origins = new Map<string, number>();
  for (const l of evidence) if (hs.some((h) => l.marks?.[h.id])) origins.set(originOf(l), (origins.get(originOf(l)) ?? 0) + 1);
  return {
    ranking,
    confirmedRanking,
    leaderChangesOnConfirmed: clear(ranking) && clear(confirmedRanking) && ranking[0].id !== confirmedRanking[0].id,
    tied: ranking.length >= 2 && ranking[0].against === ranking[1].against,
    notDiagnostic,
    unmarked,
    sharedOrigins: [...origins.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]),
  };
}

/** Validation of the hypotheses and marks in a dossier (called from validateIncident). */
export function validateHypotheses(i: Partial<Incident>): string[] {
  const p: string[] = [];
  const hs = i.hypotheses;
  if (hs === undefined) return p;
  if (!Array.isArray(hs) || hs.length > HYPOTHESIS_LIMITS.hypotheses) return [`at most ${HYPOTHESIS_LIMITS.hypotheses} hypotheses`];
  const ids = new Set<string>();
  hs.forEach((h, k) => {
    if (!h || typeof h.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(h.id) || ids.has(h.id)) p.push(`hypotheses[${k}]: invalid id`);
    else ids.add(h.id);
    if (typeof h?.label !== 'string' || !h.label.trim() || h.label.length > HYPOTHESIS_LIMITS.label) p.push(`hypotheses[${k}]: label must be 1–${HYPOTHESIS_LIMITS.label} characters`);
    if (typeof h?.note !== 'string' || h.note.length > HYPOTHESIS_LIMITS.note) p.push(`hypotheses[${k}]: note too long`);
  });
  (i.evidence ?? []).forEach((l, n) => {
    if (l?.marks === undefined) return;
    if (!l.marks || typeof l.marks !== 'object' || Array.isArray(l.marks)) return p.push(`evidence[${n}]: invalid marks`);
    for (const [hid, mk] of Object.entries(l.marks)) {
      if (!ids.has(hid)) p.push(`evidence[${n}]: mark for an unknown hypothesis`);
      else if (!mk || !MARKS.includes(mk.m) || typeof mk.why !== 'string' || mk.why.length > HYPOTHESIS_LIMITS.why) p.push(`evidence[${n}]: invalid mark`);
    }
  });
  return p;
}

/** Removes a hypothesis and every mark made against it. */
export function removeHypothesis<T extends Pick<Incident, 'evidence' | 'hypotheses'>>(incident: T, id: string): T {
  return {
    ...incident,
    hypotheses: (incident.hypotheses ?? []).filter((h) => h.id !== id),
    evidence: incident.evidence.map((l) => {
      if (!l.marks?.[id]) return l;
      const { [id]: _gone, ...rest } = l.marks;
      return { ...l, marks: rest };
    }),
  };
}

/** Sets (or, with null, clears) one record's mark against one explanation. */
export function setMark<T extends Pick<Incident, 'evidence'>>(incident: T, eventId: string, hypothesisId: string, mark: EvidenceMark | null): T {
  return {
    ...incident,
    evidence: incident.evidence.map((l) => {
      if (l.event.eventId !== eventId) return l;
      const marks = { ...(l.marks ?? {}) };
      if (mark) marks[hypothesisId] = mark;
      else delete marks[hypothesisId];
      return { ...l, marks };
    }),
  };
}
