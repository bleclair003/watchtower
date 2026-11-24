import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { IndicatorEvaluation, IndicatorTransition, RegionScore } from '../../shared/domain/indicators/types.ts';
import { evaluateRule, validateAlertRule, type AlertCandidate } from '../../shared/domain/alerts/evaluate.ts';
import { WATCHLIST_LIMITS, compileWatchlist, validateWatchlist, type Watchlist } from '../../shared/domain/watchlist.ts';
import { CORROBORATION_HOURS, nextSeverity, type AlertRecord, type AlertRule, type AlertRuleProblem, type DeliveryStatus } from '../../shared/domain/alerts/types.ts';
import { STORY_SOURCES, WINDOW_HOURS, buildStories, type Story } from '../../shared/domain/stories/stories.ts';
import { CATALOG_VERSION } from '../../shared/domain/indicators/catalog.ts';
import { watchlistsThatAlert } from '../../shared/domain/members.ts';
import { describeShape, fromStored, recordInArea, validateWatchArea, WATCH_AREA_LIMITS } from '../../shared/domain/watchAreas.ts';
import { contentHash } from '../lib/hash.ts';
import type { CollectorStore, WatchedAlert } from '../store/types.ts';
import { buildDiscordPayload, sendDiscord } from './discord.ts';

export interface AlertingOptions {
  now: number;
  newEvents: IntelligenceEvent[];
  transitions: IndicatorTransition[];
  previousScores: RegionScore[];
  currentScores: RegionScore[];
  currentEvaluations: IndicatorEvaluation[];
  previousEvaluatedAt: string | null;
  /** Records loaded for this run (v0.72.0): stories are rebuilt from them to check corroboration. */
  recentEvents?: IntelligenceEvent[];
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
  /** v0.72.0: follow-up alerts made because an independent origin reported, and alerts marked unconfirmed. */
  corroborated: number;
  unconfirmed: number;
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
/** A label for public run logs that does not reveal the rule's name or a watchlist term. */
export function publicRuleLabel(ruleId: string): string {
  return `${ruleId.startsWith('watch-') ? 'watchlist item' : ruleId.startsWith('warea-') ? 'watch area' : 'rule'} ${contentHash('log-label', ruleId).slice(0, 6)}`;
}

export async function runAlerting(store: CollectorStore, opts: AlertingOptions): Promise<AlertingResult> {
  const log = opts.log ?? (() => {});
  const nowIso = new Date(opts.now).toISOString();
  const result: AlertingResult = { activeRules: 0, created: 0, notificationsSent: 0, corroborated: 0, unconfirmed: 0, problems: [], errors: [] };

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
  const jobs: { rule: AlertRule; candidates: AlertCandidate[] }[] = rules.map((rule) => ({
    rule,
    candidates: evaluateRule(rule, {
      now: opts.now,
      newEvents: opts.newEvents,
      transitions: opts.transitions,
      previousScores: opts.previousScores,
      currentScores: opts.currentScores,
      currentEvaluations: opts.currentEvaluations,
      previousEvaluatedAt: opts.previousEvaluatedAt,
    }),
  }));

  // Watchlist items marked "alert": one alert per new record that names them.
  try {
    // Only the owner's and editors' watchlists alert (viewers' lists highlight in their own view only).
    const [watchlists, members] = await Promise.all([store.listWatchlists(), store.listMembers()]);
    for (const { data: raw } of watchlistsThatAlert(watchlists, members)) {
      const problems = validateWatchlist(raw);
      if (problems.length) {
        result.problems.push({ ruleId: 'watchlist', ruleName: 'Watchlist', problems });
        continue;
      }
      const list = raw as Watchlist;
      const alerting = list.items.filter((i) => i.alert);
      if (!alerting.length) continue;
      const match = compileWatchlist(alerting);
      const hits = opts.newEvents.map((e) => ({ e, hits: match(e) })).filter((x) => x.hits.length);
      for (const item of alerting) {
        const rule: AlertRule = {
          id: `watch-${item.id}`,
          name: `Watchlist: ${item.term}`.slice(0, 80),
          enabled: true,
          severity: item.severity,
          trigger: { kind: 'event', match: { field: 'title', op: 'contains', value: item.term } },
          notify: { discord: true },
          cooldownMinutes: WATCHLIST_LIMITS.cooldownMinutes,
          version: 1,
          createdAt: item.createdAt,
          updatedAt: list.updatedAt,
        };
        const nowIso2 = new Date(opts.now).toISOString();
        const candidates: AlertCandidate[] = hits
          .filter((x) => x.e.collectedAt >= item.createdAt && x.hits.some((h) => h.item.id === item.id))
          .map(({ e, hits: h }) => ({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleVersion: 1,
            severity: item.severity,
            createdAt: nowIso2,
            title: e.title,
            body: `Watchlist ${item.kind} "${item.term}" named as "${h.find((x) => x.item.id === item.id)!.matched}". ${e.summary ?? ''}`.trim(),
            regionIds: e.regionIds,
            url: e.sourceUrl,
            evidenceEventIds: [e.id],
            dedupeKey: `event:${e.contentHash}`,
          }));
        jobs.push({ rule, candidates });
      }
      result.activeRules += alerting.length;
    }
  } catch (err) {
    result.errors.push(`watchlist: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Watch areas (v0.74.0): one alert per new exactly located record inside an area with its alert on.
  try {
    for (const raw of await store.listWatchAreas()) {
      const area = fromStored(raw);
      const problems = validateWatchArea(area);
      if (problems.length) {
        result.problems.push({ ruleId: `warea-${String((raw as { id?: unknown }).id ?? '?')}`, ruleName: 'Watch area', problems });
        continue;
      }
      if (!area.alert.enabled) continue;
      const rule: AlertRule = {
        id: `warea-${area.id}`,
        name: `Area: ${area.name}`.slice(0, 80),
        enabled: true,
        severity: area.alert.severity,
        trigger: { kind: 'event', match: { field: 'category', op: 'exists', value: true } },
        notify: { discord: area.alert.discord },
        cooldownMinutes: WATCH_AREA_LIMITS.cooldownMinutes,
        version: area.version,
        createdAt: area.createdAt,
        updatedAt: area.updatedAt,
      };
      const candidates: AlertCandidate[] = opts.newEvents
        .filter((e) => e.collectedAt >= area.createdAt && recordInArea(area, e))
        .map((e) => ({
          ruleId: rule.id,
          ruleName: rule.name,
          ruleVersion: area.version,
          severity: area.alert.severity,
          createdAt: nowIso,
          title: e.title,
          body: `Inside watch area "${area.name}" (${describeShape(area.shape)}). ${e.summary ?? ''}`.trim(),
          regionIds: e.regionIds,
          url: e.sourceUrl,
          evidenceEventIds: [e.id],
          dedupeKey: `event:${e.contentHash}`,
        }));
      jobs.push({ rule, candidates });
      result.activeRules++;
    }
  } catch (err) {
    result.errors.push(`watch areas: ${err instanceof Error ? err.message : String(err)}`);
  }
  result.activeRules += rules.length;

  const state = await store.getAlertingState();
  const lastNotified = { ...(state?.lastNotifiedAt ?? {}) };
  const watching: WatchedAlert[] = [...(state?.watching ?? [])];
  const newById = new Map(opts.newEvents.map((e) => [e.id, e]));

  /** Writes alerts first, then notifies Discord once for the batch, honouring the rule's cooldown. */
  const deliver = async (rule: Pick<AlertRule, 'id' | 'name' | 'notify' | 'cooldownMinutes' | 'severity'>, alerts: AlertRecord[], ignoreCooldown = false): Promise<void> => {
    let status: DeliveryStatus;
    const last = lastNotified[rule.id];
    if (!rule.notify.discord) status = 'not-requested';
    else if (!opts.discordWebhookUrl) status = 'not-configured';
    else if (!ignoreCooldown && last && opts.now - Date.parse(last) < rule.cooldownMinutes * 60_000) status = 'suppressed-cooldown';
    else status = 'pending';
    for (const a of alerts) a.delivery = { discord: status, at: status === 'pending' ? null : nowIso, error: null };

    await store.putAlerts(alerts);
    result.created += alerts.length;
    let outcome: DeliveryStatus = status;

    if (status === 'pending') {
      let delivery: AlertRecord['delivery'];
      try {
        await sendDiscord(opts.discordWebhookUrl!, buildDiscordPayload(rule as AlertRule, alerts, opts.appUrl), { fetchImpl: opts.fetchImpl, sleep: opts.sleep });
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
    // Run logs are public (public repository): never print rule names or watchlist terms.
    log(`ALRT ${publicRuleLabel(rule.id)}: ${alerts.length} new alert(s) · discord ${outcome}`);
  };

  for (const { rule, candidates } of jobs) {
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
    await deliver(rule, alerts);

    // v0.72.0: alerts resting on one media report are watched for an independent report.
    for (const a of alerts) {
      const e = a.evidenceEventIds.length === 1 ? newById.get(a.evidenceEventIds[0]) : undefined;
      if (!e || !STORY_SOURCES.has(e.sourceId) || e.sourceClass !== 'media') continue;
      watching.push({
        alertId: a.id, ruleId: rule.id, ruleName: rule.name, ruleVersion: a.ruleVersion, severity: a.severity, eventId: e.id, title: a.title,
        regionIds: a.regionIds, url: a.url, createdAt: a.createdAt, notifyDiscord: rule.notify.discord, cooldownMinutes: rule.cooldownMinutes,
      });
    }
  }

  // v0.72.0: corroboration. Stories are rebuilt from the loaded records each run; an alert whose report
  // gained an independent origin gets a follow-up one level higher, once; after 72 hours without one it
  // is marked unconfirmed.
  const stillWatching: WatchedAlert[] = [];
  if (watching.length) {
    const since = opts.now - (CORROBORATION_HOURS + WINDOW_HOURS) * 3_600_000;
    const news = (opts.recentEvents ?? []).filter((e) => STORY_SOURCES.has(e.sourceId) && Date.parse(e.publishedAt ?? e.collectedAt) >= since);
    const storyOf = new Map<string, Story>();
    for (const st of buildStories(news)) for (const id of st.memberIds) storyOf.set(id, st);
    for (const w of watching) {
      const st = storyOf.get(w.eventId);
      const publishers = st?.publishers.map((x) => x.publisher) ?? [];
      if (st && st.corroboratedAt && st.independentOrigins >= 2) {
        const upgrade: AlertRecord = {
          // One follow-up per rule and story, however many of the story's reports alerted.
          id: contentHash('alert', w.ruleId, 'corroborated', st.id),
          ruleId: w.ruleId,
          ruleName: w.ruleName,
          ruleVersion: w.ruleVersion,
          catalogVersion: CATALOG_VERSION,
          severity: nextSeverity(w.severity),
          title: `Corroborated: ${w.title}`.slice(0, 300),
          body:
            `Now reported by ${st.independentOrigins} independent origins (${publishers.join(', ')})` +
            `${st.sharedOrigins.length ? `; outlets carrying the same copy (${st.sharedOrigins.join(', ')}) count once` : ''}. ` +
            `The first alert was ${w.severity} at ${w.createdAt}. Independent reports make it likelier, not certain.`,
          regionIds: w.regionIds,
          url: w.url,
          evidenceEventIds: st.memberIds.slice(0, 20),
          dedupeKey: `corroborated:${st.id}`,
          createdAt: nowIso,
          acknowledged: false,
          acknowledgedAt: null,
          dismissed: false,
          dismissedAt: null,
          delivery: { discord: 'pending', at: null, error: null },
          corroboration: { status: 'corroborated', at: st.corroboratedAt, publishers, sharedOrigins: st.sharedOrigins, upgradeOf: w.alertId },
        };
        try {
          const fresh = await store.filterNewAlertIds([upgrade.id]);
          if (fresh.has(upgrade.id)) {
            // At most once per rule and story, so a follow-up is not held back by the rule's cooldown.
            await deliver({ id: w.ruleId, name: w.ruleName, notify: { discord: w.notifyDiscord }, cooldownMinutes: w.cooldownMinutes, severity: upgrade.severity }, [upgrade], true);
            result.corroborated++;
          }
          await store.updateAlertCorroboration(w.alertId, { status: 'corroborated', at: st.corroboratedAt, publishers, sharedOrigins: st.sharedOrigins, upgradeId: upgrade.id });
        } catch (err) {
          result.errors.push(`corroboration: ${err instanceof Error ? err.message : String(err)}`);
          stillWatching.push(w);
        }
      } else if (opts.now - Date.parse(w.createdAt) >= CORROBORATION_HOURS * 3_600_000) {
        try {
          await store.updateAlertCorroboration(w.alertId, { status: 'unconfirmed', at: nowIso, publishers, sharedOrigins: st?.sharedOrigins ?? [] });
          result.unconfirmed++;
        } catch (err) {
          result.errors.push(`corroboration: ${err instanceof Error ? err.message : String(err)}`);
          stillWatching.push(w);
        }
      } else stillWatching.push(w);
    }
    if (result.corroborated || result.unconfirmed) log(`ALRT corroboration: ${result.corroborated} corroborated · ${result.unconfirmed} unconfirmed after ${CORROBORATION_HOURS} h · ${stillWatching.length} still watched`);
  }

  const changed = result.created > 0 || watching.length !== (state?.watching?.length ?? 0) || stillWatching.length !== watching.length;
  if (changed) await store.putAlertingState({ lastNotifiedAt: lastNotified, updatedAt: nowIso, watching: stillWatching.slice(-500) });
  return result;
}
