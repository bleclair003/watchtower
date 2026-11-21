/**
 * Satellite imagery from NASA GIBS (Global Imagery Browse Services), shown as a map layer the
 * operator turns on. Daily global mosaics; free, no key; credit NASA EOSDIS GIBS.
 */

export type ImageryId = 'off' | 'viirs' | 'modis' | 'night' | 'night-2016';

interface ImageryProduct {
  label: string;
  layer: string;
  /** GoogleMapsCompatible tile matrix level = max zoom. */
  maxzoom: number;
  format: 'jpg' | 'png';
  /** Fixed date for reference products; otherwise the chosen day. */
  fixedDate?: string;
  note: string;
}

export const IMAGERY: Record<Exclude<ImageryId, 'off'>, ImageryProduct> = {
  viirs: {
    label: 'True colour · VIIRS NOAA-20',
    layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    maxzoom: 9,
    format: 'jpg',
    note: 'Daily daytime mosaic, ~375 m pixels at best. Clouds hide the ground; swath gaps show as black wedges.',
  },
  modis: {
    label: 'True colour · MODIS Terra',
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    maxzoom: 9,
    format: 'jpg',
    note: 'Daily morning pass, ~250 m pixels. A second look when VIIRS is cloudy.',
  },
  night: {
    label: 'Night lights · VIIRS NOAA-20',
    layer: 'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance',
    maxzoom: 8,
    format: 'png',
    note: 'Nighttime radiance: city lights, fires, gas flares. Moonlight and clouds change brightness; compare with the 2016 baseline before reading a blackout.',
  },
  'night-2016': {
    label: 'Night lights baseline · Black Marble 2016',
    layer: 'VIIRS_Black_Marble',
    maxzoom: 8,
    format: 'png',
    fixedDate: '2016-01-01',
    note: 'Cloud-free annual composite of 2016: what normal looks like.',
  },
};

export const GIBS_ORIGIN = 'https://gibs.earthdata.nasa.gov';
export const IMAGERY_ATTRIBUTION = 'Imagery: NASA EOSDIS GIBS';

/** Yesterday (UTC): today's mosaic is still being filled in. */
export const defaultImageryDate = (now: number) => new Date(now - 86_400_000).toISOString().slice(0, 10);

export function imageryTiles(id: Exclude<ImageryId, 'off'>, date: string): { tiles: string; maxzoom: number; date: string } {
  const p = IMAGERY[id];
  const day = p.fixedDate ?? date;
  return {
    tiles: `${GIBS_ORIGIN}/wmts/epsg3857/best/${p.layer}/default/${day}/GoogleMapsCompatible_Level${p.maxzoom}/{z}/{y}/{x}.${p.format}`,
    maxzoom: p.maxzoom,
    date: day,
  };
}
