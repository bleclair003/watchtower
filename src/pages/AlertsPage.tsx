import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { ALERT_SEVERITIES, type AlertRecord, type AlertRule, type AlertSeverity } from '@shared/domain/alerts/types';
import { describeCondition } from '@shared/domain/indicators/conditions';
import { getIndicator } from '@shared/domain/indicators/catalog';
import { getRegion } from '@shared/domain/regions';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { formatAge, formatUtc } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';
import { DELIVERY_TONE, SEVERITY_TONE } from '../config/alerts';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import { RuleBuilder } from '../components/alerts/RuleBuilder';


type Service = typeof import('../data/alertsService');

function triggerSummary(r: AlertRule): string {
  const t = r.trigger;
  if (t.kind === 'event') return `New event: ${describeCondition(t.match)}`;
  if (t.kind === 'indicator') return `Indicator enters ${t.states.join('/')}: ${t.indicatorIds.map((id) => getIndicator(id)?.name ?? id).join(', ')}`;
  return `RAI ${getRegion(t.regionId)?.shortCode ?? t.regionId} crosses ${t.atLeast}`;
}

export default function AlertsPage() {
  const data = useData();
  const now = useNow(60_000).getTime();
  const live = data.mode !== 'demo';
  const [svc, setSvc] = useState<Service | null>(null);
  const [tab, setTab] = useState<'inbox' | 'rules'>('inbox');
  const [alerts, setAlerts] = useState<AlertRecord[] | null>(null);
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'ALL'>('ALL');
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'WATCHTOWER // ALERTS';
    if (live) import('../data/alertsService').then(setSvc, (e: unknown) => setError(String(e)));
  }, [live]);

  const load = useCallback(async () => {
    if (!svc) return;
    try {
      const [a, r] = await Promise.all([svc.listAlerts(), svc.listRules()]);
      setAlerts(a);
      setRules(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [svc]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const visible = useMemo(
    () => (alerts ?? []).filter((a) => (severityFilter === 'ALL' || a.severity === severityFilter) && (showClosed || !a.acknowledged)),
    [alerts, severityFilter, showClosed],
  );
  const open = (alerts ?? []).filter((a) => !a.acknowledged).length;
  const problemsById = new Map(data.alertRuleProblems.map((p) => [p.ruleId, p.problems]));

  const tabBtn = (t: typeof tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      aria-pressed={tab === t}
      className={`h-6 px-2 text-2xs tracking-widest ${tab === t ? 'bg-wt-fg text-wt-bg' : 'text-wt-fg-muted hover:text-wt-fg'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel
        title="Alert Center"
        designator="AL"
        actions={
          <span className="flex items-center gap-1">
            {tabBtn('inbox', `INBOX${alerts ? ` (${open} OPEN)` : ''}`)}
            {tabBtn('rules', `RULES${rules ? ` (${rules.length})` : ''}`)}
          </span>
        }
      >
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-wt-line px-2 py-1.5 text-2xs text-wt-fg-muted">
          <span>
            DISCORD:{' '}
            {data.discordConfigured === null ? (
              <span className="text-wt-inactive">UNKNOWN (no run since Phase 4)</span>
            ) : data.discordConfigured ? (
              <span className="text-wt-fg">CONFIGURED</span>
            ) : (
              <span className="text-wt-warn">NOT CONFIGURED: add the DISCORD_WEBHOOK_URL secret</span>
            )}
          </span>
          <span>ACTIVE RULES (LAST RUN): {data.activeAlertRules ?? '—'}</span>
          <span>LAST RUN: {data.lastRun ? `${data.lastRun.alertsCreated ?? 0} alerts · ${data.lastRun.notificationsSent ?? 0} notified` : '—'}</span>
          <span className="text-wt-fg-dim">Levels are WATCHTOWER classifications, not official government warning levels.</span>
        </div>
        {!live && (
          <p className="p-3 text-xs text-wt-warn">
            Alerting needs the live backend: rules are stored in Firestore and evaluated by the collector. In demo mode you can still build a rule and
            test it against the demo data; saving is disabled.
          </p>
        )}
        {error && <p role="alert" className="p-2 text-xs text-wt-crit">ERROR: {error}</p>}

        {tab === 'inbox' && live && (
          <div>
            <div className="flex flex-wrap items-center gap-2 border-b border-wt-line px-2 py-1 text-2xs">
              <select
                aria-label="Severity filter"
                className="h-6 border border-wt-line-strong bg-wt-bg px-1 text-2xs"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | 'ALL')}
              >
                <option value="ALL">ALL LEVELS</option>
                {ALERT_SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-[#6aff9b]" />
                SHOW ACKNOWLEDGED / DISMISSED
              </label>
              <button onClick={() => void load()} className="ml-auto text-wt-fg-muted hover:text-wt-fg">[RELOAD]</button>
            </div>
            {alerts === null ? (
              <p className="p-3 text-xs text-wt-fg-muted">LOADING…</p>
            ) : visible.length === 0 ? (
              <p className="p-3 text-xs text-wt-fg-muted">
                {alerts.length === 0 ? 'NO ALERTS YET. Create a rule; it fires on new data from the next collection run.' : 'NO ALERTS MATCH THE FILTER.'}
              </p>
            ) : (
              <ul className="divide-y divide-wt-line">
                {visible.map((a) => {
                  const url = safeExternalUrl(a.url);
                  const expanded = openId === a.id;
                  return (
                    <li key={a.id} className={`px-2 py-1.5 ${a.acknowledged ? 'opacity-60' : ''}`}>
                      <div className="flex flex-wrap items-start gap-1.5">
                        <Tag tone={SEVERITY_TONE[a.severity]}>{a.severity}</Tag>
                        <button className="min-w-0 flex-1 text-left text-xs hover:underline" onClick={() => setOpenId(expanded ? null : a.id)} aria-expanded={expanded}>
                          {a.title}
                        </button>
                        <span className="text-2xs whitespace-nowrap text-wt-fg-muted tabular-nums" title={formatUtc(a.createdAt)}>
                          {formatAge(a.createdAt, now)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1 text-2xs">
                        <span className="text-wt-fg-dim">{a.ruleName}</span>
                        {a.regionIds.map((r) => <Tag key={r}>{getRegion(r)?.shortCode ?? r}</Tag>)}
                        <Tag tone={DELIVERY_TONE[a.delivery.discord]} title={a.delivery.error ?? undefined}>DISCORD {a.delivery.discord}</Tag>
                        {a.dismissed ? <Tag tone="inactive">DISMISSED</Tag> : a.acknowledged ? <Tag tone="inactive">ACK</Tag> : null}
                        <span className="ml-auto flex gap-2">
                          {!a.acknowledged && (
                            <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => void act(() => svc!.acknowledgeAlert(a.id))}>[ACK]</button>
                          )}
                          {!a.dismissed && (
                            <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => void act(() => svc!.dismissAlert(a.id))}>[DISMISS]</button>
                          )}
                        </span>
                      </div>
                      {expanded && (
                        <div className="mt-1 space-y-1 border-l-2 border-wt-info pl-2 text-2xs">
                          {a.body && <p className="text-wt-fg-muted">{a.body}</p>}
                          <p className="text-wt-fg-dim">
                            Created {formatUtc(a.createdAt)} · rule v{a.ruleVersion} · evidence {a.evidenceEventIds.length} record(s)
                            {a.acknowledgedAt && ` · acknowledged ${formatUtc(a.acknowledgedAt)}`}
                          </p>
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-wt-info hover:underline">
                              OPEN ORIGINAL SOURCE <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {(tab === 'rules' || !live) && (
          <div>
            {editing ? (
              <RuleBuilder
                initial={editing === 'new' ? null : editing}
                canSave={live && !!svc}
                onCancel={() => setEditing(null)}
                onSave={async (rule) => {
                  await svc!.saveRule(rule);
                  setEditing(null);
                  await load();
                }}
              />
            ) : (
              <div className="flex items-center border-b border-wt-line px-2 py-1">
                <button onClick={() => setEditing('new')} className="text-2xs text-wt-fg hover:underline">[+ NEW RULE]</button>
              </div>
            )}
            {live && !editing && rules !== null && (
              rules.length === 0 ? (
                <p className="p-3 text-xs text-wt-fg-muted">NO RULES. Alerts are only created by rules you define.</p>
              ) : (
                <ul className="divide-y divide-wt-line">
                  {rules.map((r) => {
                    const problems = problemsById.get(r.id);
                    return (
                      <li key={r.id} className="px-2 py-1.5 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Tag tone={SEVERITY_TONE[r.severity]}>{r.severity}</Tag>
                          <span className={r.enabled ? '' : 'text-wt-inactive'}>{r.name}</span>
                          {!r.enabled && <Tag tone="inactive">DISABLED</Tag>}
                          {problems && <Tag tone="crit" title={problems.join('; ')}>INVALID — NOT EVALUATED</Tag>}
                          <span className="ml-auto flex gap-2 text-2xs">
                            <button
                              className="text-wt-fg-muted hover:text-wt-fg"
                              onClick={() => void act(() => svc!.saveRule({ ...r, enabled: !r.enabled, version: r.version + 1, updatedAt: new Date().toISOString() }))}
                            >
                              [{r.enabled ? 'DISABLE' : 'ENABLE'}]
                            </button>
                            <button className="text-wt-fg-muted hover:text-wt-fg" onClick={() => setEditing(r)}>[EDIT]</button>
                            {confirmDelete === r.id ? (
                              <>
                                <button className="text-wt-crit hover:underline" onClick={() => void act(() => svc!.deleteRule(r.id)).then(() => setConfirmDelete(null))}>
                                  [CONFIRM DELETE]
                                </button>
                                <button className="text-wt-fg-muted" onClick={() => setConfirmDelete(null)}>[KEEP]</button>
                              </>
                            ) : (
                              <button className="text-wt-fg-muted hover:text-wt-crit" onClick={() => setConfirmDelete(r.id)}>[DELETE]</button>
                            )}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-2xs break-words text-wt-fg-muted">{triggerSummary(r)}</p>
                        <p className="text-2xs text-wt-fg-dim">
                          Discord {r.notify.discord ? 'ON' : 'OFF'} · cooldown {r.cooldownMinutes} min · v{r.version} · updated {formatAge(r.updatedAt, now)} ago
                        </p>
                        {problems && <p className="text-2xs text-wt-crit">{problems.join(' · ')}</p>}
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
