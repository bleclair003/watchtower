import { useEffect, useMemo, useState } from 'react';
import { Anchor, Ban, Grid3x3, Plane, Satellite, Shield, Ship, Square } from 'lucide-react';
import { useBases } from '../data/useInstallations';
import { ALL_OPERATORS, operatedBy, operatorCounts } from '@shared/domain/installations';
import { countryName } from '../lib/regionSummary';
import { InstallationCard } from '../components/map/InstallationCard';
import { AircraftCard } from '../components/map/AircraftCard';
import { FleetCard } from '../components/map/FleetCard';
import { ChokepointCard } from '../components/map/ChokepointCard';
import { SanctionedShipCard } from '../components/map/SanctionedShipCard';
import { sightingKey } from '../components/map/WorldMap';
import { IMAGERY, defaultImageryDate, imageryTiles, type ImageryId } from '../lib/imagery';
import { FLEET_STALE_DAYS, isBigDeck } from '@shared/domain/fleet';
import { AIRCRAFT_PROVIDERS, AIRCRAFT_STALE_MINUTES } from '@shared/domain/aircraft';
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
  const { events, regionScores, scoreHistory, indicatorEvaluations, mode, aircraft, fleet, chokepoints, sanctionedShips } = useData();
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
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const bases = useBases(settings.installations, settings.installations, selectedBase);
  const operator = settings.installationsOperator || ALL_OPERATORS;
  const operatorOptions = useMemo(
    () => (bases.us.data && bases.world.data ? operatorCounts(bases.us.data.count, bases.world.data.installations) : []),
    [bases.us.data, bases.world.data],
  );
  const shownUs = useMemo(() => (operator === ALL_OPERATORS || operator === 'US' ? bases.us.data?.installations : []), [operator, bases.us.data]);
  const shownWorld = useMemo(() => bases.world.data?.installations.filter((w) => operatedBy(w, operator)), [operator, bases.world.data]);
  // A selected base that the operator filter hides is deselected.
  useEffect(() => {
    if (!selectedBase) return;
    const visible = selectedBase.startsWith('dod:') ? (shownUs ?? []).some((i) => `dod:${i.name}` === selectedBase) : (shownWorld ?? []).some((w) => `wd:${w.q}` === selectedBase);
    if (!visible) setSelectedBase(null);
  }, [selectedBase, shownUs, shownWorld]);
  // Aircraft: a snapshot from the last collection run; not drawn once it is out of date.
  const [selectedAircraft, setSelectedAircraft] = useState<string | null>(null);
  const aircraftAgeMin = aircraft ? Math.max(0, Math.round((now - Date.parse(aircraft.fetchedAt)) / 60_000)) : 0;
  const aircraftStale = aircraftAgeMin > AIRCRAFT_STALE_MINUTES;
  const shownAircraft = settings.aircraft && aircraft && !aircraftStale ? aircraft.aircraft : undefined;
  const selectedPlane = selectedAircraft ? shownAircraft?.find((a) => a.hex === selectedAircraft) : undefined;
  // Fleet: the latest weekly USNI tracker; shown even when old, but labelled out of date.
  const [selectedFleetArea, setSelectedFleetArea] = useState<string | null>(null);
  const fleetStale = fleet ? now - Date.parse(`${fleet.asOf}T12:00:00Z`) > FLEET_STALE_DAYS * 86_400_000 : false;
  const shownFleet = settings.fleet && fleet ? fleet.areas : undefined;
  const selectedArea = selectedFleetArea ? shownFleet?.find((a) => a.name === selectedFleetArea) : undefined;
  const [selectedStrait, setSelectedStrait] = useState<string | null>(null);
  const shownStraits = settings.chokepoints && chokepoints ? chokepoints.items : undefined;
  const selectedStraitItem = selectedStrait ? shownStraits?.find((c) => c.id === selectedStrait) : undefined;
  // Satellite imagery: off by default; the day defaults to yesterday (today is still being filled in).
  const imageryId = (settings.imagery in IMAGERY ? settings.imagery : 'off') as ImageryId;
  const imageryDay = settings.imageryDate || defaultImageryDate(now);
  const imagery = useMemo(() => (imageryId === 'off' ? null : imageryTiles(imageryId, imageryDay)), [imageryId, imageryDay]);
  const [selectedListed, setSelectedListed] = useState<string | null>(null);
  const shownListed = settings.sanctionedShips && sanctionedShips ? sanctionedShips.sightings : undefined;
  const selectedListedShip = selectedListed ? shownListed?.find((s) => sightingKey(s) === selectedListed) : undefined;
  // One map card at a time: selecting a base, aircraft, fleet area, chokepoint or vessel clears the others.
  const selectOnly = (kind: 'base' | 'air' | 'fleet' | 'strait' | 'listed', key: string | null) => {
    setSelectedListed(kind === 'listed' ? key : null);
    setSelectedBase(kind === 'base' ? key : null);
    setSelectedAircraft(kind === 'air' ? key : null);
    setSelectedFleetArea(kind === 'fleet' ? key : null);
    setSelectedStrait(kind === 'strait' ? key : null);
  };
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
              <button
                className={toggleBtn(settings.installations)}
                aria-pressed={settings.installations}
                title="Military installations (DoD MIRTA, United States)"
                onClick={() => {
                  update({ installations: !settings.installations });
                  setSelectedBase(null);
                }}
              >
                <Shield size={10} aria-hidden /> BASES
              </button>
              <button
                className={toggleBtn(settings.aircraft)}
                aria-pressed={settings.aircraft}
                title="Military aircraft (ADS-B, adsb.lol) at the last collection run"
                onClick={() => {
                  update({ aircraft: !settings.aircraft });
                  setSelectedAircraft(null);
                }}
              >
                <Plane size={10} aria-hidden /> AIR
              </button>
              <button
                className={toggleBtn(settings.fleet)}
                aria-pressed={settings.fleet}
                title="US Navy ships by named sea area (USNI News Fleet Tracker, weekly, approximate)"
                onClick={() => {
                  update({ fleet: !settings.fleet });
                  setSelectedFleetArea(null);
                }}
              >
                <Anchor size={10} aria-hidden /> FLEET
              </button>
              <button
                className={toggleBtn(settings.chokepoints)}
                aria-pressed={settings.chokepoints}
                title="Ship traffic through six straits and canals (IMF PortWatch, daily, about 6 days behind)"
                onClick={() => {
                  update({ chokepoints: !settings.chokepoints });
                  setSelectedStrait(null);
                }}
              >
                <Ship size={10} aria-hidden /> STRAITS
              </button>
              <button
                className={toggleBtn(settings.sanctionedShips)}
                aria-pressed={settings.sanctionedShips}
                title="Ships on the US, EU or UK sanctions lists seen on AIS (Baltic and North Sea, last 48 h)"
                onClick={() => {
                  update({ sanctionedShips: !settings.sanctionedShips });
                  setSelectedListed(null);
                }}
              >
                <Ban size={10} aria-hidden /> SANCTIONED
              </button>
              <label className={`${toggleBtn(imageryId !== 'off')} cursor-pointer`} title="Satellite imagery under the map overlays (NASA GIBS)">
                <Satellite size={10} aria-hidden />
                <select
                  aria-label="Satellite imagery"
                  value={imageryId}
                  onChange={(e) => update({ imagery: e.target.value })}
                  className="bg-transparent text-2xs outline-none"
                >
                  <option value="off">IMAGERY OFF</option>
                  {Object.entries(IMAGERY).map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {imageryId !== 'off' && !IMAGERY[imageryId as Exclude<ImageryId, 'off'>].fixedDate && (
                <input
                  type="date"
                  aria-label="Imagery date"
                  value={imageryDay}
                  min="2018-01-05"
                  max={new Date(now).toISOString().slice(0, 10)}
                  onChange={(e) => update({ imageryDate: e.target.value })}
                  className="h-5 border border-wt-line-strong bg-wt-bg px-1 text-2xs text-wt-fg"
                />
              )}
              {settings.installations && operatorOptions.length > 0 && (
                <select
                  aria-label="Show bases operated by"
                  title="Operating country. Where Wikidata records no operator, the host country is assumed."
                  value={operator}
                  onChange={(e) => update({ installationsOperator: e.target.value })}
                  className="h-5 max-w-[11rem] border border-wt-line-strong bg-wt-bg px-1 text-2xs text-wt-fg"
                >
                  <option value={ALL_OPERATORS}>ALL OPERATORS ({(bases.us.data?.count ?? 0) + (bases.world.data?.count ?? 0)})</option>
                  {operatorOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {countryName(o.code)} ({o.count})
                    </option>
                  ))}
                </select>
              )}
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
              installations={shownUs}
              worldInstallations={shownWorld}
              showInstallations={settings.installations}
              selectedInstallation={selectedBase}
              onSelectInstallation={(key) => selectOnly('base', key)}
              aircraft={shownAircraft}
              showAircraft={settings.aircraft}
              selectedAircraft={selectedPlane ? selectedAircraft : null}
              onSelectAircraft={(hex) => selectOnly('air', hex)}
              fleetAreas={shownFleet}
              showFleet={settings.fleet}
              selectedFleetArea={selectedArea ? selectedFleetArea : null}
              onSelectFleetArea={(name) => selectOnly('fleet', name)}
              chokepoints={shownStraits}
              showChokepoints={settings.chokepoints}
              selectedChokepoint={selectedStraitItem ? selectedStrait : null}
              onSelectChokepoint={(id) => selectOnly('strait', id)}
              sanctionedShips={shownListed}
              showSanctionedShips={settings.sanctionedShips}
              selectedSanctionedShip={selectedListedShip ? selectedListed : null}
              onSelectSanctionedShip={(key) => selectOnly('listed', key)}
              imagery={imagery}
            />
          <MapLegend
            plotted={projection.points.features.length}
            areaLevel={areaLevel}
            unlocated={projection.unlocated}
            installations={settings.installations ? shownUs?.length : undefined}
            worldInstallations={settings.installations ? shownWorld?.length : undefined}
            operatorFilter={settings.installations && operator !== ALL_OPERATORS ? countryName(operator) : undefined}
            aircraft={
              settings.aircraft && aircraft
                ? { count: aircraft.aircraft.length, ageMinutes: aircraftAgeMin, stale: aircraftStale, provider: AIRCRAFT_PROVIDERS[aircraft.provider].name, simulated: !!aircraft.simulated }
                : undefined
            }
            imagery={imagery && imageryId !== 'off' ? { label: IMAGERY[imageryId as Exclude<ImageryId, 'off'>].label, date: imagery.date, note: IMAGERY[imageryId as Exclude<ImageryId, 'off'>].note } : undefined}
            sanctioned={
              settings.sanctionedShips && sanctionedShips
                ? {
                    count: sanctionedShips.sightings.length,
                    listenedMinutesAgo: Math.max(0, Math.round((now - Date.parse(sanctionedShips.listenedAt)) / 60_000)),
                    shipsHeard: sanctionedShips.ships,
                    simulated: !!sanctionedShips.simulated,
                  }
                : undefined
            }
            fleet={
              settings.fleet && fleet
                ? {
                    bigDecks: fleet.areas.flatMap((a) => a.ships).filter((s) => isBigDeck(s.hullType)).length,
                    ships: fleet.areas.reduce((n, a) => n + a.ships.length, 0),
                    asOf: fleet.asOf,
                    stale: fleetStale,
                    simulated: !!fleet.simulated,
                  }
                : undefined
            }
          />
          {selectedListedShip && sanctionedShips && <SanctionedShipCard ship={selectedListedShip} snapshot={sanctionedShips} now={now} onClose={() => setSelectedListed(null)} />}
          {!selectedListedShip && selectedStraitItem && chokepoints && <ChokepointCard item={selectedStraitItem} snapshot={chokepoints} now={now} onClose={() => setSelectedStrait(null)} />}
          {!selectedListedShip && !selectedStraitItem && selectedArea && fleet && <FleetCard area={selectedArea} snapshot={fleet} now={now} onClose={() => setSelectedFleetArea(null)} />}
          {!selectedListedShip && !selectedStraitItem && !selectedArea && selectedPlane && aircraft && <AircraftCard aircraft={selectedPlane} snapshot={aircraft} now={now} onClose={() => setSelectedAircraft(null)} />}
          {!selectedListedShip && !selectedStraitItem && !selectedArea && !selectedPlane && bases.selected && <InstallationCard selected={bases.selected} events={events} now={now} onClose={() => setSelectedBase(null)} />}
          {bases.error && settings.installations && <p className="absolute top-2 right-2 z-10 bg-wt-panel/95 px-2 py-1 text-2xs text-wt-warn">{bases.error}</p>}
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
