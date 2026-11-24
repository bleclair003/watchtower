import { useEffect, useRef, useState } from 'react';
import { AIRCRAFT_CLASS_LABEL, aircraftLabel, aircraftTypeName, type AircraftClass, type AircraftPosition } from '@shared/domain/aircraft';
import { isBigDeck, type FleetArea } from '@shared/domain/fleet';
import type { ChokepointReading } from '@shared/domain/chokepoints';
import type { FlaggedSite, InfraSite, InfraType } from '@shared/domain/infrastructure';
import { unpackRings, type PowerOutageCounty } from '@shared/domain/powerOutages';
import { AIRPORT_KIND_LABEL, tfrActive, type AirportEvent, type TfrShape } from '@shared/domain/faa';
import { ratioOf, type FlaggedStation } from '@shared/domain/radiation';
import { NAV_KIND_LABEL, type NavWarning, type NavWarningKind } from '@shared/domain/navWarnings';
import { SQUAWK_LABEL, emergencyLabel, emergencyTiming, type EmergencyAircraft } from '@shared/domain/aircraftEmergencies';
import { VIOLENCE_LABEL, type ConflictEvent, type ViolenceType } from '@shared/domain/conflictEvents';
import type { SanctionedShipSighting } from '@shared/domain/sanctionedShips';
import { IMAGERY_ATTRIBUTION } from '../../lib/imagery';
import { componentOf, operationOf, type Branch, type Installation, type Operation, type WorldInstallation } from '@shared/domain/installations';
import '../../lib/maplibreSetup';
import { Map as MLMap, NavigationControl, Popup, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from 'maplibre-gl';
import { EVENT_CATEGORIES, type IntelligenceEvent } from '@shared/domain/types';
import { WATCH_REGIONS, getRegion } from '@shared/domain/regions';
import { CATEGORY_STYLES } from '../../config/categories';
import { BASEMAP_STYLE_URL, findTextFont, militarizeStyle } from '../../lib/mapStyle';
import { graticule, isPlottable, projectEvents, regionAreas } from '../../lib/geo';
import { circleRing, greatCirclePath, KM_PER_NM, type LonLat } from '../../lib/measure';
import type { UnderseaKind, UnderseaLine } from '@shared/domain/undersea';
import { trackPoints, type LaneClass, type TrafficKind, type TrafficShip } from '@shared/domain/shipTraffic';
import type { DisputedDataset } from '@shared/domain/disputed';
import { shapeCentre, shapeRing, type WatchArea } from '@shared/domain/watchAreas';
import { cellBounds, GNSS_RADIUS_NM, type GnssCell, type GnssCircle, type GnssLevel, type GnssLostPoint } from '@shared/domain/gnss';
import type { MapView } from '../../lib/mapLink';

/** Imperative handle for map tools (v0.68.0): fly somewhere, or capture the current frame. */
export interface WorldMapHandle {
  flyTo: (lat: number, lon: number, zoom?: number) => void;
  fitBounds: (bbox: [number, number, number, number]) => void;
  /** The map canvas as drawn in the next frame (overlays included, HTML cards and legend not). */
  capture: () => Promise<HTMLCanvasElement>;
  view: () => MapView;
}
export const RULER_COLOR = '#ffd166';
/** GPS interference squares by level (v0.69.0); lost-GPS points use the high colour. */
/** Undersea lines by kind, and the disputed-area tint (v0.71.0). */
export const UNDERSEA_COLOR: Record<UnderseaKind, string> = { telecom: '#5ec8ff', power: '#f6a04d', pipeline: '#c084fc' };
export const DISPUTED_COLOR = '#e8b04a';
/** Tanker and cargo traffic and shipping lanes (v0.75.0). */
export const TRAFFIC_COLOR: Record<TrafficKind, string> = { tanker: '#ff9f43', cargo: '#4fc3f7' };
export const LANE_COLOR = '#5b7f93';
/** Watch areas the user drew (v0.74.0). */
export const WATCH_AREA_COLOR = '#7dd3fc';
export const GNSS_COLOR: Record<GnssLevel, string> = { low: '#2f6a4c', medium: '#ffb347', high: '#ff4d6d' };

export interface WorldMapProps {
  events: IntelligenceEvent[];
  selectedEventId: string | null;
  focusRegionId: string | null;
  onSelectEvent: (id: string | null) => void;
  onSelectRegion: (id: string) => void;
  showGraticule: boolean;
  showRegions: boolean;
  /** Increment to fly back to the global view. */
  globalViewNonce: number;
  /** v0.68.0 map tools. The view to open on (read once, at start-up); a region focus does not override it. */
  initialView?: MapView | null;
  /** Called when the map stops moving. */
  onViewChange?: (v: MapView) => void;
  /** Ruler mode: clicks add ruler points (snapped to a marker under the pointer) instead of selecting. */
  measuring?: boolean;
  ruler?: LonLat[];
  onRulerPoint?: (p: LonLat) => void;
  /** GPS interference (v0.69.0): 1° squares, last-good positions before GPS was lost, and the sampled circles. */
  gnssCells?: GnssCell[];
  gnssLost?: GnssLostPoint[];
  gnssCircles?: GnssCircle[];
  selectedGnss?: string | null;
  onSelectGnss?: (key: string | null) => void;
  /** Tanker and cargo traffic with 24 h tracks, and shipping lanes (v0.75.0); empty when off. */
  traffic?: TrafficShip[];
  selectedTraffic?: string | null;
  onSelectTraffic?: (mmsi: string | null) => void;
  lanes?: { c: LaneClass; g: [number, number][][] }[];
  /** Undersea cables and pipelines, and disputed areas (v0.71.0); empty when their layers are off. */
  undersea?: UnderseaLine[];
  selectedUndersea?: string | null;
  onSelectUndersea?: (id: string | null) => void;
  disputed?: DisputedDataset['features'];
  selectedDisputed?: string | null;
  onSelectDisputed?: (id: string | null) => void;
  /** Watch areas (v0.74.0), and the draw tool: while `drawing`, clicks go to onDrawClick; `draft` is previewed. */
  watchAreas?: WatchArea[];
  selectedWatchArea?: string | null;
  onSelectWatchArea?: (id: string | null) => void;
  drawing?: boolean;
  onDrawClick?: (p: LonLat) => void;
  /** Preview: the finished ring (circle or closed polygon) and/or the points clicked so far. */
  draft?: { ring: [number, number][] | null; points: [number, number][] } | null;
  /** A marked location (search result without its own marker, such as an airport). */
  pin?: { lat: number; lon: number } | null;
  handleRef?: { current: WorldMapHandle | null };
  /** Military installations layer (optional): DoD sites (US) and worldwide sites (Wikidata). */
  installations?: Installation[];
  worldInstallations?: WorldInstallation[];
  showInstallations?: boolean;
  /** Installation keys with unusual activity this week: ringed in amber. */
  unusualInstallations?: string[];
  /** Selection key: `dod:<name>` or `wd:<Wikidata id>`. */
  selectedInstallation?: string | null;
  onSelectInstallation?: (key: string | null) => void;
  /** Military aircraft positions (ADS-B), optional. */
  aircraft?: AircraftPosition[];
  showAircraft?: boolean;
  /** Selected aircraft (ICAO hex). */
  selectedAircraft?: string | null;
  onSelectAircraft?: (hex: string | null) => void;
  /** US Navy areas from the USNI fleet tracker (approximate), optional. */
  fleetAreas?: FleetArea[];
  showFleet?: boolean;
  /** Selected fleet area (name). */
  selectedFleetArea?: string | null;
  onSelectFleetArea?: (name: string | null) => void;
  /** Chokepoint transit status (IMF PortWatch), optional. */
  chokepoints?: ChokepointReading[];
  showChokepoints?: boolean;
  selectedChokepoint?: string | null;
  onSelectChokepoint?: (id: string | null) => void;
  /** Sanctioned vessels seen on AIS, optional. */
  sanctionedShips?: SanctionedShipSighting[];
  showSanctionedShips?: boolean;
  /** Selected vessel key (IMO, or mmsi:<n>). */
  selectedSanctionedShip?: string | null;
  onSelectSanctionedShip?: (key: string | null) => void;
  /** Satellite imagery under the overlays (NASA GIBS), or null for none. */
  imagery?: { tiles: string; maxzoom: number } | null;
  /** All critical-infrastructure sites (drawn when showInfrastructure) and the flagged ones (always drawn). */
  infraSites?: InfraSite[];
  showInfrastructure?: boolean;
  flaggedInfra?: FlaggedSite[];
  selectedInfra?: string | null;
  onSelectInfra?: (id: string | null) => void;
  /** US counties with customers without power (ODIN); empty when the layer is off. */
  powerOutages?: PowerOutageCounty[];
  /** FAA flight restrictions and airport events (empty when the FAA layer is off). */
  tfrs?: TfrShape[];
  airports?: AirportEvent[];
  /** Radiation stations above their usual level (empty when the layer is off). */
  radiation?: FlaggedStation[];
  /** Phase 25: navigational warnings, aircraft emergencies, UCDP conflict events (empty when off). */
  navWarnings?: NavWarning[];
  emergencies?: EmergencyAircraft[];
  conflicts?: ConflictEvent[];
}

const GLOBAL_VIEW = { center: [35, 22] as [number, number], zoom: 1.35 };
const FG = '#6aff9b';
const INFO = '#69c6d5';
const LOAD_TIMEOUT_MS = 20_000;
/** Branch colours: no red or amber (reserved for severity). Branch is also named in the hover and card. */
export const BRANCH_COLOR: Record<Branch, string> = { army: '#9ccc65', navy: '#69c6d5', 'air-force': '#b3a6ff', marines: '#e8a0c8', other: '#c8c8c8' };
/** Worldwide sites are drawn as rings (DoD sites are solid), coloured by who operates them. */
export const OPERATION_COLOR: Record<Operation, string> = { 'us-abroad': '#69c6d5', foreign: '#e8a0c8', national: '#9aa5a0' };
export const OPERATION_LABEL: Record<Operation, string> = { 'us-abroad': 'US-operated abroad', foreign: 'Foreign-operated', national: 'National / not recorded' };
/** Aircraft are plane icons pointing along their track, coloured by class (no red or amber: reserved for severity). */
export const AIRCRAFT_COLOR: Record<AircraftClass, string> = {
  tanker: '#69c6d5',
  isr: '#b3a6ff',
  bomber: '#e8a0c8',
  airlift: '#9ccc65',
  fighter: '#f2f2f2',
  helicopter: '#c8c8c8',
  other: '#8a958f',
};
/** Radiation stations above their usual level (severity colours). */
export const RADIATION_COLOR = { elevated: '#ffb347', high: '#ff5555' } as const;
/** Navigational warnings by kind, drawn as hollow rings and dashed areas (no red or amber). */
export const NAV_COLOR: Record<NavWarningKind, string> = {
  missile: '#ff9de2',
  firing: '#e8a0c8',
  exercise: '#69c6d5',
  gnss: '#f2f2f2',
  piracy: '#c8c8c8',
  mine: '#b3a6ff',
  cable: '#9ccc65',
  other: '#8a958f',
};
/** Aircraft squawking an emergency code: red (an emergency is a severity). */
export const EMERGENCY_COLOR = '#ff5555';
/** UCDP conflict events by type of violence. */
export const CONFLICT_COLOR: Record<ViolenceType, string> = { 1: '#d9654b', 2: '#c98a5a', 3: '#b07ad1' };
/** FAA flight restrictions by type (no red or amber: those are for severity). */
export const TFR_COLOR = { VIP: '#c8e66b', SECURITY: '#e8a0c8', SPECIAL: '#9fd3e8' } as const;
const TFR_FILL = ['match', ['get', 'type'], 'VIP', TFR_COLOR.VIP, 'SECURITY', TFR_COLOR.SECURITY, TFR_COLOR.SPECIAL] as unknown as string;
/** FAA airport events: severity colours (a ground stop is the most serious). */
export const AIRPORT_COLOR = { 'ground-stop': '#ff5555', 'ground-delay': '#ff8a3d', closure: '#9aa5a0', 'arrival-delay': '#ffd38a', 'departure-delay': '#ffd38a' } as const;
/** US power outages: amber to red by customers out (severity, which is what those colours are reserved for). */
export const POWER_STEPS: [number, string][] = [[50, '#ffd38a'], [1_000, '#ffb347'], [10_000, '#ff8a3d'], [100_000, '#ff5555']];
const POWER_FILL = ['step', ['get', 'out'], POWER_STEPS[0][1], POWER_STEPS[1][0], POWER_STEPS[1][1], POWER_STEPS[2][0], POWER_STEPS[2][1], POWER_STEPS[3][0], POWER_STEPS[3][1]] as unknown as string;
/** Infrastructure types: no red or amber (reserved for severity; flagged sites get a red ring). */
export const INFRA_COLOR: Record<InfraType, string> = { nuclear: '#d2a8ff', 'nuclear-site': '#ff8ad8', power: '#8fb3ff', refinery: '#e0c89a', dam: '#6fd3d0', port: '#b8c4bc', embassy: '#f4e27a' };

/** Sanctioned vessels: pink, distinct from severity colours and from the fleet layer. */
export const SANCTIONED_SHIP_COLOR = '#ff7ab6';
export const sightingKey = (s: Pick<SanctionedShipSighting, 'imo' | 'mmsi'>) => s.imo ?? `mmsi:${s.mmsi}`;

/** Chokepoint status colours: amber and red are severity here, which is what they are reserved for. */
export const CHOKEPOINT_COLOR = { normal: '#80a992', reduced: '#ffc857', severe: '#ff5555', 'sudden-drop': '#ff5555', 'insufficient-data': '#5f6b66' } as const;

/** Fleet areas: brighter where a carrier or big-deck amphib is listed. */
export const FLEET_COLOR = { bigDeck: '#69c6d5', other: '#80a992' } as const;
/** Ship silhouette in a 20x20 box (hull and island), for the map icon and legend. */
/** Heading arrow (points up = north before rotation). */
export const HEADING_PATH = 'M10 2.5 L15.5 16.5 L10 13 L4.5 16.5 Z';
export const SHIP_PATH = 'M1.5 11 L18.5 11 L16 15.5 L4 15.5 Z M10.5 4.5 L12.5 4.5 L12.5 7 L14 7 L14 10.5 L9 10.5 L9 7 L10.5 7 Z';

/** Plane outline in a 20x20 box, pointing north (map icon and legend). */
export const AIRCRAFT_PATH = 'M10 1.5 L11.4 7.5 L18.5 11.5 L18.5 13 L11.4 11 L11 16 L13.5 17.8 L13.5 18.8 L10 18 L6.5 18.8 L6.5 17.8 L9 16 L8.6 11 L1.5 13 L1.5 11.5 L8.6 7.5 Z';

/** A plane-shaped SDF icon, tinted per class with icon-color. */
function registerAircraftIcon(map: MLMap) {
  if (map.hasImage('aircraft')) return;
  const px = 2;
  const size = 20 * px;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(px, px);
  ctx.fillStyle = '#ffffff';
  ctx.fill(new Path2D(AIRCRAFT_PATH));
  map.addImage('aircraft', ctx.getImageData(0, 0, size, size), { pixelRatio: px, sdf: true });
  if (map.hasImage('ship')) return;
  ctx.clearRect(0, 0, 20, 20);
  ctx.fill(new Path2D(SHIP_PATH));
  map.addImage('ship', ctx.getImageData(0, 0, size, size), { pixelRatio: px, sdf: true });
  if (map.hasImage('infra-square')) return;
  // Infrastructure is drawn as squares so it never reads as a base (bases are dots and rings).
  ctx.clearRect(0, 0, 20, 20);
  ctx.fillRect(3, 3, 14, 14);
  map.addImage('infra-square', ctx.getImageData(0, 0, size, size), { pixelRatio: px, sdf: true });
  if (map.hasImage('heading')) return;
  // v0.75.0: tanker and cargo ships, an arrow rotated to the course over ground.
  ctx.clearRect(0, 0, 20, 20);
  ctx.fill(new Path2D(HEADING_PATH));
  map.addImage('heading', ctx.getImageData(0, 0, size, size), { pixelRatio: px, sdf: true });
}

/** Rasterize each category's SVG path into a map icon so map and legend match. */
function registerCategoryIcons(map: MLMap) {
  const px = 2; // pixel ratio
  const size = 24 * px;
  for (const cat of EVENT_CATEGORIES) {
    const id = `cat-${cat}`;
    if (map.hasImage(id)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const path = new Path2D(CATEGORY_STYLES[cat].path);
    ctx.scale(px * 0.82, px * 0.82);
    ctx.translate(2.6, 2.6);
    ctx.fillStyle = 'rgba(5,10,8,0.85)';
    ctx.fill(path);
    ctx.fillStyle = 'rgba(106,255,155,0.22)';
    ctx.fill(path);
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = FG;
    ctx.stroke(path);
    map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: px });
  }
}

export function WorldMap(props: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [mapErrors, setMapErrors] = useState(0);
  // Keep latest callbacks without rebinding map listeners.
  const cb = useRef(props);
  cb.current = props;
  // A link or remembered view wins over the first region focus.
  const skipFocus = useRef(false);

  // ---------------------------------------------------------------- init --
  useEffect(() => {
    const abort = new AbortController();
    let map: MLMap | null = null;
    let loaded = false;
    let resizeObserver: ResizeObserver | null = null;
    // Never sit on "initializing" forever: surface a stalled renderer.
    const watchdog = window.setTimeout(() => {
      if (!loaded && !abort.signal.aborted) setFailure('MAP RENDERER DID NOT INITIALIZE WITHIN 20 S');
    }, LOAD_TIMEOUT_MS);

    (async () => {
      let style: StyleSpecification;
      try {
        const res = await fetch(BASEMAP_STYLE_URL, { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        style = militarizeStyle((await res.json()) as StyleSpecification);
      } catch (err) {
        if (abort.signal.aborted) return;
        setFailure(`BASEMAP STYLE UNAVAILABLE (${err instanceof Error ? err.message : 'error'})`);
        return;
      }
      if (abort.signal.aborted || !containerRef.current) return;
      const font = findTextFont(style);

      const start = cb.current.initialView;
      skipFocus.current = !!start;
      const m = new MLMap({
        container: containerRef.current,
        style,
        ...(start ? { center: [start.lon, start.lat] as [number, number], zoom: start.zoom } : GLOBAL_VIEW),
        minZoom: 0.8,
        maxZoom: 12,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      map = m;
      mapRef.current = m;
      m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      // Track panel size changes (layout, window resize) — the canvas does not do this itself.
      resizeObserver = new ResizeObserver(() => m.resize());
      resizeObserver.observe(containerRef.current);
      m.touchZoomRotate.disableRotation();

      m.on('error', (e) => {
        // Tile/worker errors: count and surface them, keep the map usable if possible.
        console.warn('[WorldMap]', e.error?.message);
        setMapErrors((n) => n + 1);
      });

      m.on('load', () => {
        loaded = true;
        window.clearTimeout(watchdog);
        registerCategoryIcons(m);
        registerAircraftIcon(m);

        m.addSource('graticule', { type: 'geojson', data: graticule(30) });
        m.addLayer({
          id: 'graticule',
          type: 'line',
          source: 'graticule',
          paint: { 'line-color': '#123323', 'line-width': 0.6, 'line-dasharray': [2, 3] },
        });

        // Disputed areas and undersea lines (v0.71.0), under everything else.
        const none = { type: 'FeatureCollection' as const, features: [] };
        m.addSource('disputed', { type: 'geojson', data: none });
        m.addLayer({ id: 'disputed-fill', type: 'fill', source: 'disputed', paint: { 'fill-color': DISPUTED_COLOR, 'fill-opacity': 0.1 } });
        m.addLayer({ id: 'disputed-line', type: 'line', source: 'disputed', paint: { 'line-color': DISPUTED_COLOR, 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
        m.addLayer({ id: 'disputed-selected', type: 'line', source: 'disputed', filter: ['==', ['get', 'id'], '__none__'], paint: { 'line-color': '#ffffff', 'line-width': 2 } });
        m.addSource('lanes', { type: 'geojson', data: none });
        m.addLayer({
          id: 'lanes',
          type: 'line',
          source: 'lanes',
          paint: {
            'line-color': LANE_COLOR,
            'line-width': ['match', ['get', 'c'], 'major', 1.6, 'middle', 1.1, 0.7],
            'line-opacity': ['match', ['get', 'c'], 'major', 0.7, 'middle', 0.55, 0.4],
            'line-dasharray': [4, 3],
          },
        });
        m.addSource('undersea', { type: 'geojson', data: none });
        m.addLayer({
          id: 'undersea',
          type: 'line',
          source: 'undersea',
          paint: {
            'line-color': ['match', ['get', 'k'], 'telecom', UNDERSEA_COLOR.telecom, 'power', UNDERSEA_COLOR.power, UNDERSEA_COLOR.pipeline],
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 7, 1.8],
            'line-opacity': 0.85,
          },
        });
        m.addLayer({ id: 'undersea-selected', type: 'line', source: 'undersea', filter: ['==', ['get', 'id'], '__none__'], paint: { 'line-color': '#ffffff', 'line-width': 3 } });
        for (const layer of ['undersea', 'disputed-fill']) {
          m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
          m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = cb.current.measuring ? 'crosshair' : ''));
        }

        // GPS interference (v0.69.0): sampled circles, 1° squares coloured by degraded share, lost-GPS points.
        m.addSource('gnss-circles', { type: 'geojson', data: none });
        m.addLayer({ id: 'gnss-circles', type: 'line', source: 'gnss-circles', paint: { 'line-color': '#3d5a4a', 'line-width': 0.8, 'line-dasharray': [1, 3] } });
        m.addSource('gnss', { type: 'geojson', data: none });
        m.addLayer({
          id: 'gnss-fill',
          type: 'fill',
          source: 'gnss',
          paint: {
            'fill-color': ['match', ['get', 'level'], 'high', GNSS_COLOR.high, 'medium', GNSS_COLOR.medium, GNSS_COLOR.low],
            'fill-opacity': ['match', ['get', 'level'], 'high', 0.38, 'medium', 0.24, 0.04],
          },
        });
        m.addLayer({
          id: 'gnss-outline',
          type: 'line',
          source: 'gnss',
          paint: { 'line-color': ['match', ['get', 'level'], 'high', GNSS_COLOR.high, 'medium', GNSS_COLOR.medium, GNSS_COLOR.low], 'line-width': 0.6, 'line-opacity': 0.8 },
        });
        m.addLayer({ id: 'gnss-selected', type: 'line', source: 'gnss', filter: ['==', ['get', 'k'], '__none__'], paint: { 'line-color': '#ffffff', 'line-width': 2 } });
        m.addSource('gnss-lost', { type: 'geojson', data: none });
        m.addLayer({
          id: 'gnss-lost',
          type: 'circle',
          source: 'gnss-lost',
          paint: { 'circle-radius': 3, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': GNSS_COLOR.high, 'circle-stroke-width': 1.2 },
        });

        const empty = regionAreas({}, null);
        m.addSource('regions', { type: 'geojson', data: empty.polygons });
        m.addSource('region-labels', { type: 'geojson', data: empty.labels });
        m.addLayer({
          id: 'region-fill',
          type: 'fill',
          source: 'regions',
          paint: {
            'fill-color': ['case', ['get', 'selected'], INFO, FG],
            'fill-opacity': ['case', ['get', 'selected'], 0.08, ['>', ['get', 'count'], 0], 0.045, 0.015],
          },
        });
        m.addLayer({
          id: 'region-outline',
          type: 'line',
          source: 'regions',
          paint: {
            'line-color': ['case', ['get', 'selected'], INFO, '#2f6a4c'],
            'line-width': ['case', ['get', 'selected'], 1.4, 0.9],
            'line-dasharray': [3, 2],
          },
        });
        m.addLayer({
          id: 'region-labels',
          type: 'symbol',
          source: 'region-labels',
          layout: {
            'text-field': ['get', 'label'],
            'text-font': font,
            'text-size': 10,
            'text-anchor': 'bottom-left',
            'text-offset': [0.2, -0.2],
            'text-letter-spacing': 0.12,
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': ['case', ['get', 'selected'], INFO, '#80a992'],
            'text-halo-color': '#050a08',
            'text-halo-width': 1.2,
          },
        });

        m.addSource('events', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 36,
          clusterMaxZoom: 7,
          promoteId: 'id',
        });
        m.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': 'rgba(106,255,155,0.12)',
            'circle-stroke-color': FG,
            'circle-stroke-width': 1.2,
            'circle-radius': ['step', ['get', 'point_count'], 11, 5, 14, 15, 18],
          },
        });
        m.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'events',
          filter: ['has', 'point_count'],
          layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': font, 'text-size': 11 },
          paint: { 'text-color': FG },
        });
        // Military installations: under the event markers, coloured by branch, labelled when zoomed in.
        // US power outages (ODIN): county outlines shaded by customers out, under every marker.
        m.addSource('power-outages', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'power-outages',
          type: 'fill',
          source: 'power-outages',
          paint: { 'fill-color': POWER_FILL, 'fill-opacity': 0.42 },
        });
        m.addLayer({
          id: 'power-outages-line',
          type: 'line',
          source: 'power-outages',
          paint: { 'line-color': POWER_FILL, 'line-width': 1, 'line-opacity': 0.9 },
        });
        m.addLayer({
          id: 'power-outages-labels',
          type: 'symbol',
          source: 'power-outages',
          minzoom: 4.5,
          // Drawn even where base-map place names are (they would otherwise always win the collision).
          layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 10, 'text-allow-overlap': true },
          paint: { 'text-color': '#ffd9a8', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });
        // FAA flight restrictions: outlines by type, solid while active, faint before they start.
        m.addSource('tfrs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'tfrs', type: 'fill', source: 'tfrs', paint: { 'fill-color': TFR_FILL, 'fill-opacity': ['case', ['get', 'active'], 0.28, 0.06] } });
        m.addLayer({ id: 'tfrs-line', type: 'line', source: 'tfrs', paint: { 'line-color': TFR_FILL, 'line-width': 1.2, 'line-dasharray': [2, 1.5] } });
        m.addLayer({
          id: 'tfrs-labels',
          type: 'symbol',
          source: 'tfrs',
          minzoom: 6,
          layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 10, 'text-allow-overlap': true },
          paint: { 'text-color': TFR_FILL, 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });
        m.addSource('installations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'installations',
          type: 'circle',
          source: 'installations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 4, 3, 8, 5.5],
            'circle-color': ['match', ['get', 'branch'], 'army', BRANCH_COLOR.army, 'navy', BRANCH_COLOR.navy, 'air-force', BRANCH_COLOR['air-force'], 'marines', BRANCH_COLOR.marines, BRANCH_COLOR.other],
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['get', 'active'], 0.55, 0.2], 4, ['case', ['get', 'active'], 0.85, 0.35]],
            'circle-stroke-color': '#050a08',
            'circle-stroke-width': 0.6,
          },
        });
        m.addSource('installations-world', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'installations-world',
          type: 'circle',
          source: 'installations-world',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.8, 4, 3.2, 8, 5.5],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': ['match', ['get', 'op'], 'us-abroad', OPERATION_COLOR['us-abroad'], 'foreign', OPERATION_COLOR.foreign, OPERATION_COLOR.national],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 0.9, 6, 1.6],
            // Faint when zoomed out (thousands of sites), clear from regional zoom.
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.45, 4, 0.9],
          },
        });
        for (const [id, source] of [['installation-unusual', 'installations'], ['installation-world-unusual', 'installations-world']] as const) {
          m.addLayer({
            id,
            type: 'circle',
            source,
            filter: ['in', ['get', 'key'], ['literal', []]],
            paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 6, 11], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e8b04a', 'circle-stroke-width': 1.8 },
          });
        }
        m.addLayer({
          id: 'installation-selected',
          type: 'circle',
          source: 'installations',
          filter: ['==', ['get', 'key'], '__none__'],
          paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': INFO, 'circle-stroke-width': 1.6 },
        });
        m.addLayer({
          id: 'installation-world-selected',
          type: 'circle',
          source: 'installations-world',
          filter: ['==', ['get', 'key'], '__none__'],
          paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': INFO, 'circle-stroke-width': 1.6 },
        });
        m.addLayer({
          id: 'installation-world-labels',
          type: 'symbol',
          source: 'installations-world',
          minzoom: 6,
          layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 10, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#80a992', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });
        m.addLayer({
          id: 'installation-labels',
          type: 'symbol',
          source: 'installations',
          minzoom: 6,
          layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 10, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#80a992', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });

        // US Navy fleet areas (USNI tracker): a wide faint halo says "somewhere in this area".
        m.addSource('fleet', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'fleet-halo',
          type: 'circle',
          source: 'fleet',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 14, 4, 34, 7, 70],
            'circle-color': ['case', ['get', 'big'], FLEET_COLOR.bigDeck, FLEET_COLOR.other],
            'circle-opacity': 0.08,
            'circle-stroke-color': ['case', ['get', 'big'], FLEET_COLOR.bigDeck, FLEET_COLOR.other],
            'circle-stroke-width': 1,
            'circle-stroke-opacity': ['case', ['==', ['get', 'name'], '__none__'], 0.9, 0.35],
          },
        });
        m.addLayer({
          id: 'fleet',
          type: 'symbol',
          source: 'fleet',
          layout: {
            'icon-image': 'ship',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.75, 6, 1],
            'icon-allow-overlap': true,
            'text-field': ['get', 'label'],
            'text-font': font,
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'icon-color': ['case', ['get', 'big'], FLEET_COLOR.bigDeck, FLEET_COLOR.other],
            'icon-halo-color': '#050a08',
            'icon-halo-width': 1,
            'text-color': '#a8d8b8',
            'text-halo-color': '#050a08',
            'text-halo-width': 1.2,
          },
        });

        // Chokepoints (IMF PortWatch): a diamond coloured by traffic status, labelled with the change.
        m.addSource('chokepoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'chokepoints',
          type: 'symbol',
          source: 'chokepoints',
          layout: {
            'text-field': ['concat', '◆ ', ['get', 'label']],
            'text-font': font,
            'text-size': 10,
            'text-anchor': 'left',
            'text-offset': [-0.45, 0],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': ['match', ['get', 'status'], 'reduced', CHOKEPOINT_COLOR.reduced, 'severe', CHOKEPOINT_COLOR.severe, 'sudden-drop', CHOKEPOINT_COLOR['sudden-drop'], 'insufficient-data', CHOKEPOINT_COLOR['insufficient-data'], CHOKEPOINT_COLOR.normal],
            'text-halo-color': '#050a08',
            'text-halo-width': 1.4,
          },
        });

        // Critical infrastructure: squares coloured by type (bases are dots); flagged sites larger, outlined red, named.
        m.addSource('infrastructure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'infrastructure',
          type: 'symbol',
          source: 'infrastructure',
          layout: {
            visibility: 'none',
            'icon-image': 'infra-square',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.28, 5, 0.48, 9, 0.8],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-color': ['match', ['get', 'type'], 'nuclear', INFRA_COLOR.nuclear, 'nuclear-site', INFRA_COLOR['nuclear-site'], 'power', INFRA_COLOR.power, 'refinery', INFRA_COLOR.refinery, 'dam', INFRA_COLOR.dam, 'embassy', INFRA_COLOR.embassy, INFRA_COLOR.port],
            'icon-opacity': 0.9,
            'icon-halo-color': '#050a08',
            'icon-halo-width': 0.8,
          },
        });
        m.addSource('infrastructure-flagged', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'infrastructure-flagged',
          type: 'symbol',
          source: 'infrastructure-flagged',
          layout: {
            'icon-image': 'infra-square',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.75, 6, 1.15],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: {
            'icon-color': ['match', ['get', 'type'], 'nuclear', INFRA_COLOR.nuclear, 'nuclear-site', INFRA_COLOR['nuclear-site'], 'power', INFRA_COLOR.power, 'refinery', INFRA_COLOR.refinery, 'dam', INFRA_COLOR.dam, 'embassy', INFRA_COLOR.embassy, INFRA_COLOR.port],
            'icon-halo-color': '#ff5555',
            'icon-halo-width': ['case', ['get', 'selected'], 3, 2],
          },
        });
        m.addLayer({
          id: 'infrastructure-flagged-labels',
          type: 'symbol',
          source: 'infrastructure-flagged',
          minzoom: 3,
          layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 10, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#ffb0b0', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });

        // FAA airport events: ground stops red, ground delay programs orange, delays yellow, closures grey.
        m.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'airports',
          type: 'circle',
          source: 'airports',
          paint: {
            'circle-radius': ['match', ['get', 'kind'], 'ground-stop', 5.5, 'ground-delay', 5, 4],
            'circle-color': ['match', ['get', 'kind'], 'ground-stop', AIRPORT_COLOR['ground-stop'], 'ground-delay', AIRPORT_COLOR['ground-delay'], 'closure', AIRPORT_COLOR.closure, AIRPORT_COLOR['departure-delay']],
            'circle-stroke-color': ['case', ['get', 'notable'], '#ffffff', '#050a08'],
            'circle-stroke-width': ['case', ['get', 'notable'], 1.6, 0.8],
          },
        });
        m.addLayer({
          id: 'airports-labels',
          type: 'symbol',
          source: 'airports',
          minzoom: 3.5,
          layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 10, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#e6efe9', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });
        // Radiation stations above their usual level: amber elevated, red high.
        m.addSource('radiation', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'radiation',
          type: 'circle',
          source: 'radiation',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'status'], 'high'], 7, 5],
            'circle-color': ['case', ['==', ['get', 'status'], 'high'], RADIATION_COLOR.high, RADIATION_COLOR.elevated],
            'circle-opacity': 0.85,
            'circle-stroke-color': '#050a08',
            'circle-stroke-width': 1,
          },
        });
        m.addLayer({
          id: 'radiation-labels',
          type: 'symbol',
          source: 'radiation',
          minzoom: 4,
          layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 10, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#ffe3a8', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });
        // Phase 25: UCDP conflict events (sized by deaths), navigational warning areas, aircraft emergencies.
        m.addSource('conflicts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'conflicts',
          type: 'circle',
          source: 'conflicts',
          paint: {
            'circle-radius': ['min', 14, ['+', 2.5, ['*', 1.1, ['sqrt', ['get', 'k']]]]],
            'circle-color': ['match', ['get', 'ty'], 1, CONFLICT_COLOR[1], 2, CONFLICT_COLOR[2], CONFLICT_COLOR[3]],
            'circle-opacity': 0.55,
            'circle-stroke-color': '#050a08',
            'circle-stroke-width': 0.6,
          },
        });
        m.addSource('nav-warning-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'nav-warning-areas',
          type: 'line',
          source: 'nav-warning-areas',
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
        });
        m.addSource('nav-warnings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'nav-warnings',
          type: 'circle',
          source: 'nav-warnings',
          paint: { 'circle-radius': 5, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 },
        });
        m.addSource('emergencies', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'emergencies',
          type: 'circle',
          source: 'emergencies',
          paint: { 'circle-radius': 6, 'circle-color': EMERGENCY_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
        });
        m.addLayer({
          id: 'emergencies-labels',
          type: 'symbol',
          source: 'emergencies',
          layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 10, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
          paint: { 'text-color': '#ffb3b3', 'text-halo-color': '#050a08', 'text-halo-width': 1.2 },
        });
        // Sanctioned vessels (AIS): ship icons along their course.
        // Tanker and cargo traffic (v0.75.0), under the sanctioned ships.
        m.addSource('traffic-tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'traffic-tracks',
          type: 'line',
          source: 'traffic-tracks',
          paint: { 'line-color': ['match', ['get', 'kind'], 'tanker', TRAFFIC_COLOR.tanker, TRAFFIC_COLOR.cargo], 'line-width': 1, 'line-opacity': 0.28 },
        });
        m.addLayer({
          id: 'traffic-track-selected',
          type: 'line',
          source: 'traffic-tracks',
          filter: ['==', ['get', 'mmsi'], '__none__'],
          paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.9 },
        });
        m.addSource('traffic', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'traffic',
          type: 'symbol',
          source: 'traffic',
          layout: {
            'icon-image': 'heading',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.45, 7, 0.8],
            'icon-rotate': ['get', 'cog'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'text-field': ['step', ['zoom'], '', 7, ['get', 'name']],
            'text-font': font,
            'text-size': 9,
            'text-offset': [0, 1.1],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'icon-color': ['match', ['get', 'kind'], 'tanker', TRAFFIC_COLOR.tanker, TRAFFIC_COLOR.cargo],
            'icon-opacity': ['case', ['get', 'stopped'], 0.5, 0.95],
            'icon-halo-color': '#050a08',
            'icon-halo-width': 1,
            'text-color': '#cfe3ea',
            'text-halo-color': '#050a08',
            'text-halo-width': 1.2,
          },
        });
        m.addLayer({
          id: 'traffic-selected',
          type: 'circle',
          source: 'traffic',
          filter: ['==', ['get', 'mmsi'], '__none__'],
          paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
        });

        m.addSource('sanctioned-ships', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'sanctioned-ship-selected',
          type: 'circle',
          source: 'sanctioned-ships',
          filter: ['==', ['get', 'key'], '__none__'],
          paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': INFO, 'circle-stroke-width': 1.6 },
        });
        m.addLayer({
          id: 'sanctioned-ships',
          type: 'symbol',
          source: 'sanctioned-ships',
          layout: {
            'icon-image': 'ship',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 6, 1],
            'icon-allow-overlap': true,
            'text-field': ['step', ['zoom'], '', 4, ['get', 'name']],
            'text-font': font,
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'icon-color': SANCTIONED_SHIP_COLOR,
            'icon-opacity': ['case', ['get', 'recent'], 1, 0.55],
            'icon-halo-color': '#050a08',
            'icon-halo-width': 1,
            'text-color': '#f3c1da',
            'text-halo-color': '#050a08',
            'text-halo-width': 1.2,
          },
        });

        // Military aircraft (ADS-B): above installations, below event markers.
        m.addSource('aircraft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'aircraft-selected',
          type: 'circle',
          source: 'aircraft',
          filter: ['==', ['get', 'hex'], '__none__'],
          paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': INFO, 'circle-stroke-width': 1.6 },
        });
        m.addLayer({
          id: 'aircraft',
          type: 'symbol',
          source: 'aircraft',
          layout: {
            'icon-image': 'aircraft',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 5, 0.85, 9, 1],
            'icon-rotate': ['get', 'trk'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['step', ['zoom'], '', 4, ['get', 'label']],
            'text-font': font,
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: {
            'icon-color': ['match', ['get', 'cls'], 'tanker', AIRCRAFT_COLOR.tanker, 'isr', AIRCRAFT_COLOR.isr, 'bomber', AIRCRAFT_COLOR.bomber, 'airlift', AIRCRAFT_COLOR.airlift, 'fighter', AIRCRAFT_COLOR.fighter, 'helicopter', AIRCRAFT_COLOR.helicopter, AIRCRAFT_COLOR.other],
            'icon-halo-color': '#050a08',
            'icon-halo-width': 1,
            'text-color': '#a8d8b8',
            'text-halo-color': '#050a08',
            'text-halo-width': 1.2,
          },
        });

        m.addLayer({
          id: 'event-selected',
          type: 'circle',
          source: 'events',
          filter: ['==', ['get', 'id'], '__none__'],
          paint: {
            'circle-radius': 13,
            'circle-color': 'rgba(105,198,213,0.12)',
            'circle-stroke-color': INFO,
            'circle-stroke-width': 1.5,
          },
        });
        m.addLayer({
          id: 'events',
          type: 'symbol',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': ['concat', 'cat-', ['get', 'category']],
            'icon-size': 0.62,
            'icon-allow-overlap': true,
          },
        });

        const hover = new Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '280px' });

        m.on('mousemove', 'events', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = 'pointer';
          const p = f.properties as { title: string; category: string };
          const el = document.createElement('div');
          const cat = document.createElement('div');
          cat.className = 'text-[10px] tracking-widest text-wt-fg-dim';
          cat.textContent = CATEGORY_STYLES[p.category as keyof typeof CATEGORY_STYLES]?.label.toUpperCase() ?? '';
          const title = document.createElement('div');
          title.className = 'text-xs';
          title.textContent = p.title; // textContent: source content is untrusted, never innerHTML
          el.append(cat, title);
          hover.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(el).addTo(m);
        });
        m.on('mouseleave', 'events', () => {
          m.getCanvas().style.cursor = '';
          hover.remove();
        });
        const showBaseHover = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f || m.queryRenderedFeatures(e.point, { layers: ['events'] }).length) return;
          m.getCanvas().style.cursor = 'pointer';
          const p = f.properties as { name: string; label: string };
          const el = document.createElement('div');
          const kind = document.createElement('div');
          kind.className = 'text-[10px] tracking-widest text-wt-fg-dim';
          kind.textContent = `INSTALLATION · ${p.label.toUpperCase()}`;
          const title = document.createElement('div');
          title.className = 'text-xs';
          title.textContent = p.name;
          el.append(kind, title);
          hover.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(el).addTo(m);
        };
        for (const layer of ['installations', 'installations-world']) {
          m.on('mousemove', layer, showBaseHover);
          m.on('mouseleave', layer, () => {
            m.getCanvas().style.cursor = '';
            hover.remove();
          });
        }
        m.on('mousemove', 'aircraft', (e) => {
          const f = e.features?.[0];
          if (!f || m.queryRenderedFeatures(e.point, { layers: ['events'] }).length) return;
          m.getCanvas().style.cursor = 'pointer';
          const p = f.properties as { label: string; cls: AircraftClass; type: string };
          const el = document.createElement('div');
          const kind = document.createElement('div');
          kind.className = 'text-[10px] tracking-widest text-wt-fg-dim';
          kind.textContent = `MILITARY AIRCRAFT · ${AIRCRAFT_CLASS_LABEL[p.cls]?.toUpperCase() ?? ''}`;
          const title = document.createElement('div');
          title.className = 'text-xs';
          title.textContent = `${p.label}${p.type ? ` · ${p.type}` : ''}`;
          el.append(kind, title);
          hover.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(el).addTo(m);
        });
        m.on('mouseleave', 'aircraft', () => {
          m.getCanvas().style.cursor = '';
          hover.remove();
        });
        // Phase 25 hovers: plain text only (warning text and names come from the sources).
        const showHover = (e: MapLayerMouseEvent, kindText: (p: Record<string, unknown>) => string, titleText: (p: Record<string, unknown>) => string) => {
          const f = e.features?.[0];
          if (!f || m.queryRenderedFeatures(e.point, { layers: ['events'] }).length) return;
          const p = f.properties as Record<string, unknown>;
          const el = document.createElement('div');
          const kind = document.createElement('div');
          kind.className = 'text-[10px] tracking-widest text-wt-fg-dim';
          kind.textContent = kindText(p);
          const title = document.createElement('div');
          title.className = 'text-xs';
          title.textContent = titleText(p);
          el.append(kind, title);
          hover.setLngLat(e.lngLat).setDOMContent(el).addTo(m);
        };
        m.on('mousemove', 'nav-warnings', (e) => showHover(e, (p) => `NAV WARNING · ${String(p.kindLabel).toUpperCase()}`, (p) => `${p.key}: ${p.text}`));
        m.on('mousemove', 'emergencies', (e) => showHover(e, (p) => `AIRCRAFT EMERGENCY · ${String(p.code).toUpperCase()}`, (p) => `${p.label}${p.type ? ` · ${p.type}` : ''}${p.mil ? ' · military' : ''}${p.sq === '7500' ? ' — 7500 is often a mis-set transponder' : ''}${p.when ? ` — ${p.when}` : ''}`));
        m.on('mousemove', 'conflicts', (e) => showHover(e, (p) => `UCDP CONFLICT EVENT · ${String(p.typeLabel).toUpperCase()}`, (p) => `${p.d} · ${p.country}: ${p.a} vs ${p.b} — ${p.k} deaths (best estimate)`));
        for (const id of ['nav-warnings', 'emergencies', 'conflicts']) {
          m.on('mouseleave', id, () => hover.remove());
        }
        m.on('mouseenter', 'sanctioned-ships', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'sanctioned-ships', () => (m.getCanvas().style.cursor = ''));
        for (const id of ['infrastructure', 'infrastructure-flagged']) {
          m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
          m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
        }
        m.on('mouseenter', 'chokepoints', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'chokepoints', () => (m.getCanvas().style.cursor = ''));
        m.on('mouseenter', 'fleet', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'fleet', () => (m.getCanvas().style.cursor = ''));
        for (const layer of ['clusters', 'region-fill']) {
          m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
          m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
        }

        // Watch areas (v0.74.0) and the draw preview.
        m.addSource('watch-areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'watch-area-fill', type: 'fill', source: 'watch-areas', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': WATCH_AREA_COLOR, 'fill-opacity': 0.06 } });
        m.addLayer({ id: 'watch-area-line', type: 'line', source: 'watch-areas', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': WATCH_AREA_COLOR, 'line-width': 1.4, 'line-dasharray': [3, 2] } });
        m.addLayer({
          id: 'watch-area-selected',
          type: 'line',
          source: 'watch-areas',
          filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'id'], '__none__']],
          paint: { 'line-color': '#ffffff', 'line-width': 2.2 },
        });
        m.addLayer({
          id: 'watch-area-labels',
          type: 'symbol',
          source: 'watch-areas',
          filter: ['==', ['geometry-type'], 'Point'],
          layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 10, 'text-allow-overlap': false },
          paint: { 'text-color': WATCH_AREA_COLOR, 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
        });
        m.addSource('area-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'area-draft-line', type: 'line', source: 'area-draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': WATCH_AREA_COLOR, 'line-width': 2 } });
        m.addLayer({
          id: 'area-draft-points',
          type: 'circle',
          source: 'area-draft',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 4, 'circle-color': '#000000', 'circle-stroke-color': WATCH_AREA_COLOR, 'circle-stroke-width': 2 },
        });

        // Ruler (v0.68.0) and search pin, drawn above everything else.
        m.addSource('ruler', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'ruler-line', type: 'line', source: 'ruler', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': RULER_COLOR, 'line-width': 2, 'line-dasharray': [2, 1] } });
        m.addLayer({
          id: 'ruler-points',
          type: 'circle',
          source: 'ruler',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 4, 'circle-color': '#000000', 'circle-stroke-color': RULER_COLOR, 'circle-stroke-width': 2 },
        });
        m.addSource('pin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': RULER_COLOR, 'circle-stroke-width': 2 } });
        m.on('moveend', () => {
          const c = m.getCenter();
          cb.current.onViewChange?.({ lat: c.lat, lon: c.lng, zoom: m.getZoom() });
        });

        m.on('click', async (e) => {
          if (cb.current.drawing) {
            cb.current.onDrawClick?.([e.lngLat.lng, e.lngLat.lat]);
            return;
          }
          if (cb.current.measuring) {
            // Snap to a marker under the pointer, so "from this base to that aircraft" is exact.
            const snapLayers = ['aircraft', 'sanctioned-ships', 'infrastructure-flagged', 'infrastructure', 'chokepoints', 'fleet', 'installations', 'installations-world', 'events', 'pin'].filter(
              (id) => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none',
            );
            const hit = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: snapLayers }).find((f) => f.geometry.type === 'Point');
            const at = hit ? ((hit.geometry as GeoJSON.Point).coordinates as LonLat) : ([e.lngLat.lng, e.lngLat.lat] as LonLat);
            cb.current.onRulerPoint?.(at);
            return;
          }
          const pts = m.queryRenderedFeatures(e.point, { layers: ['events'] });
          if (pts[0]) {
            cb.current.onSelectEvent(String(pts[0].properties.id));
            return;
          }
          const planes = m.getLayoutProperty('aircraft', 'visibility') !== 'none'
            ? m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['aircraft'] })
            : [];
          if (planes[0] && cb.current.onSelectAircraft) {
            cb.current.onSelectAircraft(String(planes[0].properties.hex));
            return;
          }
          const trafficHit = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['traffic'] });
          const listedFirst = m.queryRenderedFeatures([[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]], { layers: ['sanctioned-ships'] });
          if (trafficHit[0] && !listedFirst[0] && cb.current.onSelectTraffic) {
            cb.current.onSelectTraffic(String(trafficHit[0].properties.mmsi));
            return;
          }
          const listed = m.getLayoutProperty('sanctioned-ships', 'visibility') !== 'none'
            ? m.queryRenderedFeatures([[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]], { layers: ['sanctioned-ships'] })
            : [];
          if (listed[0] && cb.current.onSelectSanctionedShip) {
            cb.current.onSelectSanctionedShip(String(listed[0].properties.key));
            return;
          }
          const infra = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], {
            layers: m.getLayoutProperty('infrastructure', 'visibility') !== 'none' ? ['infrastructure-flagged', 'infrastructure'] : ['infrastructure-flagged'],
          });
          if (infra[0] && cb.current.onSelectInfra) {
            cb.current.onSelectInfra(String(infra[0].properties.id));
            return;
          }
          const straits = m.getLayoutProperty('chokepoints', 'visibility') !== 'none'
            ? m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['chokepoints'] })
            : [];
          if (straits[0] && cb.current.onSelectChokepoint) {
            cb.current.onSelectChokepoint(String(straits[0].properties.id));
            return;
          }
          const ships = m.getLayoutProperty('fleet', 'visibility') !== 'none'
            ? m.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['fleet'] })
            : [];
          if (ships[0] && cb.current.onSelectFleetArea) {
            cb.current.onSelectFleetArea(String(ships[0].properties.name));
            return;
          }
          const bases = m.getLayer('installations') && m.getLayoutProperty('installations', 'visibility') !== 'none'
            ? m.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ['installations', 'installations-world'] })
            : [];
          if (bases[0] && cb.current.onSelectInstallation) {
            cb.current.onSelectInstallation(String(bases[0].properties.key));
            return;
          }
          const clusters = m.queryRenderedFeatures(e.point, { layers: ['clusters'] });
          const gnssHit = clusters[0] ? [] : m.queryRenderedFeatures(e.point, { layers: ['gnss-fill'] });
          if (gnssHit[0] && cb.current.onSelectGnss) {
            cb.current.onSelectGnss(String(gnssHit[0].properties.k));
            return;
          }
          const lineHit = clusters[0] ? [] : m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ['undersea'] });
          if (lineHit[0] && cb.current.onSelectUndersea) {
            cb.current.onSelectUndersea(String(lineHit[0].properties.id));
            return;
          }
          if (clusters[0]) {
            const src = m.getSource('events') as GeoJSONSource;
            const zoom = await src.getClusterExpansionZoom(clusters[0].properties.cluster_id as number);
            m.easeTo({ center: (clusters[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
            return;
          }
          const areaHit = m.queryRenderedFeatures(e.point, { layers: ['watch-area-fill'] });
          if (areaHit[0] && cb.current.onSelectWatchArea) {
            cb.current.onSelectWatchArea(String(areaHit[0].properties.id));
            return;
          }
          const disputedHit = m.queryRenderedFeatures(e.point, { layers: ['disputed-fill'] });
          if (disputedHit[0] && cb.current.onSelectDisputed) {
            cb.current.onSelectDisputed(String(disputedHit[0].properties.id));
            return;
          }
          const areas = m.queryRenderedFeatures(e.point, { layers: ['region-fill'] });
          if (areas[0]) cb.current.onSelectRegion(String(areas[0].properties.id));
        });

        setReady(true);
      });
    })();

    return () => {
      abort.abort();
      window.clearTimeout(watchdog);
      resizeObserver?.disconnect();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ---------------------------------------------------------- data sync --
  const { events, selectedEventId, focusRegionId, showGraticule, showRegions, globalViewNonce } = props;

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const proj = projectEvents(events);
    (m.getSource('events') as GeoJSONSource).setData(proj.points);
    const areas = regionAreas(proj.regionalCounts, focusRegionId);
    (m.getSource('regions') as GeoJSONSource).setData(areas.polygons);
    (m.getSource('region-labels') as GeoJSONSource).setData(areas.labels);
  }, [ready, events, focusRegionId]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('event-selected', ['==', ['get', 'id'], selectedEventId ?? '__none__']);
    const ev = events.find((e) => e.id === selectedEventId);
    if (ev && isPlottable(ev)) {
      m.easeTo({ center: [ev.longitude!, ev.latitude!], zoom: Math.max(m.getZoom(), 4), duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to selection changes
  }, [ready, selectedEventId]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m || !focusRegionId) return;
    if (skipFocus.current) {
      skipFocus.current = false;
      return;
    }
    const bbox = getRegion(focusRegionId)?.bbox;
    if (bbox) m.fitBounds(bbox, { padding: 48, duration: 700, maxZoom: 6 });
  }, [ready, focusRegionId]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m || globalViewNonce === 0) return;
    m.flyTo({ ...GLOBAL_VIEW, duration: 700 });
  }, [ready, globalViewNonce]);

  const { installations, worldInstallations, showInstallations, selectedInstallation, unusualInstallations } = props;
  const unusualKey = (unusualInstallations ?? []).join('|');
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const keys = unusualKey ? unusualKey.split('|') : [];
    for (const id of ['installation-unusual', 'installation-world-unusual']) m.setFilter(id, ['in', ['get', 'key'], ['literal', keys]]);
  }, [ready, unusualKey]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('installations') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (installations ?? []).map((i) => {
        const c = componentOf(i.component);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [i.lon, i.lat] },
          properties: { key: `dod:${i.name}`, name: i.name, branch: c.branch, label: c.label, active: i.status === 'act' },
        };
      }),
    });
  }, [ready, installations]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('installations-world') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (worldInstallations ?? []).map((w) => {
        const op = operationOf(w);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [w.lo, w.la] },
          properties: { key: `wd:${w.q}`, name: w.n, op, label: `${OPERATION_LABEL[op]} · ${w.k[0] ?? 'installation'}` },
        };
      }),
    });
  }, [ready, worldInstallations]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    for (const id of ['installations', 'installation-labels', 'installation-selected', 'installation-unusual', 'installations-world', 'installation-world-selected', 'installation-world-labels', 'installation-world-unusual']) {
      m.setLayoutProperty(id, 'visibility', showInstallations ? 'visible' : 'none');
    }
  }, [ready, showInstallations]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('installation-selected', ['==', ['get', 'key'], selectedInstallation ?? '__none__']);
    m.setFilter('installation-world-selected', ['==', ['get', 'key'], selectedInstallation ?? '__none__']);
    const dod = installations?.find((i) => `dod:${i.name}` === selectedInstallation);
    const world = worldInstallations?.find((w) => `wd:${w.q}` === selectedInstallation);
    const at: [number, number] | null = dod ? [dod.lon, dod.lat] : world ? [world.lo, world.la] : null;
    if (at) m.easeTo({ center: at, zoom: Math.max(m.getZoom(), 6), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to selection changes
  }, [ready, selectedInstallation]);

  const { imagery } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    if (m.getLayer('imagery')) m.removeLayer('imagery');
    if (m.getSource('imagery')) m.removeSource('imagery');
    if (!imagery) return;
    m.addSource('imagery', { type: 'raster', tiles: [imagery.tiles], tileSize: 256, maxzoom: imagery.maxzoom, attribution: IMAGERY_ATTRIBUTION });
    // Under the basemap's labels and every WATCHTOWER overlay: insert before the first symbol layer.
    const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addLayer({ id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 150 } }, firstSymbol);
  }, [ready, imagery]);

  const { sanctionedShips, showSanctionedShips, selectedSanctionedShip } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const cutoff = Date.now() - 6 * 3_600_000;
    (m.getSource('sanctioned-ships') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (sanctionedShips ?? []).map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lo, s.la] },
        properties: { key: sightingKey(s), name: s.listedName, recent: Date.parse(s.seenAt) >= cutoff },
      })),
    });
  }, [ready, sanctionedShips]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    for (const id of ['sanctioned-ships', 'sanctioned-ship-selected']) m.setLayoutProperty(id, 'visibility', showSanctionedShips ? 'visible' : 'none');
  }, [ready, showSanctionedShips]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('sanctioned-ship-selected', ['==', ['get', 'key'], selectedSanctionedShip ?? '__none__']);
    const s = sanctionedShips?.find((x) => sightingKey(x) === selectedSanctionedShip);
    if (s) m.easeTo({ center: [s.lo, s.la], zoom: Math.max(m.getZoom(), 5), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to selection changes
  }, [ready, selectedSanctionedShip]);

  const { radiation } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('radiation') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (radiation ?? []).map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
        properties: { status: s.status, label: `${s.value.toFixed(3)} µSv/h${ratioOf(s) ? ` · ${ratioOf(s)}×` : ''}` },
      })),
    });
  }, [ready, radiation]);
  const { navWarnings, emergencies, conflicts } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const list = navWarnings ?? [];
    (m.getSource('nav-warnings') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: list
        .filter((w) => w.lat !== null && w.lon !== null)
        .map((w) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [w.lon!, w.lat!] },
          properties: { key: w.key, kindLabel: NAV_KIND_LABEL[w.kind], color: NAV_COLOR[w.kind], text: w.text.length > 220 ? `${w.text.slice(0, 217)}…` : w.text },
        })),
    });
    (m.getSource('nav-warning-areas') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: list
        .filter((w) => w.points.length >= 3)
        .map((w) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [...w.points, w.points[0]].map(([la, lo]) => [lo, la]) },
          properties: { color: NAV_COLOR[w.kind] },
        })),
    });
  }, [ready, navWarnings]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('emergencies') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (emergencies ?? []).map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lo, a.la] },
        properties: { label: `${emergencyLabel(a)} · ${a.sq}`, code: SQUAWK_LABEL[a.sq], type: a.t ?? '', mil: a.mil, sq: a.sq, when: emergencyTiming(a) ?? '' },
      })),
    });
  }, [ready, emergencies]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('conflicts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (conflicts ?? []).map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [c.lo, c.la] },
        properties: { k: c.k, ty: c.ty, typeLabel: VIOLENCE_LABEL[c.ty], d: c.d, country: c.country, a: c.a, b: c.b },
      })),
    });
  }, [ready, conflicts]);
  const { tfrs, airports } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const now = Date.now();
    const hhmm = (iso: string | null) => (iso ? `${iso.slice(11, 16)} UTC ${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
    (m.getSource('tfrs') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (tfrs ?? [])
        .filter((t) => t.path)
        .map((t) => {
          const active = tfrActive(t, now);
          return {
            type: 'Feature' as const,
            geometry: { type: 'MultiPolygon' as const, coordinates: unpackRings(t.path).map((ring) => [ring]) },
            properties: { type: t.type, active, label: `${t.type}${active ? (t.end ? ` · until ${hhmm(t.end)}` : '') : t.start ? ` · from ${hhmm(t.start)}` : ''}` },
          };
        }),
    });
  }, [ready, tfrs]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    // One marker per airport: its most serious event.
    const rank: Record<AirportEvent['kind'], number> = { 'ground-stop': 0, 'ground-delay': 1, closure: 2, 'arrival-delay': 3, 'departure-delay': 4 };
    const best = new Map<string, AirportEvent>();
    for (const a of airports ?? []) if (a.lat !== null && a.lon !== null && (!best.has(a.code) || rank[a.kind] < rank[best.get(a.code)!.kind])) best.set(a.code, a);
    (m.getSource('airports') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [...best.values()].map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lon!, a.lat!] },
        properties: { kind: a.kind, notable: a.notable, label: `${a.code} ${AIRPORT_KIND_LABEL[a.kind].toLowerCase()}: ${a.condition}` },
      })),
    });
  }, [ready, airports]);
  const { powerOutages } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('power-outages') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (powerOutages ?? []).map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'MultiPolygon' as const, coordinates: unpackRings(c.path).map((ring) => [ring]) },
        properties: { fips: c.fips, out: c.out, label: `${c.name}: ${c.out.toLocaleString('en-US')} out` },
      })),
    });
  }, [ready, powerOutages]);
  const { infraSites, showInfrastructure, flaggedInfra, selectedInfra } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('infrastructure') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (infraSites ?? []).map((s) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [s.lo, s.la] }, properties: { id: s.id, type: s.t, name: s.n[0] } })),
    });
  }, [ready, infraSites]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('infrastructure-flagged') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (flaggedInfra ?? []).map((f) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [f.lon, f.lat] }, properties: { id: f.id, type: f.type, name: f.name, selected: f.id === selectedInfra } })),
    });
  }, [ready, flaggedInfra, selectedInfra]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setLayoutProperty('infrastructure', 'visibility', showInfrastructure ? 'visible' : 'none');
  }, [ready, showInfrastructure]);

  const { chokepoints, showChokepoints, selectedChokepoint } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('chokepoints') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (chokepoints ?? []).map((c) => {
        const change = c.mean7 !== null && c.ref2025 ? Math.round((c.mean7 / c.ref2025.total - 1) * 100) : null;
        const word = c.status === 'severe' ? ' SEVERE' : c.status === 'reduced' ? ' REDUCED' : c.status === 'sudden-drop' ? ' DROP' : '';
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [c.lon, c.lat] },
          properties: { id: c.id, status: c.status, label: `${c.name}${word}${change === null ? '' : ` ${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}%`}${c.id === selectedChokepoint ? ' ◂' : ''}` },
        };
      }),
    });
  }, [ready, chokepoints, selectedChokepoint]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setLayoutProperty('chokepoints', 'visibility', showChokepoints ? 'visible' : 'none');
  }, [ready, showChokepoints]);

  const { fleetAreas, showFleet, selectedFleetArea } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('fleet') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (fleetAreas ?? []).flatMap((a) => {
        if (!a.point) return [];
        const big = a.ships.filter((s) => isBigDeck(s.hullType));
        const label = big.length ? big.map((s) => s.hull).join(' · ') : `${a.ships.length} ship${a.ships.length === 1 ? '' : 's'}`;
        return [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [a.point[1], a.point[0]] },
          properties: { name: a.name, big: big.length > 0, label },
        }];
      }),
    });
  }, [ready, fleetAreas]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    for (const id of ['fleet', 'fleet-halo']) m.setLayoutProperty(id, 'visibility', showFleet ? 'visible' : 'none');
  }, [ready, showFleet]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setPaintProperty('fleet-halo', 'circle-stroke-opacity', ['case', ['==', ['get', 'name'], selectedFleetArea ?? '__none__'], 0.95, 0.35]);
    const a = fleetAreas?.find((x) => x.name === selectedFleetArea);
    if (a?.point) m.easeTo({ center: [a.point[1], a.point[0]], zoom: Math.max(m.getZoom(), 3), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to selection changes
  }, [ready, selectedFleetArea]);

  const { aircraft, showAircraft, selectedAircraft } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('aircraft') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (aircraft ?? []).map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lo, a.la] },
        properties: { hex: a.hex, cls: a.cls, trk: a.trk ?? 0, label: aircraftLabel(a), type: aircraftTypeName(a.t) ?? a.t ?? '' },
      })),
    });
  }, [ready, aircraft]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    for (const id of ['aircraft', 'aircraft-selected']) m.setLayoutProperty(id, 'visibility', showAircraft ? 'visible' : 'none');
  }, [ready, showAircraft]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('aircraft-selected', ['==', ['get', 'hex'], selectedAircraft ?? '__none__']);
    const a = aircraft?.find((x) => x.hex === selectedAircraft);
    if (a) m.easeTo({ center: [a.lo, a.la], zoom: Math.max(m.getZoom(), 5), duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to selection changes
  }, [ready, selectedAircraft]);

  // ------------------------------------------------- traffic and lanes --
  const { traffic, selectedTraffic, lanes } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('traffic') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (traffic ?? []).map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lo, s.la] },
        properties: { mmsi: s.mmsi, kind: s.kind, name: s.name ?? '', cog: s.cog ?? 0, stopped: s.sog === null || s.sog < 0.5 },
      })),
    });
    (m.getSource('traffic-tracks') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (traffic ?? [])
        .filter((s) => s.track.length >= 3)
        .map((s) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: trackPoints(s).map(([lo, la]) => [lo, la]) }, properties: { mmsi: s.mmsi, kind: s.kind } })),
    });
  }, [ready, traffic]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('traffic-selected', ['==', ['get', 'mmsi'], selectedTraffic ?? '__none__']);
    m.setFilter('traffic-track-selected', ['==', ['get', 'mmsi'], selectedTraffic ?? '__none__']);
  }, [ready, selectedTraffic]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('lanes') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (lanes ?? []).map((l) => ({ type: 'Feature' as const, geometry: { type: 'MultiLineString' as const, coordinates: l.g }, properties: { c: l.c } })),
    });
  }, [ready, lanes]);

  // ------------------------------------------- undersea lines, disputed areas --
  const { undersea, selectedUndersea, disputed, selectedDisputed } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('undersea') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (undersea ?? []).map((l) => ({ type: 'Feature' as const, geometry: { type: 'MultiLineString' as const, coordinates: l.g }, properties: { id: l.id, k: l.k, name: l.n ?? '' } })),
    });
  }, [ready, undersea]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('disputed') as GeoJSONSource).setData({ type: 'FeatureCollection', features: disputed ?? [] } as GeoJSON.FeatureCollection);
  }, [ready, disputed]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('undersea-selected', ['==', ['get', 'id'], selectedUndersea ?? '__none__']);
    m.setFilter('disputed-selected', ['==', ['get', 'id'], selectedDisputed ?? '__none__']);
  }, [ready, selectedUndersea, selectedDisputed]);

  // ------------------------------------------------------- GPS interference --
  const { gnssCells, gnssLost, gnssCircles, selectedGnss } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('gnss') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (gnssCells ?? []).map((c) => {
        const [w, s, e, n] = cellBounds(c.k);
        return {
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
          properties: { k: c.k, level: c.level },
        };
      }),
    });
    (m.getSource('gnss-lost') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (gnssLost ?? []).map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [p.lo, p.la] }, properties: {} })),
    });
    (m.getSource('gnss-circles') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (gnssCircles ?? []).map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: circleRing(c.lat, c.lon, GNSS_RADIUS_NM * KM_PER_NM) },
        properties: { id: c.id },
      })),
    });
  }, [ready, gnssCells, gnssLost, gnssCircles]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('gnss-selected', ['==', ['get', 'k'], selectedGnss ?? '__none__']);
  }, [ready, selectedGnss]);

  // ---------------------------------------------------------- watch areas --
  const { watchAreas, selectedWatchArea, drawing, draft } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const features: GeoJSON.Feature[] = [];
    for (const a of watchAreas ?? []) {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [shapeRing(a.shape)] }, properties: { id: a.id, name: a.name } });
      const [la, lo] = shapeCentre(a.shape);
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: { id: a.id, name: a.name } });
    }
    (m.getSource('watch-areas') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [ready, watchAreas]);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setFilter('watch-area-selected', ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'id'], selectedWatchArea ?? '__none__']]);
  }, [ready, selectedWatchArea]);
  const draftKey = JSON.stringify(draft ?? null);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const d = JSON.parse(draftKey) as typeof draft;
    const features: GeoJSON.Feature[] = [];
    if (d?.ring) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: d.ring }, properties: {} });
    else if (d && d.points.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: d.points }, properties: {} });
    for (const p of d?.points ?? []) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} });
    (m.getSource('area-draft') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [ready, draftKey]);

  // ------------------------------------------------------------ map tools --
  const { measuring, ruler, pin, handleRef } = props;
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.getCanvas().style.cursor = measuring || drawing ? 'crosshair' : '';
  }, [ready, measuring, drawing]);

  const rulerKey = JSON.stringify(ruler ?? []);
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    const pts = JSON.parse(rulerKey) as LonLat[];
    const features: GeoJSON.Feature[] = pts.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} }));
    if (pts.length === 2) features.unshift({ type: 'Feature', geometry: { type: 'LineString', coordinates: greatCirclePath(pts[0], pts[1]) }, properties: {} });
    (m.getSource('ruler') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [ready, rulerKey]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    (m.getSource('pin') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: pin ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] }, properties: {} }] : [],
    });
  }, [ready, pin]);

  useEffect(() => {
    const m = mapRef.current;
    if (!handleRef) return;
    if (!ready || !m) {
      handleRef.current = null;
      return;
    }
    handleRef.current = {
      flyTo: (lat, lon, zoom) => m.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(m.getZoom(), 6), duration: 700 }),
      fitBounds: (bbox) => m.fitBounds(bbox, { padding: 48, duration: 700, maxZoom: 6 }),
      view: () => ({ lat: m.getCenter().lat, lon: m.getCenter().lng, zoom: m.getZoom() }),
      capture: () =>
        new Promise((resolve) => {
          // The WebGL buffer is only readable during the frame it was drawn in, so copy it on render.
          m.once('render', () => {
            const src = m.getCanvas();
            const out = document.createElement('canvas');
            out.width = src.width;
            out.height = src.height;
            out.getContext('2d')!.drawImage(src, 0, 0);
            resolve(out);
          });
          m.triggerRepaint();
        }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [ready, handleRef]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    m.setLayoutProperty('graticule', 'visibility', showGraticule ? 'visible' : 'none');
    for (const id of ['region-fill', 'region-outline', 'region-labels']) {
      m.setLayoutProperty(id, 'visibility', showRegions ? 'visible' : 'none');
    }
  }, [ready, showGraticule, showRegions]);

  return (
    <div className="absolute inset-0 bg-wt-bg">
      <div ref={containerRef} className="h-full w-full" aria-label="World map of plotted events" role="region" />
      {!ready && !failure && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs tracking-widest text-wt-fg-muted">
          INITIALIZING CARTOGRAPHIC DISPLAY…
        </div>
      )}
      {failure && (
        <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="border border-wt-crit/60 bg-wt-panel p-3 text-xs text-wt-crit">
            <div className="tracking-widest">{failure}</div>
            <div className="mt-1 text-wt-fg-muted">Feed and watchlist remain operational. Check network access to tiles.openfreemap.org.</div>
          </div>
        </div>
      )}
      {mapErrors > 0 && !failure && (
        <div
          role="status"
          className="absolute top-10 left-2 z-10 border border-wt-warn/60 bg-wt-panel px-1.5 py-0.5 text-2xs text-wt-warn"
          title="See browser console for details"
        >
          MAP ERRORS: {mapErrors}
        </div>
      )}
      <span className="sr-only">{WATCH_REGIONS.length} watch regions displayed.</span>
    </div>
  );
}
