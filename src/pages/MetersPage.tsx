import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { WATCH_REGIONS } from '@shared/domain/regions';
import type { Meter, MeterKind } from '@shared/domain/meters/types';
import { daysBetween } from '@shared/domain/meters/clocks';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import { MeterCard, cellLabel, levelTone } from '../components/meters/MeterCard';
import { formatUtc } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';

const REGION_COLUMNS: [MeterKind, string, string][] = [
  ['escalation', 'LADDER', 'Escalation ladder: highest active rung'],
  ['evacuation', 'EVAC', 'Evacuation risk'],
  ['buildup', 'BUILDUP', 'Quiet buildup vs noise'],
  ['air-surge', 'AIR', 'Air surge: tanker, airlift, ISR, bomber sightings'],
  ['diplomatic', 'DIPLO', 'Diplomatic temperature'],
  ['blackout', 'BLACKOUT', 'Information blackout'],
  ['economic', 'ECON', 'Economic stress'],
  ['humanitarian', 'HUMAN', 'Humanitarian strain'],
  ['corroboration', 'CORROB', 'Share of stories corroborated'],
  ['visibility', 'VISIB', 'Share of the region’s sources online'],
];
const TOPIC_ORDER: MeterKind[] = ['naval', 'maritime', 'sanctions', 'arms', 'washington', 'strategic', 'homeland', 'cyber'];
const DISCLAIMER = 'Meters describe activity in the sources WATCHTOWER monitors. None is a probability of conflict, attack or any other event.';

export default function MetersPage() {
  const { meters, mode } = useData();
  const now = useNow(60_000).getTime();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('m');
  useEffect(() => {
    document.title = 'WATCHTOWER // METERS';
  }, []);

  const byId = useMemo(() => new Map((meters?.meters ?? []).map((m) => [m.id, m])), [meters]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const select = (m: Meter) => {
    setParams(selectedId === m.id ? {} : { m: m.id }, { replace: true });
    // Below the two-column layout the detail sits under the lists: bring it into view.
    if (window.innerWidth < 1280) requestAnimationFrame(() => document.getElementById('meter-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  if (!meters) {
    return (
      <div className="p-1.5">
        <Panel title="Meters and monitors" designator="M0">
          <p className="px-3 py-2 text-xs text-wt-fg-muted">{mode === 'demo' ? 'Loading…' : 'Meters have not been computed yet: they appear after the next collection run.'}</p>
        </Panel>
      </div>
    );
  }

  const topics = meters.meters.filter((m) => TOPIC_ORDER.includes(m.kind)).sort((a, b) => TOPIC_ORDER.indexOf(a.kind) - TOPIC_ORDER.indexOf(b.kind));
  const regions = WATCH_REGIONS.filter((r) => r.id !== 'global-cyber');

  return (
    <div className="h-full overflow-y-auto p-1.5">
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-1.5">
          <Panel title="Meters and monitors" designator="M0" actions={meters.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
            <div className="space-y-1 px-3 py-2 text-2xs text-wt-fg-muted">
              <p>{DISCLAIMER}</p>
              <p>
                Computed {formatUtc(meters.computedAt)} from {meters.historyDays} days of stored records.{' '}
                {meters.historyDays < meters.baselineDays
                  ? `Meters that compare with a usual level show BUILDING until ${meters.baselineDays} days of history exist.`
                  : 'Usual levels are available.'}{' '}
                Select any reading for its evidence. <Link to="/signal-lab#lead-lag" className="text-wt-info underline">Lead/lag lab →</Link>
              </p>
            </div>
          </Panel>

          <Panel title="Regions" designator="M1">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-2xs">
                <thead className="text-wt-fg-dim">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">REGION</th>
                    {REGION_COLUMNS.map(([k, label, title]) => (
                      <th key={k} className="px-1 py-1 text-left font-normal" title={title}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-wt-line">
                  {regions.map((r) => (
                    <tr key={r.id}>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <Link to={`/regions/${r.id}`} className="hover:underline">
                          {r.shortCode}
                        </Link>
                      </td>
                      {REGION_COLUMNS.map(([k]) => {
                        const m = byId.get(`${k}.${r.id}`);
                        return (
                          <td key={k} className="px-1 py-1">
                            {m ? (
                              <button onClick={() => select(m)} aria-pressed={selectedId === m.id} title={m.reading} className={selectedId === m.id ? 'outline outline-1 outline-wt-info' : ''}>
                                <Tag tone={levelTone(m.level)}>{cellLabel(m)}</Tag>
                              </button>
                            ) : (
                              <span className="text-wt-fg-dim">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Topic monitors" designator="M2">
            <ul className="grid grid-cols-1 gap-px bg-wt-line sm:grid-cols-2">
              {topics.map((m) => (
                <li key={m.id} className="bg-wt-panel">
                  <button onClick={() => select(m)} aria-pressed={selectedId === m.id} className={`block h-full w-full px-2 py-1.5 text-left hover:bg-wt-bg2 ${selectedId === m.id ? 'bg-wt-info/10' : ''}`}>
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs">{m.name}</span>
                      <span className="ml-auto">
                        <Tag tone={levelTone(m.level)}>{m.label}</Tag>
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-2xs text-wt-fg-muted">{m.reading}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Days since" designator="M3">
            <ul className="grid grid-cols-2 gap-px bg-wt-line sm:grid-cols-3 lg:grid-cols-5">
              {meters.counters.map((c) => {
                const url = c.url ? safeExternalUrl(c.url) : null;
                const days = c.lastAt ? daysBetween(c.lastAt, now) : null;
                return (
                  <li key={c.id} className="bg-wt-panel px-2 py-1.5" title={c.rule}>
                    <span className="block text-lg tabular-nums leading-tight text-wt-fg">{days === null ? '—' : days}</span>
                    <span className="block text-2xs text-wt-fg-dim">{days === null ? `none since records began (${meters.historyDays} d)` : days === 1 ? 'day' : 'days'}</span>
                    <span className="mt-0.5 block text-2xs">{c.label}</span>
                    {c.title && (
                      <span className="mt-0.5 line-clamp-2 block text-2xs text-wt-fg-muted">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                            {c.title}
                          </a>
                        ) : (
                          c.title
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title={`Coming up — next 30 days (${meters.calendar.length})`} designator="M4">
            {meters.calendar.length === 0 ? (
              <p className="px-3 py-2 text-2xs text-wt-fg-dim">Nothing scheduled in the collected sources.</p>
            ) : (
              <ul className="divide-y divide-wt-line text-2xs">
                {meters.calendar.map((c) => {
                  const url = c.url ? safeExternalUrl(c.url) : null;
                  return (
                    <li key={`${c.at}-${c.title}`} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 px-2 py-1">
                      <span className="w-28 shrink-0 tabular-nums text-wt-fg-muted">{c.at.slice(0, 16).replace('T', ' ')}Z</span>
                      <Tag tone={c.kind === 'launch' ? 'info' : 'muted'}>{c.kind}</Tag>
                      <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                            {c.title}
                          </a>
                        ) : (
                          c.title
                        )}
                      </span>
                      <span className="hidden shrink-0 text-wt-fg-dim sm:inline">{c.source}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">Only sources that publish future dates: scheduled military launches (Launch Library 2) and security-committee hearings (Congress.gov). Dates move.</p>
          </Panel>
        </div>

        <div className="xl:sticky xl:top-0 xl:self-start">
          <Panel title={selected ? 'Meter detail' : 'Meter detail — select a reading'} designator="M5" id="meter-detail">
            <div className="px-3 py-2">
              {selected ? (
                <MeterCard meter={selected} history={meters.history} now={now} simulated={meters.simulated} />
              ) : (
                <p className="text-2xs text-wt-fg-dim">Select a cell or a monitor to see its reading, the parts it is built from, its evidence and its limits.</p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
