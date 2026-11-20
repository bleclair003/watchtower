import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { IndicatorEvaluation, IndicatorTransition, RegionScore } from '../../shared/domain/indicators/types.ts';
import { evaluateRule, validateAlertRule } from '../../shared/domain/alerts/evaluate.ts';
import type { AlertRecord, AlertRule, AlertRuleProblem, DeliveryStatus } from '../../shared/domain/alerts/types.ts';
import { contentHash } from '../lib/hash.ts';
import type { CollectorStore } from '../store/types.ts';
import { buildDiscordPayload, sendDiscord } from './discord.ts';

export interface AlertingOptions {
  now: number;
  newEvents: IntelligenceEvent[];
  transitions: IndicatorTransition[];
  previousScores: RegionScore[];
  currentScores: RegionScore[];
  currentEvaluations: IndicatorEvaluation[];
  previousEvaluatedAt: string | null;
  /** Validated webhook URL, or null if not configured. */
  discordWebhookUrl: string | null;
  appUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface AlertingResult {
  activeRules: number;
  created: number;
  notificationsSent: number;
  problems: AlertRuleProblem[];
  errors: string[];
}

/**
 * Alert stage of a collection run:
 *   load rules → validate (invalid rules are skipped AND reported) → evaluate
 *   this run's changes → drop already-stored alerts (deterministic ids) →
 *   WRITE alerts first (status "pending") → notify Discord per rule, honouring
 *   cooldowns → record delivery outcome.
 * Writing before sending means a crash can leave an alert "pending" but can
 * never cause a duplicate notification for the same input.
 */
export async function runAlerting(store: CollectorStore, opts: AlertingOptions): Promise<AlertingResult> {
  const log = opts.log ?? (() => {});
  const nowIso = new Date(opts.now).toISOString();
  const result: AlertingResult = { activeRules: 0, created: 0, notificationsSent: 0, problems: [], errors: [] };

  const raw = await store.listAlertRules();
  const rules: AlertRule[] = [];
  for (const r of raw) {
    const problems = validateAlertRule(r);
    if (problems.length) {
      result.problems.push({ ruleId: String((r as { id?: unknown }).id ?? '?'), ruleName: String((r as { name?: unknown }).name ?? '?'), problems });
    } else if ((r as AlertRule).enabled) {
      rules.push(r as AlertRule);
    }
  }
  result.activeRules = rules.length;
  if (!rules.length) return result;

  const state = await store.getAlertingState();
  const lastNotified = { ...(state?.lastNotifiedAt ?? {}) };

  for (const rule of rules) {
    const candidates = evaluateRule(rule, {
      now: opts.now,
      newEvents: opts.newEvents,
      transitions: opts.transitions,
      previousScores: opts.previousScores,
      currentScores: opts.currentScores,
      currentEvaluations: opts.currentEvaluations,
      previousEvaluatedAt: opts.previousEvaluatedAt,
    });
    if (!candidates.length) continue;

    const withIds: AlertRecord[] = candidates.map((c) => ({
      ...c,
      id: contentHash('alert', rule.id, c.dedupeKey),
      acknowledged: false,
      acknowledgedAt: null,
      dismissed: false,
      dismissedAt: null,
      delivery: { discord: 'pending', at: null, error: null },
    }));
    const fresh = await store.filterNewAlertIds(withIds.map((a) => a.id));
    const alerts = withIds.filter((a) => fresh.has(a.id));
    if (!alerts.length) continue;

    // Decide delivery.
    let status: DeliveryStatus;
    const last = lastNotified[rule.id];
    if (!rule.notify.discord) status = 'not-requested';
    else if (!opts.discordWebhookUrl) status = 'not-configured';
    else if (last && opts.now - Date.parse(last) < rule.cooldownMinutes * 60_000) status = 'suppressed-cooldown';
    else status = 'pending';
    for (const a of alerts) a.delivery = { discord: status, at: status === 'pending' ? null : nowIso, error: null };

    await store.putAlerts(alerts);
    result.created += alerts.length;
    let outcome: DeliveryStatus = status;

    if (status === 'pending') {
      let delivery: AlertRecord['delivery'];
      try {
        await sendDiscord(opts.discordWebhookUrl!, buildDiscordPayload(rule, alerts, opts.appUrl), { fetchImpl: opts.fetchImpl, sleep: opts.sleep });
        delivery = { discord: 'sent', at: nowIso, error: null };
        outcome = 'sent';
        lastNotified[rule.id] = nowIso;
        result.notificationsSent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        delivery = { discord: 'failed', at: nowIso, error: message };
        outcome = 'failed';
        result.errors.push(`${rule.name}: ${message}`);
      }
      await store.updateAlertDelivery(alerts.map((a) => a.id), delivery);
    }
    log(`ALRT ${rule.name}: ${alerts.length} new alert(s) · discord ${outcome}`);
  }

  await store.putAlertingState({ lastNotifiedAt: lastNotified, updatedAt: nowIso });
  return result;
}
