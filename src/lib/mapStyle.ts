import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

/**
 * Basemap: OpenFreeMap "dark" style (https://openfreemap.org — free, no API
 * key, no usage limits for reasonable use; data © OpenStreetMap contributors).
 *
 * `militarizeStyle` recolours the vector style into the WATCHTOWER phosphor
 * palette and strips decorative raster relief. It is a pure function so it can
 * be unit-tested without a browser.
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export const MAP_COLORS = {
  land: '#0A1410',
  water: '#030705',
  landcover: '#0C1813',
  road: '#11231B',
  boundaryCountry: '#2F6A4C',
  boundaryState: '#1A3326',
  label: '#4E7D63',
  labelMajor: '#6E9F84',
  halo: '#030705',
} as const;

function paint(layer: LayerSpecification, props: Record<string, unknown>): LayerSpecification {
  return { ...layer, paint: { ...(layer as { paint?: object }).paint, ...props } } as LayerSpecification;
}

export function militarizeStyle(style: StyleSpecification): StyleSpecification {
  const layers: LayerSpecification[] = [];

  for (const layer of style.layers) {
    const id = layer.id;
    // Remove raster hillshade/relief and building footprints: noise at our zoom levels.
    if (layer.type === 'raster' || id.startsWith('building')) continue;

    if (layer.type === 'background') {
      layers.push(paint(layer, { 'background-color': MAP_COLORS.land }));
    } else if (id === 'water') {
      layers.push(paint(layer, { 'fill-color': MAP_COLORS.water }));
    } else if (id === 'waterway') {
      layers.push(paint(layer, { 'line-color': MAP_COLORS.water }));
    } else if (layer.type === 'fill') {
      layers.push(paint(layer, { 'fill-color': MAP_COLORS.landcover }));
    } else if (id.startsWith('boundary_country')) {
      layers.push(paint(layer, { 'line-color': MAP_COLORS.boundaryCountry }));
    } else if (id.startsWith('boundary')) {
      layers.push(paint(layer, { 'line-color': MAP_COLORS.boundaryState }));
    } else if (layer.type === 'line') {
      layers.push(paint(layer, { 'line-color': MAP_COLORS.road }));
    } else if (layer.type === 'symbol') {
      const major = id.startsWith('place_country') || id === 'place_city_large';
      layers.push(
        paint(layer, {
          'text-color': major ? MAP_COLORS.labelMajor : MAP_COLORS.label,
          'text-halo-color': MAP_COLORS.halo,
        }),
      );
    } else {
      layers.push(layer);
    }
  }

  const sources = Object.fromEntries(
    Object.entries(style.sources).filter(([, src]) => src.type !== 'raster'),
  ) as StyleSpecification['sources'];

  return { ...style, sources, layers };
}

/** First text-font stack used by the style, so our overlay labels use available glyphs. */
export function findTextFont(style: StyleSpecification): string[] {
  for (const l of style.layers) {
    if (l.type === 'symbol') {
      const font = (l.layout as Record<string, unknown> | undefined)?.['text-font'];
      if (Array.isArray(font) && font.every((f) => typeof f === 'string')) return font as string[];
    }
  }
  return ['Noto Sans Regular'];
}
