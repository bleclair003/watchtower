/**
 * Map ruler (v0.68.0): great-circle distance, initial bearing and a densified line between two points.
 * Spherical Earth (mean radius 6,371.0088 km): within about 0.5% of the ellipsoid, which the readout says.
 */
export type LonLat = [lon: number, lat: number];

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_NM = 1.852;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function greatCircleKm([lo1, la1]: LonLat, [lo2, la2]: LonLat): number {
  const dLat = rad(la2 - la1);
  const dLon = rad(lo2 - lo1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b, 0–360° (0 = north, 90 = east). */
export function initialBearing([lo1, la1]: LonLat, [lo2, la2]: LonLat): number {
  const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2));
  const x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Points along the great circle from a to b, for drawing. Longitudes are kept continuous (they may pass
 * ±180) so the line does not jump across the map at the antimeridian.
 */
export function greatCirclePath(a: LonLat, b: LonLat, steps = 64): LonLat[] {
  const [lo1, la1, lo2, la2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d = greatCircleKm(a, b) / EARTH_RADIUS_KM;
  if (d < 1e-9) return [a, b];
  const out: LonLat[] = [];
  let prevLon = a[0];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    let lon = deg(Math.atan2(y, x));
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    out.push([lon, deg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return out;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassPoint = (bearing: number) => COMPASS[Math.round(bearing / 22.5) % 16];

export interface Measurement {
  km: number;
  nm: number;
  bearing: number;
  /** Bearing from b back to a. */
  back: number;
}

export function measure(a: LonLat, b: LonLat): Measurement {
  const km = greatCircleKm(a, b);
  return { km, nm: km / KM_PER_NM, bearing: initialBearing(a, b), back: initialBearing(b, a) };
}

const num = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));
export function formatMeasurement(m: Measurement): string {
  return `${num(m.km)} km · ${num(m.nm)} nm · bearing ${m.bearing.toFixed(0).padStart(3, '0')}° (${compassPoint(m.bearing)}), back ${m.back.toFixed(0).padStart(3, '0')}°`;
}

export function formatLonLat([lon, lat]: LonLat): string {
  const L = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(L).toFixed(3)}°${L >= 0 ? 'E' : 'W'}`;
}
