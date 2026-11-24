import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapTools } from '../components/map/MapTools';
import { decodeMapLink, encodeMapLink, validView, VIEW_STORAGE_KEY, type MapSelection, type MapView } from '../lib/mapLink';
import type { SearchItem } from '../lib/mapSearch';
import { formatLonLat, formatMeasurement, measure, type LonLat } from '../lib/measure';
import { BASEMAP_CREDIT, composeSnapshot, downloadCanvas, snapshotFileName } from '../lib/mapSnapshot';
import { IMAGERY_ATTRIBUTION } from '../lib/imagery';
import { readStorage, writeStorage } from '../lib/storage';
import { formatUtc } from '../lib/time';
import { unpackAirports, type Airport } from '@shared/domain/radio';
import { Anchor, Atom, Ban, Cable, Container, Crosshair, Factory, Flag, Grid3x3, LocateOff, Radar, Route, Target, Plane, PlaneLanding, Satellite, Shield, Ship, Siren, Square, Zap } from 'lucide-react';
import { GnssCard } from '../components/map/GnssCard';
import { ConvergenceCard } from '../components/map/ConvergenceCard';
import { SatelliteCard } from '../components/map/SatelliteCard';
import { groundTrack, subPoint, toSatrec } from '../lib/orbits';
import { useSatellites } from '../data/useSatellites';
import { useBases, useDisputed, useInfrastructure, useLanes, useUndersea } from '../data/useInstallations';
import { useShipTraffic } from '../data/useShipTraffic';
import { TrafficShipCard } from '../components/map/TrafficShipCard';
import { SANCTIONS_LISTS } from '@shared/domain/sanctions';
import { DisputedCard, UnderseaCard } from '../components/map/UnderseaCards';
import { AreaDrawPanel, draftShape, WatchAreaCard, type DrawMode } from '../components/map/WatchAreaPanels';
import { useWatchAreas } from '../state/WatchAreasContext';
import { areaContents } from '../lib/areaContents';
import { shapeRing } from '@shared/domain/watchAreas';
import { nearbyLines, underseaName, UNDERSEA_LABEL, type UnderseaKind } from '@shared/domain/undersea';
import { InfraCard } from '../components/map/InfraCard';
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
import { PATTERN_LEARNING_DAYS } from '@shared/domain/aircraftPatterns';
import { getRegion } from '@shared/domain/regions';
import { getIndicator } from '@shared/domain/indicators/catalog';
import { applyFilters } from '../lib/filters';
import { CONFLICT_SPANS, NAV_AGES, recentConflicts, recentNavWarnings } from '../lib/layerTime';
import { isOffTopic } from '@shared/domain/relevance';
import { projectEvents } from '../lib/geo';
import { useNow } from '../hooks/useNow';
import { useData } from '../state/DataContext';
import { useDashboard } from '../state/DashboardContext';
import { useSettings } from '../state/SettingsContext';
import { WorldMap, type WorldMapHandle } from '../components/map/WorldMap';
import { MapLegend } from '../components/map/MapLegend';
import { RegionalWatchlist } from '../components/goc/RegionalWatchlist';
import { IntelFeed } from '../components/goc/IntelFeed';
import { SystemStatusPanel } from '../components/goc/SystemStatusPanel';
import { Panel } from '../components/ui/Panel';

export default function GlobalOperationsPage() {
  // Re-evaluate time windows once a minute; the clock in the top bar ticks separately.
  const now = useNow(60_000).getTime();
  const { events, regionScores, scoreHistory, indicatorEvaluations, mode, aircraft, fleet, chokepoints, sanctionedShips, baseActivity, infrastructure, powerOutages, tfrs, airportStatus, radiation, navWarnings, aircraftEmergencies, conflictEvents, gnss, convergence } = useData();
  const unusualBases = useMemo(() => (baseActivity?.items ?? []).filter((i) => i.unusual).map((i) => i.key), [baseActivity]);
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
    if (!selectedBase || !bases.us.data || !bases.world.data) return;
    const visible = selectedBase.startsWith('dod:') ? (shownUs ?? []).some((i) => `dod:${i.name}` === selectedBase) : (shownWorld ?? []).some((w) => `wd:${w.q}` === selectedBase);
    if (!visible) setSelectedBase(null);
  }, [selectedBase, shownUs, shownWorld, bases.us.data, bases.world.data]);
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
  // Infrastructure: flagged sites always; all sites when INFRA is on (static file loaded on demand).
  const infraData = useInfrastructure(settings.infrastructure);
  const [selectedInfra, setSelectedInfra] = useState<string | null>(null);
  const flaggedInfra = infrastructure?.flagged ?? [];
  const selectedInfraSite = selectedInfra ? (infraData.data?.sites.find((s) => s.id === selectedInfra) ?? null) : null;
  const selectedInfraFlag = selectedInfra ? (flaggedInfra.find((f) => f.id === selectedInfra) ?? null) : null;
  // GPS interference squares (v0.69.0): the last hourly sample while under three hours old (the collector enforces it).
  const [selectedGnss, setSelectedGnss] = useState<string | null>(null);
  const shownGnss = settings.gnss && gnss ? gnss : null;
  const selectedGnssCell = selectedGnss ? (shownGnss?.cells.find((c) => c.k === selectedGnss) ?? null) : null;
  // Signal convergence hotspots (v0.79.0).
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const shownConv = settings.convergence && convergence ? convergence : null;
  const selectedHotspot = selectedConv ? (shownConv?.hotspots.find((h) => h.id === selectedConv) ?? null) : null;
  // Satellites (v0.84.0): positions recomputed every 20 s while the layer is on.
  const [selectedSatId, setSelectedSatId] = useState<string | null>(null);
  const satData = useSatellites(settings.satellites);
  const shownSats = settings.satellites ? satData.data : null;
  const satRecs = useMemo(() => (shownSats ? shownSats.sats.map((s) => ({ s, rec: toSatrec(s.el) })).filter((x) => x.rec) : []), [shownSats]);
  // Ticks every 20 s only while the layer is on (otherwise hourly), so the page is not re-rendered for nothing.
  const satTick = useNow(shownSats ? 20_000 : 3_600_000).getTime();
  const satPoints = useMemo(() => {
    const at = new Date(satTick);
    return satRecs.flatMap(({ s, rec }) => {
      const p = subPoint(rec!, at);
      return p ? [{ id: String(s.el.NORAD_CAT_ID), name: s.el.OBJECT_NAME, g: s.g, lat: p.lat, lon: p.lon }] : [];
    });
  }, [satRecs, satTick]);
  const selectedSat = selectedSatId ? (shownSats?.sats.find((s) => String(s.el.NORAD_CAT_ID) === selectedSatId) ?? null) : null;
  const satTrack = useMemo(() => {
    const r = selectedSat ? satRecs.find((x) => x.s === selectedSat)?.rec : null;
    return r ? groundTrack(r, Date.now() - 45 * 60_000, 90, 60) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the track is redrawn when the selection changes or every few minutes
  }, [selectedSat, satRecs, Math.floor(satTick / 300_000)]);
  // Undersea cables and pipelines, disputed areas (v0.71.0): static files loaded when their layer is on.
  // The undersea file is also loaded when a sanctioned ship is selected, to list lines near it.
  const [selectedCable, setSelectedCable] = useState<string | null>(null);
  const [selectedDisputedKey, setSelectedAreaKey] = useState<string | null>(null);
  // Declared here: the undersea data also loads for a selected tanker or cargo ship (v0.75.0).
  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  const underseaData = useUndersea(settings.undersea || !!selectedListed || !!selectedShip);
  const disputedData = useDisputed(settings.disputed);
  const shownUndersea = settings.undersea ? underseaData.data?.lines : undefined;
  const shownDisputed = settings.disputed ? disputedData.data?.features : undefined;
  const selectedCableLine = selectedCable ? (shownUndersea?.find((l) => l.id === selectedCable) ?? null) : null;
  const selectedAreaProps = selectedDisputedKey ? (shownDisputed?.find((f) => f.properties.id === selectedDisputedKey)?.properties ?? null) : null;
  // Tanker and cargo traffic and shipping lanes (v0.75.0): their own document / static file, loaded when on.
  const trafficData = useShipTraffic(settings.traffic);
  const lanesData = useLanes(settings.lanes);
  const shownTraffic = settings.traffic ? trafficData.data?.ships : undefined;
  const selectedTrafficShip = selectedShip ? (shownTraffic?.find((s) => s.mmsi === selectedShip) ?? null) : null;
  // Watch areas (v0.74.0): shared areas drawn by the owner and editors.
  const watch = useWatchAreas();
  const [selectedWatch, setSelectedWatch] = useState<string | null>(null);
  const shownAreas = settings.watchAreas ? watch.areas : [];
  const selectedWatchArea = selectedWatch ? (shownAreas.find((a) => a.id === selectedWatch) ?? null) : null;
  const [drawing, setDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>('circle');
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [drawFinished, setDrawFinished] = useState(false);
  const stopDrawing = () => {
    setDrawing(false);
    setDrawPoints([]);
    setDrawFinished(false);
  };
  // One map card at a time: selecting a base, aircraft, fleet area, chokepoint, vessel, site, square, line or area clears the others.
  const selectOnly = (kind: 'base' | 'air' | 'fleet' | 'strait' | 'listed' | 'infra' | 'gnss' | 'cable' | 'area' | 'warea' | 'ship' | 'conv' | 'sat', key: string | null) => {
    setSelectedConv(kind === 'conv' ? key : null);
    setSelectedSatId(kind === 'sat' ? key : null);
    if (kind === 'sat' && key && !settings.satellites) update({ satellites: true });
    setSelectedShip(kind === 'ship' ? key : null);
    setSelectedWatch(kind === 'warea' ? key : null);
    setSelectedGnss(kind === 'gnss' ? key : null);
    setSelectedCable(kind === 'cable' ? key : null);
    setSelectedAreaKey(kind === 'area' ? key : null);
    setSelectedInfra(kind === 'infra' ? key : null);
    setSelectedListed(kind === 'listed' ? key : null);
    setSelectedBase(kind === 'base' ? key : null);
    setSelectedAircraft(kind === 'air' ? key : null);
    setSelectedFleetArea(kind === 'fleet' ? key : null);
    setSelectedStrait(kind === 'strait' ? key : null);
  };
  // ------------------------------------------------------ map tools (v0.68.0) --
  const location = useLocation();
  const navigate = useNavigate();
  // A link's state is read once, when the page opens; after that the page writes the address bar.
  const [link] = useState(() => decodeMapLink(location.search));
  const [initialView] = useState<MapView | null>(() => link?.view ?? validView(readStorage<unknown>(VIEW_STORAGE_KEY, null)));
  const [view, setView] = useState<MapView | null>(initialView);
  const [measuring, setMeasuring] = useState(false);
  const [ruler, setRuler] = useState<LonLat[]>(() => link?.ruler ?? []);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [airports, setAirports] = useState<Airport[] | undefined>(undefined);
  const mapHandle = useRef<WorldMapHandle | null>(null);
  useEffect(() => {
    if (!link) return;
    if (Object.keys(link.settings).length) update(link.settings);
    if (Object.keys(link.filters).length) setFilters(link.filters);
    const s = link.selection;
    if (s?.kind === 'event') selectEvent(s.key);
    else if (s) {
      const kind = ({ base: 'base', air: 'air', fleet: 'fleet', strait: 'strait', listed: 'listed', infra: 'infra', gnss: 'gnss', cable: 'cable', area: 'area', warea: 'warea', ship: 'ship', conv: 'conv', sat: 'sat' } as const)[s.kind];
      selectOnly(kind, s.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply the opening link once
  }, []);
  const selection: MapSelection | null = selectedSatId
    ? { kind: 'sat', key: selectedSatId }
    : selectedConv
    ? { kind: 'conv', key: selectedConv }
    : selectedShip
    ? { kind: 'ship', key: selectedShip }
    : selectedWatch
    ? { kind: 'warea', key: selectedWatch }
    : selectedCable
    ? { kind: 'cable', key: selectedCable }
    : selectedDisputedKey
    ? { kind: 'area', key: selectedDisputedKey }
    : selectedGnss
    ? { kind: 'gnss', key: selectedGnss }
    : selectedInfra
    ? { kind: 'infra', key: selectedInfra }
    : selectedListed
      ? { kind: 'listed', key: selectedListed }
      : selectedStrait
        ? { kind: 'strait', key: selectedStrait }
        : selectedFleetArea
          ? { kind: 'fleet', key: selectedFleetArea }
          : selectedAircraft
            ? { kind: 'air', key: selectedAircraft }
            : selectedBase
              ? { kind: 'base', key: selectedBase }
              : selectedEventId
                ? { kind: 'event', key: selectedEventId }
                : null;
  const search = encodeMapLink({ view, settings, filters, selection, ruler: ruler.length === 2 ? [ruler[0], ruler[1]] : null });
  useEffect(() => {
    if (`?${search}` !== location.search) navigate({ search: `?${search}` }, { replace: true });
  }, [search, location.search, navigate]);
  const onViewChange = useCallback((v: MapView) => {
    setView(v);
    writeStorage(VIEW_STORAGE_KEY, v);
  }, []);
  const onRulerPoint = useCallback((p: LonLat) => setRuler((r) => (r.length >= 2 ? [p] : [...r, p])), []);
  useEffect(() => {
    if (!measuring && !drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMeasuring(false);
      setDrawing(false);
      setDrawPoints([]);
      setDrawFinished(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measuring, drawing]);
  const loadAirports = useCallback(() => {
    import('@shared/domain/airportsData').then((m) => setAirports(unpackAirports(m.AIRPORTS_PACKED)), () => setAirports([]));
  }, []);
  const searchSources = useMemo(
    () => ({
      bases: settings.installations ? shownUs : undefined,
      worldBases: settings.installations ? shownWorld : undefined,
      aircraft: shownAircraft,
      ships: shownListed,
      fleet: shownFleet,
      straits: shownStraits,
      infra: settings.infrastructure ? infraData.data?.sites : undefined,
      flaggedInfra,
      airports,
      undersea: shownUndersea,
      disputed: shownDisputed,
      traffic: shownTraffic,
    }),
    [settings.installations, settings.infrastructure, shownUs, shownWorld, shownAircraft, shownListed, shownFleet, shownStraits, infraData.data, flaggedInfra, airports, shownUndersea, shownDisputed, shownTraffic],
  );
  const notSearched = [
    !settings.installations && 'BASES',
    !shownAircraft && 'AIR',
    !shownListed && 'SANCTIONED',
    !shownFleet && 'FLEET',
    !shownStraits && 'STRAITS',
    !settings.infrastructure && 'INFRA (flagged sites only)',
    !settings.undersea && 'CABLES',
    !settings.traffic && 'SHIPS',
    !settings.disputed && 'DISPUTED',
  ].filter((x): x is string => !!x);
  const onPick = (it: SearchItem) => {
    setPin(null);
    if (it.kind === 'region' && it.regionId) {
      setFilters({ regionId: it.regionId });
      return;
    }
    if (it.select && it.select.kind !== 'event') selectOnly(it.select.kind, it.select.key);
    else setPin({ lat: it.lat, lon: it.lon });
    mapHandle.current?.flyTo(it.lat, it.lon, it.kind === 'airport' ? 8 : undefined);
  };
  const copyLink = async (): Promise<string | null> => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      return null;
    } catch {
      return url;
    }
  };
  const layerNames = (
    [
      [settings.installations, 'BASES'],
      [shownAircraft, 'AIR'],
      [settings.fleet, 'FLEET'],
      [settings.chokepoints, 'STRAITS'],
      [settings.sanctionedShips, 'SANCTIONED'],
      [settings.infrastructure, 'INFRA'],
      [settings.powerOutages, 'POWER'],
      [settings.faa, 'FAA'],
      [settings.radiation, 'RAD'],
      [settings.navWarnings, 'NAVWARN'],
      [settings.conflicts, 'CONFLICT'],
      [shownGnss, 'GPS'],
      [shownConv, 'CONVERGE'],
      [shownSats, 'SATS'],
      [settings.undersea, 'CABLES'],
      [settings.traffic, 'SHIPS'],
      [settings.lanes, 'LANES'],
      [settings.disputed, 'DISPUTED'],
      [settings.watchAreas && watch.areas.length > 0, 'WATCH AREAS'],
    ] as [unknown, string][]
  )
    .filter(([on]) => !!on)
    .map(([, n]) => n);
  const takeSnapshot = async (): Promise<string | null> => {
    const h = mapHandle.current;
    if (!h) return 'MAP NOT READY';
    try {
      const frame = await h.capture();
      const v = h.view();
      const when = new Date();
      const m = ruler.length === 2 ? measure(ruler[0], ruler[1]) : null;
      const header = [
        `WATCHTOWER · GOC MAP · ${formatUtc(when.toISOString())}${mode === 'demo' ? ' · DEMO DATA (SIMULATED)' : ''}`,
        `Layers: ${layerNames.join(', ') || 'none'} · Feed: ${projection.points.features.length} plotted, window ${filters.windowHours == null ? 'all' : `${filters.windowHours} h`}${focusRegion ? ` · Region: ${focusRegion.name}` : ''}`,
        `Centre ${formatLonLat([v.lon, v.lat])} · zoom ${v.zoom.toFixed(1)}${m ? ` · Ruler ${formatLonLat(ruler[0])} → ${formatLonLat(ruler[1])}: ${formatMeasurement(m)}` : ''}`,
      ];
      const footer = [BASEMAP_CREDIT + (imagery ? ` · ${IMAGERY_ATTRIBUTION}` : ''), `Link: ${window.location.href}`];
      const out = composeSnapshot(frame, header, footer, window.devicePixelRatio || 1);
      return (await downloadCanvas(out, snapshotFileName(when))) ? null : 'SNAPSHOT FAILED';
    } catch (e) {
      return `SNAPSHOT FAILED: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  // Region report counts ignore off-topic news (sport, entertainment …) whatever the feed toggle says.
  const relevantEvents = useMemo(() => events.filter((e) => !isOffTopic(e)), [events]);
  // Time filters for the dated map layers (v0.61.0).
  const conflictWindow = useMemo(() => recentConflicts(conflictEvents?.events ?? [], settings.conflictDays), [conflictEvents, settings.conflictDays]);
  const shownNavWarnings = useMemo(() => recentNavWarnings(navWarnings?.warnings ?? [], settings.navWarnDays, now), [navWarnings, settings.navWarnDays, now]);
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
          indicatorEvaluations={indicatorEvaluations}
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
              <button
                className={toggleBtn(settings.infrastructure)}
                aria-pressed={settings.infrastructure}
                title="Power plants, nuclear sites, refineries, dams and ports (WRI, Wikidata). Sites with records near or naming them are always shown, ringed red."
                onClick={() => {
                  update({ infrastructure: !settings.infrastructure });
                  if (selectedInfra && !selectedInfraFlag) setSelectedInfra(null);
                }}
              >
                <Factory size={10} aria-hidden /> INFRA
              </button>
              <button
                className={toggleBtn(settings.powerOutages)}
                aria-pressed={settings.powerOutages}
                title="US counties with customers without power (ODIN: utilities reporting to the US Department of Energy / Oak Ridge National Laboratory)"
                onClick={() => update({ powerOutages: !settings.powerOutages })}
              >
                <Zap size={10} aria-hidden /> POWER
              </button>
              <button
                className={toggleBtn(settings.faa)}
                aria-pressed={settings.faa}
                title="FAA VIP, security and special flight restrictions, and airports with ground stops, delay programs, delays or closures"
                onClick={() => update({ faa: !settings.faa })}
              >
                <PlaneLanding size={10} aria-hidden /> FAA
              </button>
              <button
                className={toggleBtn(settings.radiation)}
                aria-pressed={settings.radiation}
                title="Radiation stations above their usual level (Germany BfS, Finland STUK, US EPA RadNet)"
                onClick={() => update({ radiation: !settings.radiation })}
              >
                <Atom size={10} aria-hidden /> RAD
              </button>
              <button
                className={toggleBtn(settings.navWarnings)}
                aria-pressed={settings.navWarnings}
                title="NGA navigational warnings: missile and rocket firings, live firing, military exercises, GPS interference, piracy, mines, cable work"
                onClick={() => update({ navWarnings: !settings.navWarnings })}
              >
                <Siren size={10} aria-hidden /> NAVWARN
              </button>
              {settings.navWarnings && (
                <select
                  aria-label="Navigational warnings issued within"
                  title="Show only warnings issued recently. Warnings with no issue date are hidden when a limit is set."
                  value={settings.navWarnDays ?? ''}
                  onChange={(e) => update({ navWarnDays: e.target.value ? Number(e.target.value) : null })}
                  className="h-5 border border-wt-line-strong bg-wt-bg px-1 text-2xs text-wt-fg"
                >
                  {NAV_AGES.map((o) => (
                    <option key={o.label} value={o.days ?? ''}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                className={toggleBtn(settings.traffic)}
                aria-pressed={settings.traffic}
                title="Tankers and cargo ships with their last 24 hours (AIS: Baltic, North Sea, Black Sea, eastern Mediterranean)"
                onClick={() => {
                  update({ traffic: !settings.traffic });
                  setSelectedShip(null);
                }}
              >
                <Container size={10} aria-hidden /> SHIPS
              </button>
              <button
                className={toggleBtn(settings.lanes)}
                aria-pressed={settings.lanes}
                title="Commercial shipping lanes, major to minor (static, CIA ocean map via Benden 2022)"
                onClick={() => update({ lanes: !settings.lanes })}
              >
                <Route size={10} aria-hidden /> LANES
              </button>
              <button
                className={toggleBtn(settings.watchAreas)}
                aria-pressed={settings.watchAreas}
                title="Watch areas drawn with the AREA tool on the map (shared with every member)"
                onClick={() => {
                  update({ watchAreas: !settings.watchAreas });
                  setSelectedWatch(null);
                }}
              >
                <Target size={10} aria-hidden /> WATCH
              </button>
              <button
                className={toggleBtn(settings.undersea)}
                aria-pressed={settings.undersea}
                title="Undersea telecom cables, power cables (100 kV+) and oil and gas pipelines in the watch-region seas (OpenStreetMap)"
                onClick={() => {
                  update({ undersea: !settings.undersea });
                  setSelectedCable(null);
                }}
              >
                <Cable size={10} aria-hidden /> CABLES
              </button>
              <button
                className={toggleBtn(settings.disputed)}
                aria-pressed={settings.disputed}
                title="Disputed areas, breakaway regions and buffer zones (Natural Earth), with who administers and who claims them"
                onClick={() => {
                  update({ disputed: !settings.disputed });
                  setSelectedAreaKey(null);
                }}
              >
                <Flag size={10} aria-hidden /> DISPUTED
              </button>
              <button
                className={toggleBtn(settings.convergence)}
                aria-pressed={settings.convergence}
                title="Signal convergence: places where different kinds of signal from separate feeds line up within 150 km, last 72 hours"
                onClick={() => {
                  update({ convergence: !settings.convergence });
                  setSelectedConv(null);
                }}
              >
                <Radar size={10} aria-hidden /> CONVERGE
              </button>
              <button
                className={toggleBtn(settings.satellites)}
                aria-pressed={settings.satellites}
                title="Satellites: military satellites with public orbits and Earth imaging satellites, positions computed from CelesTrak elements"
                onClick={() => {
                  update({ satellites: !settings.satellites });
                  setSelectedSatId(null);
                }}
              >
                <Satellite size={10} aria-hidden /> SATS
              </button>
              <button
                className={toggleBtn(settings.gnss)}
                aria-pressed={settings.gnss}
                title="GPS interference: share of aircraft reporting degraded GPS accuracy per 1° square, last 24 hours (adsb.lol, sampled hourly)"
                onClick={() => {
                  update({ gnss: !settings.gnss });
                  setSelectedGnss(null);
                }}
              >
                <LocateOff size={10} aria-hidden /> GPS
              </button>
              <button
                className={toggleBtn(settings.conflicts)}
                aria-pressed={settings.conflicts}
                title="UCDP conflict events in the watch regions, last monthly release (about a month behind)"
                onClick={() => update({ conflicts: !settings.conflicts })}
              >
                <Crosshair size={10} aria-hidden /> CONFLICT
              </button>
              {settings.conflicts && (
                <select
                  aria-label="Conflict events shown"
                  title="UCDP runs about a month behind, so recent means the last days of the latest release, not the last days before today."
                  value={settings.conflictDays ?? ''}
                  onChange={(e) => update({ conflictDays: e.target.value ? Number(e.target.value) : null })}
                  className="h-5 border border-wt-line-strong bg-wt-bg px-1 text-2xs text-wt-fg"
                >
                  {CONFLICT_SPANS.map((o) => (
                    <option key={o.label} value={o.days ?? ''}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
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
              unusualInstallations={unusualBases}
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
              infraSites={settings.infrastructure ? infraData.data?.sites : undefined}
              showInfrastructure={settings.infrastructure}
              flaggedInfra={flaggedInfra}
              selectedInfra={selectedInfra}
              onSelectInfra={(id) => selectOnly('infra', id)}
              powerOutages={settings.powerOutages ? (powerOutages?.counties ?? []) : []}
              tfrs={settings.faa ? (tfrs?.items ?? []) : []}
              airports={settings.faa ? (airportStatus?.events ?? []) : []}
              radiation={settings.radiation ? (radiation?.flagged ?? []) : []}
              navWarnings={settings.navWarnings ? shownNavWarnings : []}
              emergencies={settings.aircraft ? (aircraftEmergencies?.aircraft ?? []) : []}
              conflicts={settings.conflicts ? conflictWindow.events : []}
              traffic={shownTraffic ?? []}
              trafficDark={settings.traffic ? (trafficData.data?.dark ?? []) : []}
              selectedTraffic={selectedTrafficShip ? selectedShip : null}
              onSelectTraffic={(mmsi) => selectOnly('ship', mmsi)}
              lanes={settings.lanes ? lanesData.data?.lanes : []}
              watchAreas={shownAreas}
              selectedWatchArea={selectedWatchArea ? selectedWatch : null}
              onSelectWatchArea={(id) => selectOnly('warea', id)}
              drawing={drawing && !draftShape(drawMode, drawPoints, drawFinished)}
              onDrawClick={(p) => {
                if (drawMode === 'circle') setDrawPoints((pts) => (pts.length >= 2 ? [p] : [...pts, p]));
                else setDrawPoints((pts) => (pts.length >= 50 ? pts : [...pts, p]));
              }}
              draft={
                drawing
                  ? (() => {
                      const sh = draftShape(drawMode, drawPoints, drawFinished);
                      return { ring: sh ? shapeRing(sh) : null, points: sh?.kind === 'circle' ? [[sh.lon, sh.lat] as [number, number]] : drawPoints };
                    })()
                  : null
              }
              undersea={shownUndersea ?? []}
              selectedUndersea={selectedCableLine ? selectedCable : null}
              onSelectUndersea={(id) => selectOnly('cable', id)}
              disputed={shownDisputed ?? []}
              selectedDisputed={selectedAreaProps ? selectedDisputedKey : null}
              onSelectDisputed={(id) => selectOnly('area', id)}
              gnssCells={shownGnss?.cells ?? []}
              gnssLost={shownGnss?.lost ?? []}
              gnssCircles={shownGnss?.circles ?? []}
              selectedGnss={selectedGnssCell ? selectedGnss : null}
              onSelectGnss={(k) => selectOnly('gnss', k)}
              satellites={satPoints}
              satTrack={satTrack}
              selectedSat={selectedSat ? selectedSatId : null}
              onSelectSat={(id) => selectOnly('sat', id)}
              convergence={shownConv?.hotspots ?? []}
              selectedConvergence={selectedHotspot ? selectedConv : null}
              onSelectConvergence={(id) => selectOnly('conv', id)}
              initialView={initialView}
              onViewChange={onViewChange}
              measuring={measuring}
              ruler={ruler}
              onRulerPoint={onRulerPoint}
              pin={pin}
              handleRef={mapHandle}
            />
          <MapTools
            sources={searchSources}
            notSearched={notSearched}
            onPick={onPick}
            onSearchCleared={() => setPin(null)}
            onNeedAirports={loadAirports}
            measuring={measuring}
            onMeasuring={setMeasuring}
            ruler={ruler}
            onClearRuler={() => setRuler([])}
            onCopyLink={copyLink}
            onSnapshot={takeSnapshot}
            drawing={drawing}
            onDraw={
              watch.canEdit
                ? (on) => {
                    stopDrawing();
                    setDrawing(on);
                    if (on) {
                      setMeasuring(false);
                      update({ watchAreas: true });
                    }
                  }
                : undefined
            }
            extra={
              drawing ? (
                <AreaDrawPanel
                  mode={drawMode}
                  onMode={(m) => {
                    setDrawMode(m);
                    setDrawPoints([]);
                    setDrawFinished(false);
                  }}
                  points={drawPoints}
                  finished={drawFinished}
                  onFinish={() => setDrawFinished(true)}
                  onUndo={() => {
                    setDrawFinished(false);
                    setDrawPoints((p) => p.slice(0, -1));
                  }}
                  onCancel={stopDrawing}
                  storage={watch.storage}
                  onSave={async (a) => {
                    await watch.save(a);
                    stopDrawing();
                    selectOnly('warea', a.id);
                  }}
                />
              ) : undefined
            }
          />
          <MapLegend
            plotted={projection.points.features.length}
            areaLevel={areaLevel}
            unlocated={projection.unlocated}
            installations={settings.installations ? shownUs?.length : undefined}
            worldInstallations={settings.installations ? shownWorld?.length : undefined}
            unusualBases={baseActivity?.flagsActive ? unusualBases.length : null}
            infrastructure={settings.infrastructure || flaggedInfra.length ? { all: settings.infrastructure ? (infraData.data?.count ?? null) : null, flagged: flaggedInfra.length, simulated: !!infrastructure?.simulated } : undefined}
            power={settings.powerOutages && powerOutages ? { total: powerOutages.totalOut, states: powerOutages.states.length, counties: powerOutages.counties.length, utilities: powerOutages.utilitiesReporting, ageMinutes: Math.max(0, Math.round((now - Date.parse(powerOutages.fetchedAt)) / 60_000)), simulated: !!powerOutages.simulated } : undefined}
            radiation={settings.radiation && radiation ? radiation : undefined}
            traffic={
              settings.traffic
                ? trafficData.data
                  ? {
                      tankers: trafficData.data.ships.filter((s) => s.kind === 'tanker').length,
                      cargo: trafficData.data.ships.filter((s) => s.kind === 'cargo').length,
                      typesKnown: trafficData.data.typesKnown,
                      totalSeen: trafficData.data.totalSeen,
                      ageMinutes: Math.max(0, Math.round((now - Date.parse(trafficData.data.fetchedAt)) / 60_000)),
                      simulated: !!trafficData.data.simulated,
                      fintraffic: trafficData.data.fintraffic ?? null,
                      dark: trafficData.data.dark?.length ?? 0,
                    }
                  : null
                : undefined
            }
            lanes={settings.lanes}
            undersea={settings.undersea ? (underseaData.data ? (Object.fromEntries((['telecom', 'power', 'pipeline'] as UnderseaKind[]).map((k) => [k, underseaData.data!.lines.filter((l) => l.k === k).length])) as Record<UnderseaKind, number>) : null) : undefined}
            disputed={settings.disputed ? (disputedData.data?.features.length ?? null) : undefined}
            convergence={shownConv ?? undefined}
            gnss={shownGnss ? { ...shownGnss, ageMinutes: Math.max(0, Math.round((now - Date.parse(shownGnss.fetchedAt)) / 60_000)) } : undefined}
            navWarnings={settings.navWarnings && navWarnings ? { ...navWarnings, warnings: shownNavWarnings } : undefined}
            navWarnDays={settings.navWarnDays}
            emergencies={settings.aircraft && aircraftEmergencies ? aircraftEmergencies : undefined}
            conflicts={settings.conflicts && conflictEvents ? { ...conflictEvents, events: conflictWindow.events } : undefined}
            conflictWindow={settings.conflicts && conflictEvents ? { from: conflictWindow.from, to: conflictWindow.to, days: settings.conflictDays, total: conflictEvents.events.length } : undefined}
            faa={settings.faa && (tfrs || airportStatus) ? { tfrs: tfrs?.items ?? [], airports: airportStatus?.events ?? [], now, simulated: !!(tfrs?.simulated || airportStatus?.simulated) } : undefined}
            operatorFilter={settings.installations && operator !== ALL_OPERATORS ? countryName(operator) : undefined}
            aircraft={
              settings.aircraft && aircraft
                ? { count: aircraft.aircraft.length, ageMinutes: aircraftAgeMin, stale: aircraftStale, provider: AIRCRAFT_PROVIDERS[aircraft.provider].name, simulated: !!aircraft.simulated, patternsFrom: aircraft.patternMemorySince ? new Date(Date.parse(aircraft.patternMemorySince) + PATTERN_LEARNING_DAYS * 86_400_000).toISOString() : null, now }
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
          {selectedTrafficShip && trafficData.data && (
            <TrafficShipCard
              ship={selectedTrafficShip}
              doc={trafficData.data}
              now={now}
              onClose={() => setSelectedShip(null)}
              sanctioned={(() => {
                const hit = (sanctionedShips?.sightings ?? []).find((x) => x.mmsi === selectedTrafficShip.mmsi || (!!x.imo && x.imo === selectedTrafficShip.imo));
                return hit ? { listedName: hit.listedName, lists: hit.lists.map((l) => SANCTIONS_LISTS[l].short).join('/') } : null;
              })()}
              nearLines={underseaData.data ? nearbyLines(underseaData.data.lines, selectedTrafficShip.la, selectedTrafficShip.lo, 20).map(({ line, km }) => ({ name: underseaName(line), kind: UNDERSEA_LABEL[line.k].toLowerCase(), km })) : undefined}
            />
          )}
          {selectedWatchArea && (
            <WatchAreaCard
              area={selectedWatchArea}
              now={now}
              canEdit={watch.canEdit}
              onSave={watch.save}
              onDelete={async () => {
                await watch.remove(selectedWatchArea.id);
                setSelectedWatch(null);
              }}
              onClose={() => setSelectedWatch(null)}
              contents={areaContents(selectedWatchArea.shape, {
                events,
                aircraft: shownAircraft,
                emergencies: aircraftEmergencies?.aircraft,
                ships: sanctionedShips?.sightings,
                navWarnings: navWarnings?.warnings,
                gnssCells: gnss?.cells,
                lostGps: gnss?.lost,
                conflicts: conflictEvents?.events,
                bases: bases.us.data?.installations,
                worldBases: bases.world.data?.installations,
                sites: infraData.data?.sites,
                flaggedSites: flaggedInfra,
                lines: underseaData.data?.lines,
              })}
            />
          )}
          {selectedCableLine && underseaData.data && (
            <UnderseaCard line={selectedCableLine} dataset={underseaData.data} ships={sanctionedShips?.sightings ?? []} warnings={navWarnings?.warnings ?? []} onClose={() => setSelectedCable(null)} />
          )}
          {selectedAreaProps && <DisputedCard area={selectedAreaProps} onClose={() => setSelectedAreaKey(null)} />}
          {selectedSat && shownSats && <SatelliteCard sat={selectedSat} snapshot={shownSats} now={satTick} onClose={() => setSelectedSatId(null)} />}
          {selectedHotspot && shownConv && <ConvergenceCard hotspot={selectedHotspot} snapshot={shownConv} now={now} onClose={() => setSelectedConv(null)} />}
          {selectedGnssCell && shownGnss && <GnssCard cell={selectedGnssCell} snapshot={shownGnss} warnings={navWarnings?.warnings ?? []} now={now} onClose={() => setSelectedGnss(null)} />}
          {(selectedInfraSite || selectedInfraFlag) && <InfraCard site={selectedInfraSite} flagged={selectedInfraFlag} dataset={infraData.data} now={now} onClose={() => setSelectedInfra(null)} />}
          {!selectedInfra && selectedListedShip && sanctionedShips && <SanctionedShipCard ship={selectedListedShip} snapshot={sanctionedShips} now={now} onClose={() => setSelectedListed(null)} nearLines={underseaData.data ? nearbyLines(underseaData.data.lines, selectedListedShip.la, selectedListedShip.lo, 20).map(({ line, km }) => ({ name: underseaName(line), kind: UNDERSEA_LABEL[line.k].toLowerCase(), km })) : undefined} />}
          {!selectedInfra && !selectedListedShip && selectedStraitItem && chokepoints && <ChokepointCard item={selectedStraitItem} snapshot={chokepoints} now={now} onClose={() => setSelectedStrait(null)} />}
          {!selectedInfra && !selectedListedShip && !selectedStraitItem && selectedArea && fleet && <FleetCard area={selectedArea} snapshot={fleet} now={now} onClose={() => setSelectedFleetArea(null)} />}
          {!selectedInfra && !selectedListedShip && !selectedStraitItem && !selectedArea && selectedPlane && aircraft && <AircraftCard aircraft={selectedPlane} snapshot={aircraft} now={now} onClose={() => setSelectedAircraft(null)} />}
          {!selectedInfra && !selectedListedShip && !selectedStraitItem && !selectedArea && !selectedPlane && bases.selected && <InstallationCard selected={bases.selected} events={events} now={now} onClose={() => setSelectedBase(null)} activity={baseActivity} />}
          {bases.error && settings.installations && <p className="absolute top-2 right-2 z-10 bg-wt-panel/95 px-2 py-1 text-2xs text-wt-warn">{bases.error}</p>}
          {trafficData.error && settings.traffic && <p className="absolute top-9 right-2 z-10 max-w-[260px] bg-wt-panel/95 px-2 py-1 text-2xs text-wt-warn">{trafficData.error}</p>}
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
