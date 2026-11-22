import { Fragment, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import type { IntegrationPriority, SourceDefinition } from '@shared/domain/types';
import { useData } from '../state/DataContext';
import { formatAge, formatUtc } from '../lib/time';
import { mergeSourceStatus } from '../lib/sourceHealth';
import { useNow } from '../hooks/useNow';
import { safeExternalUrl } from '../lib/sanitize';
import { Panel } from '../components/ui/Panel';
import { Lamp, Tag } from '../components/ui/Tag';
import { HEALTH_TONE, type Tone } from '../config/categories';

const PRIORITY_TONE: Record<IntegrationPriority, Tone> = {
  P1: 'ok',
  P2: 'info',
  P3: 'muted',
  research: 'warn',
  rejected: 'inactive',
};

const FEAS_TONE: Record<SourceDefinition['feasibility']['result'], Tone> = {
  reachable: 'ok',
  'reachable-empty': 'warn',
  'rate-limited': 'warn',
  blocked: 'crit',
  unavailable: 'crit',
  'no-feed': 'warn',
};

/** Intelligence Source Directory: every configured and prospective source. */
/** Columns shown only from tablet width up (their values move into the row details on phones). */
const PHONE_HIDDEN = ['ORGANIZATION', 'METHOD', 'AUTH', 'POLL', 'FEASIBILITY', 'LAST OK'];

export default function SourcesPage() {
  const { sourceStatus } = useData();
  const now = useNow(60_000).getTime();
  const statuses = mergeSourceStatus(sourceStatus, now);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'WATCHTOWER // SOURCES';
  }, []);

  return (
    <div className="h-full overflow-y-auto p-1.5">
      <Panel title="Intelligence Source Directory" designator="S1">
        <p className="border-b border-wt-line px-2 py-1.5 text-2xs leading-relaxed text-wt-fg-muted">
          FEASIBILITY = result of a manual probe from a residential connection on the date shown. It confirms reachability only.
          STATUS = health reported by the collector, re-evaluated against the current time (a silent collector turns sources STALE). Sources without an adapter read NOT CONFIGURED.
          Select a row for reliability and terms notes.
        </p>
        <div className="overflow-x-auto">
          {/* On phones only priority, source, status and the link are columns; the rest is in each row's details. */}
          <table className="w-full border-collapse text-left text-xs md:min-w-[960px]">
            <thead className="bg-wt-bg2 text-2xs tracking-widest text-wt-fg-dim">
              <tr>
                {['PRI', 'SOURCE', 'ORGANIZATION', 'METHOD', 'AUTH', 'POLL', 'FEASIBILITY', 'STATUS', 'LAST OK', ''].map((h) => (
                  <th key={h} className={`border-b border-wt-line px-2 py-1 font-normal ${PHONE_HIDDEN.includes(h) ? 'hidden md:table-cell' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOURCE_REGISTRY.map((s) => {
                const st = statuses.find((x) => x.sourceId === s.id);
                const open = expanded === s.id;
                const site = safeExternalUrl(s.website);
                return (
                  <Fragment key={s.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : s.id)}
                      className={`cursor-pointer border-b border-wt-line align-top ${open ? 'bg-wt-info/[0.06]' : 'hover:bg-wt-bg2'}`}
                    >
                      <td className="px-2 py-1"><Tag tone={PRIORITY_TONE[s.priority]}>{s.priority}</Tag></td>
                      <td className="px-2 py-1">
                        <button
                          className="text-left text-wt-fg hover:underline"
                          aria-expanded={open}
                          onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : s.id); }}
                        >
                          {s.name}
                        </button>
                        <div className="text-2xs text-wt-fg-dim">{s.id}</div>
                        <div className="text-2xs text-wt-fg-muted md:hidden">{s.organization}</div>
                      </td>
                      <td className="hidden md:table-cell px-2 py-1 text-wt-fg-muted">{s.organization}</td>
                      <td className="hidden md:table-cell px-2 py-1 uppercase">{s.method}</td>
                      <td className="hidden md:table-cell max-w-[160px] px-2 py-1 text-wt-fg-muted">{s.authentication}</td>
                      <td className="hidden md:table-cell px-2 py-1 tabular-nums">{s.pollIntervalMinutes ? `${s.pollIntervalMinutes}m` : '—'}</td>
                      <td className="hidden md:table-cell px-2 py-1">
                        <Tag tone={FEAS_TONE[s.feasibility.result]}>{s.feasibility.result}</Tag>
                      </td>
                      <td className="px-2 py-1">
                        {st && (
                          <span className="flex items-center gap-1 text-2xs whitespace-nowrap">
                            <Lamp tone={HEALTH_TONE[st.health]} label={st.health} />
                            {st.health.replace('_', ' ')}
                          </span>
                        )}
                      </td>
                      <td className="hidden md:table-cell px-2 py-1 text-wt-fg-muted tabular-nums">{formatUtc(st?.lastSuccessAt)}</td>
                      <td className="px-2 py-1">
                        {site && (
                          <a
                            href={site}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-wt-info"
                            aria-label={`Open ${s.organization} website`}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-wt-line bg-wt-bg2/40">
                        <td className="hidden md:table-cell" />
                        <td colSpan={9} className="px-2 py-2">
                          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-2xs md:grid-cols-[140px_1fr]">
                            <dt className="text-wt-fg-dim md:hidden">METHOD · AUTH</dt>
                            <dd className="md:hidden">
                              {s.method.toUpperCase()} · {s.authentication}
                            </dd>
                            <dt className="text-wt-fg-dim md:hidden">POLL · LAST OK</dt>
                            <dd className="md:hidden">
                              {s.pollIntervalMinutes ? `every ${s.pollIntervalMinutes} min` : '—'} · {formatUtc(st?.lastSuccessAt)}
                            </dd>
                            <dt className="text-wt-fg-dim md:hidden">FEASIBILITY</dt>
                            <dd className="md:hidden">
                              <Tag tone={FEAS_TONE[s.feasibility.result]}>{s.feasibility.result}</Tag>
                            </dd>
                            <dt className="text-wt-fg-dim">COVERAGE</dt><dd>{s.coverage}</dd>
                            <dt className="text-wt-fg-dim">ENDPOINT</dt><dd className="break-all text-wt-fg-muted">{s.endpoint ?? 'NONE IDENTIFIED'}</dd>
                            <dt className="text-wt-fg-dim">FREE ACCESS</dt><dd>{s.freeAccess}</dd>
                            <dt className="text-wt-fg-dim">UPDATE FREQ.</dt><dd>{s.expectedUpdateFrequency}</dd>
                            <dt className="text-wt-fg-dim">PROBE</dt><dd>{formatUtc(s.feasibility.checkedAt)} — {s.feasibility.note}</dd>
                            {st && st.lastAttemptAt && (
                              <>
                                <dt className="text-wt-fg-dim">COLLECTOR</dt>
                                <dd>
                                  last attempt {formatAge(st.lastAttemptAt, now)} ago · last new item{' '}
                                  {st.lastNewItemAt ? `${formatAge(st.lastNewItemAt, now)} ago` : 'never'} · consecutive failures{' '}
                                  {st.consecutiveFailures} · rejected items {st.parseErrors}
                                </dd>
                                <dt className="text-wt-fg-dim">LAST ERROR</dt>
                                <dd className={st.lastError ? 'text-wt-crit' : 'text-wt-fg-muted'}>{st.lastError ?? 'none'}</dd>
                              </>
                            )}
                            <dt className="text-wt-fg-dim">RELIABILITY</dt><dd className="text-wt-fg-muted">{s.reliabilityNotes}</dd>
                            <dt className="text-wt-fg-dim">TERMS</dt><dd className="text-wt-fg-muted">{s.termsNotes}</dd>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
