import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRegion } from '@shared/domain/regions';
import { INDICATOR_CATALOG } from '@shared/domain/indicators/catalog';
import { scoreDelta24h } from '@shared/domain/indicators/rai';
import { buildStories, groupFeed } from '@shared/domain/stories/stories';
import type { IntelligenceEvent } from '@shared/domain/types';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { countryName, summarizeRegion } from '../lib/regionSummary';
import { US_STATE_NAMES } from '@shared/domain/geo/usPlaces';
import { BAND_TONE, INDICATOR_STATE_TONE, RAI_DISCLAIMER } from '../config/indicators';
import { CATEGORY_STYLES } from '../config/categories';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import { SeriesChart } from '../components/charts/SeriesChart';
import { WorldMap } from '../components/map/WorldMap';
import { FeedItem } from '../components/goc/FeedItem';
import { useBases } from '../data/useInstallations';
import { InstallationCard } from '../components/map/InstallationCard';
import { DisplacementPanel } from '../components/region/DisplacementPanel';

const MAX_ENTRIES = 60;

/** One watch region: RAI and why, indicators, map, latest reports as stories, countries, categories. */
export default function RegionPage() {
  const { id = '' } = useParams();
  const region = getRegion(id);
  const data = useData();
  const now = useNow(60_000).getTime();
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  // DoD data for the US region; worldwide (Wikidata) data for the other geographic regions.
  const bases = useBases(id === 'united-states', id !== 'united-states' && id !== 'global-cyber', selectedBase);

  useEffect(() => {
    document.title = `WATCHTOWER // ${region ? region.shortCode : 'REGION'}`;
  }, [region]);

  const summary = useMemo(() => summarizeRegion(data.events, id, now), [data.events, id, now]);
  const stories = useMemo(() => buildStories(summary.events), [summary.events]);
  const entries = useMemo(() => groupFeed(summary.events, stories).slice(0, MAX_ENTRIES), [summary.events, stories]);
  const byId = useMemo(() => new Map(summary.events.map((e) => [e.id, e])), [summary.events]);

  if (!region) {
    return (
      <div className="grid h-full place-items-center text-center text-xs">
        <div>
          <p className="tracking-widest text-wt-warn">UNKNOWN REGION</p>
          <Link to="/regions" className="mt-2 inline-block text-wt-fg-muted hover:text-wt-fg">[ALL REGIONS]</Link>
        </div>
      </div>
    );
  }

  const score = data.regionScores.find((s) => s.regionId === id);
  const delta = score ? scoreDelta24h(data.scoreHistory, id, score.score, now) : null;
  const history = data.scoreHistory.map((p) => ({ t: Date.parse(p.at), v: p.scores[id] ?? null }));
  const indicators = INDICATOR_CATALOG.filter((d) => d.regionId === id).map((d) => ({
    def: d,
    ev: data.indicatorEvaluations.find((e) => e.indicatorId === d.id),
  }));
  const stateOrder = { TRIGGERED: 0, ELEVATED: 1, UNKNOWN: 2, DATA_UNAVAILABLE: 3, NORMAL: 4, DISABLED: 5 } as const;
  indicators.sort((a, b) => stateOrder[a.ev?.state ?? 'DATA_UNAVAILABLE'] - stateOrder[b.ev?.state ?? 'DATA_UNAVAILABLE'] || Number(a.def.experimental) - Number(b.def.experimental));
  // The RAI is 100 × (sum of contributions) / (region maximum): each indicator's share in RAI points.
  const appliedTotal = score?.contributions.reduce((t, c) => t + c.applied, 0) ?? 0;
  const raiPoints = (applied: number) => (score?.score && appliedTotal > 0 ? (Math.round(((score.score * applied) / appliedTotal) * 10) / 10).toFixed(1) : '0.0');
  const reportsOf = (memberIds: string[]) => memberIds.map((m) => byId.get(m)).filter((x): x is IntelligenceEvent => !!x);

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title={`Region // ${region.name}`} designator={region.shortCode} actions={<Link to="/regions" className="text-2xs text-wt-fg-muted hover:text-wt-fg">[ALL REGIONS]</Link>}>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-2 py-2">
          <div>
            {score && score.score !== null ? (
              <Tag tone={BAND_TONE[score.band!]}>
                RAI {score.score} · {score.band}
              </Tag>
            ) : (
              <Tag tone="inactive">RAI N/E</Tag>
            )}
            <p className="mt-1 text-2xs text-wt-fg-muted tabular-nums">
              Δ 24 h {delta === null ? '— (no comparison point)' : delta > 0 ? `+${delta}` : delta} · coverage {score ? Math.round(score.coverage * 100) : 0}% · {score?.activeIndicators ?? 0} active indicator(s)
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-x-4 text-2xs">
            <div>
              <dt className="text-wt-fg-dim">REPORTS 24H</dt>
              <dd className="tabular-nums">
                {summary.last24h} <span className="text-wt-fg-dim">(prev {summary.prev24h})</span>
              </dd>
            </div>
            <div>
              <dt className="text-wt-fg-dim">REPORTS 7D</dt>
              <dd className="tabular-nums">{summary.events.length}</dd>
            </div>
            <div>
              <dt className="text-wt-fg-dim">PLOTTED</dt>
              <dd className="tabular-nums">{summary.plotted}</dd>
            </div>
          </dl>
          <p className="min-w-0 flex-1 basis-64 text-2xs text-wt-fg-muted">{region.description}</p>
        </div>
        <p className="px-2 pb-1.5 text-2xs text-wt-fg-dim">
          Countries: {region.countryCodes.length ? region.countryCodes.map(countryName).join(' · ') : 'none (non-geographic watch)'}. {RAI_DISCLAIMER}
        </p>
      </Panel>

      <div className="grid gap-1.5 lg:grid-cols-2">
        <Panel title="RAI — recent runs" designator="R1">
          <div className="px-2 py-1.5">
            <SeriesChart title={`${region.shortCode} RAI`} points={history} kind="line" yDomain={[0, 100]} valueLabel="RAI" emptyText="No RAI history yet." />
            <p className="mt-1 text-2xs text-wt-fg-dim">
              Last {data.scoreHistory.length} collection runs. Gaps mean the RAI could not be evaluated. Longer history: <Link to="/signal-lab" className="text-wt-info underline">SIGNAL LAB</Link>.
            </p>
          </div>
        </Panel>

        <Panel title="Why this score" designator="R2">
          {score && score.contributions.some((c) => c.applied > 0) ? (
            <table className="w-full text-2xs">
              <thead className="text-left text-wt-fg-dim">
                <tr>
                  <th className="px-2 py-1 font-normal">INDICATOR</th>
                  <th className="px-2 py-1 font-normal">STATE</th>
                  <th className="px-2 py-1 text-right font-normal" title="This indicator's share of the region's RAI">RAI POINTS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-wt-line">
                {score.contributions
                  .filter((c) => c.applied > 0)
                  .sort((a, b) => b.applied - a.applied)
                  .map((c) => (
                    <tr key={c.indicatorId}>
                      <td className="px-2 py-1">{c.name}</td>
                      <td className="px-2 py-1">
                        <Tag tone={INDICATOR_STATE_TONE[c.state]}>{c.state}</Tag>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {raiPoints(c.applied)}
                        {c.capped && <span className="text-wt-fg-dim" title="Capped: no single source may supply more than 60% of the maximum"> (capped)</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">No indicator is adding points: the score is at baseline.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-1.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Theatre — last 7 days" designator="R3" className="h-[420px]" bodyClassName="relative">
          {region.bbox ? (
            <WorldMap
              events={summary.events}
              selectedEventId={selected}
              focusRegionId={id}
              onSelectEvent={setSelected}
              onSelectRegion={() => {}}
              showGraticule
              showRegions
              globalViewNonce={0}
              installations={bases.us.data?.installations}
              worldInstallations={bases.world.data?.installations}
              showInstallations
              selectedInstallation={selectedBase}
              onSelectInstallation={setSelectedBase}
            />
          ) : (
            <p className="p-2 text-2xs text-wt-fg-dim">This watch is not geographic, so there is no map.</p>
          )}
          {bases.selected && <InstallationCard selected={bases.selected} events={data.events} now={now} onClose={() => setSelectedBase(null)} />}
        </Panel>

        <Panel title={`Indicators (${indicators.length})`} designator="R4" bodyClassName="max-h-[380px] overflow-y-auto">
          <ul className="divide-y divide-wt-line text-2xs">
            {indicators.map(({ def, ev }) => (
              <li key={def.id} className="flex items-start justify-between gap-2 px-2 py-1">
                <span className="min-w-0">
                  <Link to={`/indicators#${def.id}`} className="hover:underline">{def.name}</Link>
                  {def.experimental && <span className="text-wt-fg-dim"> · experimental, not in RAI</span>}
                  <span className="block text-wt-fg-dim">
                    {ev ? `${ev.matchedCount} matching in ${def.windowHours} h` : 'not evaluated'}
                  </span>
                </span>
                <Tag tone={INDICATOR_STATE_TONE[ev?.state ?? 'DATA_UNAVAILABLE']}>{ev?.state ?? 'NO DATA'}</Tag>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-1.5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={`Latest reports — ${entries.length} entries`} designator="R5" bodyClassName="max-h-[560px] overflow-y-auto">
          {entries.length === 0 ? (
            <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">No relevant reports for this region in the last 7 days.</p>
          ) : (
            <ul className="divide-y divide-wt-line" aria-label={`${region.name} reports`}>
              {entries.map(({ event: e, story }) => (
                <FeedItem
                  key={e.id}
                  event={e}
                  selected={selected === e.id || (!!story && !!selected && story.memberIds.includes(selected))}
                  onSelect={() => setSelected(selected === e.id ? null : e.id)}
                  now={now}
                  story={story}
                  storyReports={story ? reportsOf(story.memberIds) : undefined}
                />
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-1.5">
          {region.countryCodes.length > 0 && id !== 'united-states' && <DisplacementPanel countries={region.countryCodes} data={data.displacement} />}
          <Panel title="Countries named — 7 days" designator="R6">
            {summary.byCountry.length === 0 ? (
              <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">No country-level records.</p>
            ) : (
              <table className="w-full text-2xs">
                <tbody className="divide-y divide-wt-line">
                  {summary.byCountry.slice(0, 15).map((c) => (
                    <tr key={c.code}>
                      <td className="px-2 py-0.5">
                        {countryName(c.code)} <span className="text-wt-fg-dim">{c.code}</span>
                        {!c.inRegion && <span className="text-wt-fg-dim"> · outside region</span>}
                      </td>
                      <td className="px-2 py-0.5 text-right tabular-nums">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          {id === 'united-states' && (
            <Panel title="States — 7 days" designator="R6b">
              {summary.byState.length === 0 ? (
                <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">No state named or supplied.</p>
              ) : (
                <table className="w-full text-2xs">
                  <tbody className="divide-y divide-wt-line">
                    {summary.byState.slice(0, 15).map((s) => (
                      <tr key={s.code}>
                        <td className="px-2 py-0.5">
                          {US_STATE_NAMES[s.code] ?? s.code} <span className="text-wt-fg-dim">{s.code}</span>
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          )}
          <Panel title="Records by category — 7 days" designator="R7">
            {summary.byCategory.length === 0 ? (
              <p className="px-2 py-1.5 text-2xs text-wt-fg-dim">No records.</p>
            ) : (
              <table className="w-full text-2xs">
                <tbody className="divide-y divide-wt-line">
                  {summary.byCategory.map((c) => (
                    <tr key={c.category}>
                      <td className="px-2 py-0.5">{CATEGORY_STYLES[c.category].label}</td>
                      <td className="px-2 py-0.5 text-right tabular-nums">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <p className="px-1 text-2xs text-wt-fg-dim">
            Built from the records currently loaded (the newest ~700). Off-topic news is excluded. A country named in a headline is a mention, not a location.
          </p>
        </div>
      </div>
    </div>
  );
}
