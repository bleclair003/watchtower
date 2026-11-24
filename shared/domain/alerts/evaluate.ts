import type { IntelligenceEvent } from '../types.ts';
import { getRegion, WATCH_REGIONS } from '../regions.ts';
import { matches, validateCondition } from '../indicators/conditions.ts';
import { CATALOG_VERSION, getIndicator } from '../indicators/catalog.ts';
import type { IndicatorEvaluation, IndicatorState, IndicatorTransition, RegionScore } from '../indicators/types.ts';
import { ALERT_SEVERITIES, type AlertRecord, type AlertRule } from './types.ts';

export const MAX_RULE_NAME = 80;
export const MAX_COOLDOWN_MINUTES = 7 * 24 * 60;
export const MAX_ALERTS_PER_RULE_PER_RUN = 50;
const INDICATOR_STATES: IndicatorState[] = ['NORMAL', 'ELEVATED', 'TRIGGERED', 'UNKNOWN', 'DATA_UNAVAILABLE', 'DISABLED'];

/** Deep validation of a stored rule. Rules failing it are skipped and reported, never half-evaluated. */
export function validateAlertRule(rule: unknown): string[] {
  if (!rule || typeof rule !== 'object') return ['rule must be an object'];
  const r = rule as Partial<AlertRule>;
  const p: string[] = [];
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id)) p.push('invalid id');
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > MAX_RULE_NAME) p.push(`name must be 1–${MAX_RULE_NAME} characters`);
  if (typeof r.enabled !== 'boolean') p.push('enabled must be boolean');
  if (!ALERT_SEVERITIES.includes(r.severity as never)) p.push('unknown severity');
  if (!Number.isInteger(r.cooldownMinutes) || r.cooldownMinutes! < 0 || r.cooldownMinutes! > MAX_COOLDOWN_MINUTES) {
    p.push(`cooldown must be 0–${MAX_COOLDOWN_MINUTES} minutes`);
  }
  if (!r.notify || typeof r.notify.discord !== 'boolean') p.push('notify.discord must be boolean');
  const t = r.trigger as AlertRule['trigger'] | undefined;
  if (!t || typeof t !== 'object') {
    p.push('missing trigger');
  } else if (t.kind === 'event') {
    p.push(...validateCondition(t.match, 'trigger.match'));
  } else if (t.kind === 'indicator') {
    if (!Array.isArray(t.indicatorIds) || !t.indicatorIds.length) p.push('choose at least one indicator');
    else t.indicatorIds.filter((id) => !getIndicator(id)).forEach((id) => p.push(`unknown indicator ${id}`));
    if (!Array.isArray(t.states) || !t.states.length || t.states.some((s) => !INDICATOR_STATES.includes(s))) p.push('invalid indicator states');
  } else if (t.kind === 'rai') {
    if (!getRegion(t.regionId)) p.push(`unknown region ${String(t.regionId)}`);
    if (!Number.isInteger(t.atLeast) || t.atLeast < 1 || t.atLeast > 100) p.push('RAI threshold must be 1–100');
  } else {
    p.push(`unknown trigger kind ${String((t as { kind?: unknown }).kind)}`);
  }
  return p;
}

export interface AlertContext {
  now: number;
  /** Events imported in THIS run only. */
  newEvents: IntelligenceEvent[];
  /** Indicator state changes in THIS run only. */
  transitions: IndicatorTransition[];
  previousScores: RegionScore[];
  currentScores: RegionScore[];
  /** Current indicator states (used for rules created since the previous evaluation). */
  currentEvaluations?: IndicatorEvaluation[];
  /** When the previous evaluation ran; null if never. */
  previousEvaluatedAt?: string | null;
}

/**
 * A rule created after the previous evaluation has never "seen" the current
 * state, so its first evaluation treats current state as the crossing. This
 * fires once; later runs use normal edge detection. Dedupe keys are based on
 * when the state BEGAN, so a first-look alert and a later transition alert
 * for the same state cannot both fire.
 */
export function isFirstLook(rule: AlertRule, ctx: AlertContext): boolean {
  return !ctx.previousEvaluatedAt || rule.createdAt > ctx.previousEvaluatedAt;
}

export type AlertCandidate = Omit<AlertRecord, 'id' | 'acknowledged' | 'acknowledgedAt' | 'dismissed' | 'dismissedAt' | 'delivery' | 'feedback' | 'corroboration'>;

/**
 * Turns this run's CHANGES into alert candidates. Pure and edge-based: an
 * unchanged input never produces a candidate, and the caller assigns
 * deterministic ids so a repeated candidate cannot be stored twice.
 */
export function evaluateRule(rule: AlertRule, ctx: AlertContext): AlertCandidate[] {
  if (!rule.enabled) return [];
  const createdAt = new Date(ctx.now).toISOString();
  const base = { ruleId: rule.id, ruleName: rule.name, ruleVersion: rule.version, catalogVersion: CATALOG_VERSION, severity: rule.severity, createdAt };
  const t = rule.trigger;
  let out: AlertCandidate[] = [];

  if (t.kind === 'event') {
    out = ctx.newEvents
      .filter((e) => e.collectedAt >= rule.createdAt && matches(t.match, e))
      .map((e) => ({
        ...base,
        title: e.title,
        body: e.summary ?? '',
        regionIds: e.regionIds,
        url: e.sourceUrl,
        evidenceEventIds: [e.id],
        dedupeKey: `event:${e.contentHash}`,
      }));
  } else if (t.kind === 'indicator') {
    const entries: IndicatorTransition[] = isFirstLook(rule, ctx)
      ? (ctx.currentEvaluations ?? []).map((ev) => ({
          indicatorId: ev.indicatorId,
          regionId: ev.regionId,
          from: null,
          to: ev.state,
          at: ev.stateSince,
          reason: `${ev.reason} (state already in effect when the rule was created)`,
          evidenceEventIds: ev.evidenceEventIds,
          configVersion: ev.configVersion,
        }))
      : ctx.transitions;
    out = entries
      .filter((tr) => t.indicatorIds.includes(tr.indicatorId) && t.states.includes(tr.to) && tr.from !== tr.to)
      .map((tr) => {
        const def = getIndicator(tr.indicatorId);
        return {
          ...base,
          title: tr.from === null ? `${def?.name ?? tr.indicatorId}: ${tr.to}` : `${def?.name ?? tr.indicatorId}: ${tr.from} → ${tr.to}`,
          body: tr.reason,
          regionIds: [tr.regionId],
          url: '',
          evidenceEventIds: tr.evidenceEventIds.slice(0, 10),
          dedupeKey: `indicator:${tr.indicatorId}:${tr.to}:${tr.at}`,
        };
      });
  } else if (t.kind === 'rai') {
    const prev = isFirstLook(rule, ctx) ? null : (ctx.previousScores.find((s) => s.regionId === t.regionId)?.score ?? null);
    const cur = ctx.currentScores.find((s) => s.regionId === t.regionId);
    // Upward crossing only. A missing previous score (first evaluation, or N/E) is treated
    // as "below", so a region already above the threshold alerts once when it first becomes evaluable.
    if (cur?.score !== null && cur && cur.score >= t.atLeast && (prev === null || prev < t.atLeast)) {
      const region = WATCH_REGIONS.find((r) => r.id === t.regionId);
      out = [
        {
          ...base,
          title: `${region?.name ?? t.regionId}: RAI ${cur.score} (${cur.band}) crossed ${t.atLeast}`,
          body: `Regional Activity Index rose from ${prev ?? 'N/E'} to ${cur.score}. Coverage ${Math.round(cur.coverage * 100)}%. Active: ${
            cur.contributions.filter((c) => c.applied > 0).map((c) => c.name).join('; ') || 'none'
          }. The RAI measures unusual activity in monitored sources; it is not a probability.`,
          regionIds: [t.regionId],
          url: '',
          evidenceEventIds: [],
          dedupeKey: `rai:${t.regionId}:${t.atLeast}:${cur.evaluatedAt}`,
        },
      ];
    }
  }
  return out.slice(0, MAX_ALERTS_PER_RULE_PER_RUN);
}

/**
 * Test mode: what WOULD this rule match against currently loaded data? Uses
 * recent events (instead of only new ones) and current states (instead of
 * transitions). Never creates alerts or sends notifications.
 */
export function previewRule(
  rule: AlertRule,
  data: { events: IntelligenceEvent[]; evaluations: IndicatorEvaluation[]; scores: RegionScore[]; now: number; lookbackHours: number },
): { matches: string[]; note: string } {
  const t = rule.trigger;
  if (t.kind === 'event') {
    const since = data.now - data.lookbackHours * 3_600_000;
    const hits = data.events.filter((e) => Date.parse(e.publishedAt ?? e.collectedAt) >= since && matches(t.match, e));
    return { matches: hits.map((e) => e.title), note: `Events in the last ${data.lookbackHours} h that match. Live, each NEW event matching fires once.` };
  }
  if (t.kind === 'indicator') {
    const hits = data.evaluations.filter((e) => t.indicatorIds.includes(e.indicatorId) && t.states.includes(e.state));
    return {
      matches: hits.map((e) => `${getIndicator(e.indicatorId)?.name ?? e.indicatorId} is ${e.state}`),
      note: 'Indicators currently in the selected states. Live, the rule fires when an indicator ENTERS one of them.',
    };
  }
  const s = data.scores.find((x) => x.regionId === t.regionId);
  return {
    matches: s?.score !== null && s && s.score >= t.atLeast ? [`${t.regionId} RAI is ${s.score} (≥ ${t.atLeast})`] : [],
    note: `Current RAI ${s?.score ?? 'N/E'}. Live, the rule fires when the RAI CROSSES ${t.atLeast} upward.`,
  };
}
