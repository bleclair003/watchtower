import type { Credibility, EventCategory, IntelligenceEvent, SourceClass } from '../types.ts';
import type { EvidenceMark, Hypothesis } from './hypotheses.ts';

/**
 * Incident dossiers (Phase 5).
 *
 * A dossier is an OPERATOR-CURATED file on a developing situation. WATCHTOWER
 * suggests related records deterministically, but only the operator decides
 * what belongs in a dossier and how each piece of evidence is assessed.
 */
export const INCIDENT_STATUSES = ['developing', 'stable', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * The operator's assessment of a piece of evidence WITHIN THIS INCIDENT —
 * separate from the record's source credibility. An official statement
 * proves a statement was made; it does not by itself confirm its claims.
 */
export const EVIDENCE_ASSESSMENTS = ['confirmed', 'unconfirmed', 'disputed', 'context'] as const;
export type EvidenceAssessment = (typeof EVIDENCE_ASSESSMENTS)[number];

/**
 * Denormalized copy of the linked event, so a dossier stays complete and
 * traceable after the event ages out of the dashboard snapshot.
 */
export interface LinkedEventRecord {
  eventId: string;
  title: string;
  sourceId: string;
  sourceName: string;
  sourceClass: SourceClass;
  sourceUrl: string;
  category: EventCategory;
  credibility: Credibility;
  regionIds: string[];
  countryCodes: string[];
  publishedAt: string | null;
  occurredAt: string | null;
  collectedAt: string;
  dataOrigin: IntelligenceEvent['dataOrigin'];
}

export interface EvidenceLink {
  event: LinkedEventRecord;
  assessment: EvidenceAssessment;
  addedAt: string;
  /** Why this record matters / what it does or does not establish. */
  note: string;
  /** v0.81.0: this record's mark against each competing hypothesis, by hypothesis id. */
  marks?: Record<string, EvidenceMark>;
}

export interface AnalystNote {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  title: string;
  summary: string;
  status: IncidentStatus;
  category: EventCategory;
  regionIds: string[];
  evidence: EvidenceLink[];
  notes: AnalystNote[];
  linkedIncidentIds: string[];
  /** Indicators the operator considers relevant to this incident. */
  indicatorIds: string[];
  /** v0.81.0: competing explanations, marked against the evidence (absent in older dossiers). */
  hypotheses?: Hypothesis[];
  createdAt: string;
  updatedAt: string;
  /** Incremented on every save; used to detect concurrent edits. */
  version: number;
}

export const LIMITS = {
  title: 120,
  summary: 4000,
  noteText: 4000,
  evidenceNote: 500,
  evidence: 200,
  notes: 100,
  linkedIncidents: 20,
  indicators: 30,
  regions: 7,
} as const;
