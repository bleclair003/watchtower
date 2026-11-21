import { useMemo, useState, type FormEvent } from 'react';
import { ALERT_SEVERITIES, type AlertSeverity } from '@shared/domain/alerts/types';
import { WATCHLIST_LIMITS, WATCH_KINDS, WATCH_KIND_LABEL, validateWatchlist, watchItemId, type WatchItem, type WatchKind } from '@shared/domain/watchlist';
import { useWatchlist } from '../../state/WatchlistContext';
import { useData } from '../../state/DataContext';
import { Panel } from '../ui/Panel';

const input = 'border border-wt-line bg-wt-bg px-1.5 py-0.5 text-xs text-wt-fg focus:border-wt-info focus:outline-none';

/** Edit the watchlist: terms to highlight in the feed, optionally raising alerts. */
export function WatchlistPanel() {
  const w = useWatchlist();
  const { events } = useData();
  const [term, setTerm] = useState('');
  const [aliases, setAliases] = useState('');
  const [kind, setKind] = useState<WatchKind>('term');
  const [alert, setAlert] = useState(false);
  const [severity, setSeverity] = useState<AlertSeverity>('ADVISORY');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // How many loaded records each item matches now.
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    if (!w) return c;
    for (const e of events) for (const h of w.match(e)) c.set(h.item.id, (c.get(h.item.id) ?? 0) + 1);
    return c;
  }, [w, events]);

  if (!w) return null;
  const items = w.list.items;

  const commit = async (next: WatchItem[]) => {
    const problems = validateWatchlist({ items: next, updatedAt: new Date().toISOString(), version: w.list.version + 1 });
    if (problems.length) return setProblem(problems.join('; '));
    setBusy(true);
    try {
      await w.save(next);
      setProblem(null);
      return true;
    } catch (e) {
      setProblem((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (ev: FormEvent) => {
    ev.preventDefault();
    const t = term.trim();
    const id = watchItemId(t);
    if (items.some((i) => i.id === id)) return setProblem(`"${t}" is already on the list.`);
    const item: WatchItem = {
      id,
      term: t,
      kind,
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      alert,
      severity,
      createdAt: new Date().toISOString(),
    };
    if (await commit([...items, item])) {
      setTerm('');
      setAliases('');
    }
  };

  return (
    <Panel title={`Watchlist (${items.length}/${WATCHLIST_LIMITS.items})`} designator="O2" className="max-w-2xl">
      <div className="space-y-2 px-3 py-2 text-2xs">
        <p className="text-wt-fg-muted">
          People, units, bases or terms to follow. Records that name one (whole words, title or summary) are marked WATCH in the feeds. Items set to alert also raise an alert for each new matching record
          {w.storage === 'cloud' ? ' (and a Discord message when a webhook is configured; at most one message an hour per item).' : '.'}
        </p>
        {w.storage === 'local' && <p className="text-wt-warn">Demo mode: the list is kept in this browser only, and no alerts are raised.</p>}
        {w.storage === 'unavailable' && <p className="text-wt-warn">Sign in to keep a watchlist.</p>}
        {w.loading && <p className="text-wt-fg-dim">Loading…</p>}

        {w.storage !== 'unavailable' && !w.loading && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-2" aria-label="Add to watchlist">
            <label className="flex flex-col gap-0.5">
              <span className="text-wt-fg-dim">NAME OR TERM</span>
              <input value={term} onChange={(e) => setTerm(e.target.value)} maxLength={WATCHLIST_LIMITS.termMax} required minLength={WATCHLIST_LIMITS.termMin} className={`${input} w-48`} placeholder="e.g. Wagner, IRGC, Kadena" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-wt-fg-dim">OTHER SPELLINGS (COMMA-SEPARATED)</span>
              <input value={aliases} onChange={(e) => setAliases(e.target.value)} className={`${input} w-48`} placeholder="optional" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-wt-fg-dim">KIND</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as WatchKind)} className={input}>
                {WATCH_KINDS.map((k) => (
                  <option key={k} value={k}>{WATCH_KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 pb-0.5">
              <input type="checkbox" checked={alert} onChange={(e) => setAlert(e.target.checked)} className="size-3.5 accent-[#6aff9b]" />
              <span>ALERT</span>
            </label>
            {alert && (
              <select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)} className={input} aria-label="Alert level">
                {ALERT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <button type="submit" disabled={busy} className="border border-wt-fg/60 px-2 py-0.5 text-xs hover:bg-wt-bg2 disabled:opacity-50">
              [ADD]
            </button>
          </form>
        )}
        {(problem ?? w.error) && <p role="alert" className="text-wt-crit">{problem ?? w.error}</p>}

        {items.length === 0 ? (
          <p className="text-wt-fg-dim">Nothing on the watchlist yet.</p>
        ) : (
          <table className="w-full">
            <thead className="text-wt-fg-dim">
              <tr>
                <th className="py-0.5 text-left font-normal">TERM</th>
                <th className="py-0.5 text-left font-normal">KIND</th>
                <th className="py-0.5 text-left font-normal">ALERT</th>
                <th className="py-0.5 text-right font-normal" title="Loaded records that match now">LOADED</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-wt-line">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="py-0.5">
                    {i.term}
                    {i.aliases.length > 0 && <span className="text-wt-fg-dim"> · {i.aliases.join(', ')}</span>}
                  </td>
                  <td className="py-0.5 text-wt-fg-muted">{WATCH_KIND_LABEL[i.kind]}</td>
                  <td className="py-0.5">
                    <button
                      disabled={busy}
                      onClick={() => void commit(items.map((x) => (x.id === i.id ? { ...x, alert: !x.alert } : x)))}
                      className={i.alert ? 'text-wt-warn' : 'text-wt-fg-dim hover:text-wt-fg'}
                      aria-label={`${i.alert ? 'Turn off' : 'Turn on'} alerts for ${i.term}`}
                    >
                      {i.alert ? i.severity : 'off'}
                    </button>
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{counts.get(i.id) ?? 0}</td>
                  <td className="py-0.5 text-right">
                    <button disabled={busy} onClick={() => void commit(items.filter((x) => x.id !== i.id))} className="text-wt-fg-dim hover:text-wt-crit" aria-label={`Remove ${i.term}`}>
                      [X]
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
