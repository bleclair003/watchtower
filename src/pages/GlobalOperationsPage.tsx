import { useEffect, useMemo } from 'react';
import { Grid3x3, Square } from 'lucide-react';
import { getRegion } from '@shared/domain/regions';
import { getIndicator } from '@shared/domain/indicators/catalog';
import { applyFilters } from '../lib/filters';
import { isOffTopic } from '@shared/domain/relevance';
import { projectEvents } from '../lib/geo';
import { useNow } from '../hooks/useNow';
import { useData } from '../state/DataContext';
import { useDashboard } from '../state/DashboardContext';
import { useSettings } from '../state/SettingsContext';
import { WorldMap } from '../components/map/WorldMap';
import { MapLegend } from '../components/map/MapLegend';
import { RegionalWatchlist } from '../components/goc/RegionalWatchlist';
import { IntelFeed } from '../components/goc/IntelFeed';
import { SystemStatusPanel } from '../components/goc/SystemStatusPanel';
import { Panel } from '../components/ui/Panel';

export default function GlobalOperationsPage() {
  // Re-evaluate time windows once a minute; the clock in the top bar ticks separately.
  const now = useNow(60_000).getTime();
  const { events, regionScores, scoreHistory, indicatorEvaluations, mode } = useData();
  const { filters, setFilters, resetFilters, selectedEventId, selectEvent, globalViewNonce } = useDashboard();
  const { settings, update } = useSettings();

  useEffect(() => {
    document.title = 'WATCHTOWER // GOC';
  }, []);

  const indicatorsByEvent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ev of indicatorEvaluations) {
      if (ev.state !== 'TRIGGERED' && ev.state !== 'ELEVATED') continue;
      const name = getIndicator(ev.indicatorId)?.name ?? ev.indicatorId;
      for (const id of ev.evidenceEventIds) m.set(id, [...(m.get(id) ?? []), `${name} (${ev.state})`]);
    }
    return m;
  }, [indicatorEvaluations]);

  const filtered = useMemo(() => applyFilters(events, filters, now), [events, filters, now]);
  // Region report counts ignore off-topic news (sport, entertainment …) whatever the feed toggle says.
  const relevantEvents = useMemo(() => events.filter((e) => !isOffTopic(e)), [events]);
  const projection = useMemo(() => projectEvents(filtered), [filtered]);
  const areaLevel = Object.values(projection.regionalCounts).reduce((a, b) => a + b, 0);
  const focusRegion = filters.regionId ? getRegion(filters.regionId) : undefined;

  // If the selected event is filtered out, drop the selection.
  useEffect(() => {
    if (selectedEventId && !filtered.some((e) => e.id === selectedEventId)) selectEvent(null);
  }, [filtered, selectedEventId, selectEvent]);

  const toggleBtn = (on: boolean) =>
    `flex h-5 items-center gap-1 border px-1.5 text-2xs ${on ? 'border-wt-fg/60 text-wt-fg' : 'border-wt-line text-wt-fg-dim hover:text-wt-fg-muted'}`;

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-1.5 lg:overflow-hidden">
      <div className="grid grid-cols-1 gap-1.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)_360px] 2xl:grid-cols-[290px_minmax(0,1fr)_420px]">
        <RegionalWatchlist
          events={relevantEvents}
          regionScores={regionScores}
          scoreHistory={scoreHistory}
          selectedRegionId={filters.regionId}
          onSelect={(id) => setFilters({ regionId: id })}
          now={now}
          className="order-3 h-[45vh] lg:order-none lg:h-auto"
        />

        <Panel
          title={focusRegion ? `Theatre // ${focusRegion.name}` : 'Theatre // Global'}
          designator="B1"
          className="order-1 h-[55vh] lg:order-none lg:h-auto"
          bodyClassName="relative"
          actions={
            <>
              <button
                className={toggleBtn(settings.graticule)}
                aria-pressed={settings.graticule}
                onClick={() => update({ graticule: !settings.graticule })}
              >
                <Grid3x3 size={10} aria-hidden /> GRID
              </button>
              <button
                className={toggleBtn(settings.regionOutlines)}
                aria-pressed={settings.regionOutlines}
                onClick={() => update({ regionOutlines: !settings.regionOutlines })}
              >
                <Square size={10} aria-hidden /> AREAS
              </button>
            </>
          }
        >
          <WorldMap
              events={filtered}
              selectedEventId={selectedEventId}
              focusRegionId={filters.regionId}
              onSelectEvent={selectEvent}
              onSelectRegion={(id) => setFilters({ regionId: id })}
              showGraticule={settings.graticule}
              showRegions={settings.regionOutlines}
              globalViewNonce={globalViewNonce}
            />
          <MapLegend plotted={projection.points.features.length} areaLevel={areaLevel} unlocated={projection.unlocated} />
        </Panel>

        <IntelFeed
          allEvents={events}
          events={filtered}
          filters={filters}
          onFiltersChange={setFilters}
          onResetFilters={resetFilters}
          selectedEventId={selectedEventId}
          onSelect={selectEvent}
          now={now}
          indicatorsByEvent={indicatorsByEvent}
          allowDossier={mode !== 'demo'}
          className="order-2 h-[75vh] lg:order-none lg:h-auto"
        />
      </div>
      <SystemStatusPanel now={now} />
    </div>
  );
}
