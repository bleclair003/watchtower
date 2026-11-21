import { useEffect, useRef, useState } from 'react';
import { componentOf, operationOf, type Branch, type Installation, type Operation, type WorldInstallation } from '@shared/domain/installations';
import '../../lib/maplibreSetup';
import { Map as MLMap, NavigationControl, Popup, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from 'maplibre-gl';
import { EVENT_CATEGORIES, type IntelligenceEvent } from '@shared/domain/types';
import { WATCH_REGIONS, getRegion } from '@shared/domain/regions';
import { CATEGORY_STYLES } from '../../config/categories';
import { BASEMAP_STYLE_URL, findTextFont, militarizeStyle } from '../../lib/mapStyle';
import { graticule, isPlottable, projectEvents, regionAreas } from '../../lib/geo';

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
  /** Military installations layer (optional): DoD sites (US) and worldwide sites (Wikidata). */
  installations?: Installation[];
  worldInstallations?: WorldInstallation[];
  showInstallations?: boolean;
  /** Selection key: `dod:<name>` or `wd:<Wikidata id>`. */
  selectedInstallation?: string | null;
  onSelectInstallation?: (key: string | null) => void;
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

      const m = new MLMap({
        container: containerRef.current,
        style,
        ...GLOBAL_VIEW,
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

        m.addSource('graticule', { type: 'geojson', data: graticule(30) });
        m.addLayer({
          id: 'graticule',
          type: 'line',
          source: 'graticule',
          paint: { 'line-color': '#123323', 'line-width': 0.6, 'line-dasharray': [2, 3] },
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
        for (const layer of ['clusters', 'region-fill']) {
          m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
          m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
        }

        m.on('click', async (e) => {
          const pts = m.queryRenderedFeatures(e.point, { layers: ['events'] });
          if (pts[0]) {
            cb.current.onSelectEvent(String(pts[0].properties.id));
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
          if (clusters[0]) {
            const src = m.getSource('events') as GeoJSONSource;
            const zoom = await src.getClusterExpansionZoom(clusters[0].properties.cluster_id as number);
            m.easeTo({ center: (clusters[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
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
    const bbox = getRegion(focusRegionId)?.bbox;
    if (bbox) m.fitBounds(bbox, { padding: 48, duration: 700, maxZoom: 6 });
  }, [ready, focusRegionId]);

  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m || globalViewNonce === 0) return;
    m.flyTo({ ...GLOBAL_VIEW, duration: 700 });
  }, [ready, globalViewNonce]);

  const { installations, worldInstallations, showInstallations, selectedInstallation } = props;
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
    for (const id of ['installations', 'installation-labels', 'installation-selected', 'installations-world', 'installation-world-selected', 'installation-world-labels']) {
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
          className="absolute top-2 left-2 z-10 border border-wt-warn/60 bg-wt-panel px-1.5 py-0.5 text-2xs text-wt-warn"
          title="See browser console for details"
        >
          MAP ERRORS: {mapErrors}
        </div>
      )}
      <span className="sr-only">{WATCH_REGIONS.length} watch regions displayed.</span>
    </div>
  );
}
