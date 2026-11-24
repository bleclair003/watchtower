import type { Condition } from '../indicators/conditions.ts';
import type { IndicatorState } from '../indicators/types.ts';

/**
 * Alerting domain model (Phase 4).
 *
 * Alert levels are WATCHTOWER application classifications — not official
 * government warning levels.
 */
export const ALERT_SEVERITIES = ['INFORMATION', 'ADVISORY', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * What makes a rule fire. Every trigger is edge-based, so an unchanged input
 * can never fire twice:
 *  - event:     a NEWLY COLLECTED event matches the condition (each event fires once)
 *  - indicator: an indicator TRANSITIONS INTO one of the listed states
 *  - rai:       a region's RAI CROSSES the threshold upward
 */
export type AlertTrigger =
  | { kind: 'event'; match: Condition }
  | { kind: 'indicator'; indicatorIds: string[]; states: IndicatorState[] }
  | { kind: 'rai'; regionId: string; atLeast: number };

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  severity: AlertSeverity;
  trigger: AlertTrigger;
  notify: { discord: boolean };
  /** After a Discord notification for this rule, further notifications are suppressed for this long. Alerts are still recorded. */
  cooldownMinutes: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * v0.67.0: what the owner or an editor thought of an alert, for the scorecard.
 *  - useful:          it mattered; you would want it again
 *  - irrelevant:      it was right but not worth an alert
 *  - false-positive:  it was wrong (the thing did not happen, or the text was misread)
 *  - miscategorised:  real and relevant, but the wrong kind or level
 */
export const FEEDBACK_VERDICTS = ['useful', 'irrelevant', 'false-positive', 'miscategorised'] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const FEEDBACK_LABEL: Record<FeedbackVerdict, string> = {
  useful: 'Useful',
  irrelevant: 'Irrelevant',
  'false-positive': 'False positive',
  miscategorised: 'Wrong category',
};
export const FEEDBACK_NOTE_MAX = 500;

export interface AlertFeedback {
  verdict: FeedbackVerdict;
  /** Optional free text; plain text only, at most FEEDBACK_NOTE_MAX characters. */
  note: string;
  at: string;
}

/**
 * v0.72.0: what happened to an alert that rested on a single media report.
 *  - corroborated: an independent origin (another publisher, not the same agency copy) reported it;
 *    a follow-up alert one level higher was made (`upgradeId`).
 *  - unconfirmed: no independent report within CORROBORATION_HOURS.
 * On the follow-up alert itself, `upgradeOf` names the original.
 */
export interface AlertCorroboration {
  status: 'corroborated' | 'unconfirmed';
  at: string;
  publishers: string[];
  /** Agencies or "near-identical text" that made outlets count as one origin. */
  sharedOrigins: string[];
  upgradeId?: string;
  upgradeOf?: string;
}
export const CORROBORATION_HOURS = 72;
export const nextSeverity = (s: AlertSeverity): AlertSeverity => ALERT_SEVERITIES[Math.min(ALERT_SEVERITIES.indexOf(s) + 1, ALERT_SEVERITIES.length - 1)];

export type DeliveryStatus =
  | 'sent'
  | 'failed'
  | 'suppressed-cooldown'
  | 'not-requested'
  | 'not-configured'
  | 'pending';

export interface AlertRecord {
  /** Deterministic: hash(ruleId, dedupeKey). Re-evaluating the same input yields the same id. */
  id: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  severity: AlertSeverity;
  title: string;
  body: string;
  regionIds: string[];
  /** Primary link for the alert (original source for event alerts). Empty when none. */
  url: string;
  evidenceEventIds: string[];
  /** What produced it: the event id, indicator transition, or RAI crossing. */
  dedupeKey: string;
  createdAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  dismissed: boolean;
  dismissedAt: string | null;
  delivery: { discord: DeliveryStatus; at: string | null; error: string | null };
  /** v0.67.0: the indicator catalog version in force when the alert was made (alerts from before have none). */
  catalogVersion?: number;
  /** v0.67.0: owner or editor verdict; absent or null until someone reviews it. */
  feedback?: AlertFeedback | null;
  /** v0.72.0: corroboration outcome (original alert) or link to the original (follow-up alert). */
  corroboration?: AlertCorroboration | null;
}

export interface AlertRuleProblem {
  ruleId: string;
  ruleName: string;
  problems: string[];
}
