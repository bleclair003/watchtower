/**
 * Maritime chokepoints watched for ship traffic (Phase 13, item 3). Boxes are WATCHTOWER's own
 * approximate outlines of each strait or canal (south-west and north-east corners); they are
 * not legal or navigational boundaries.
 */
export interface Chokepoint {
  id: string;
  name: string;
  regionId: string | null;
  /** [[south, west], [north, east]] in degrees. */
  box: [[number, number], [number, number]];
}

export const CHOKEPOINTS: Chokepoint[] = [
  { id: 'hormuz', name: 'Strait of Hormuz', regionId: 'middle-east', box: [[25.8, 55.8], [27.2, 57.2]] },
  { id: 'bab-el-mandeb', name: 'Bab el-Mandeb', regionId: 'red-sea', box: [[12.2, 42.9], [13.2, 43.8]] },
  { id: 'suez', name: 'Suez Canal', regionId: null, box: [[29.85, 32.25], [31.35, 32.6]] },
  { id: 'bosporus', name: 'Bosporus', regionId: 'eastern-europe', box: [[40.95, 28.95], [41.25, 29.15]] },
  { id: 'taiwan-strait', name: 'Taiwan Strait', regionId: 'taiwan-strait', box: [[23.5, 119.0], [25.5, 120.6]] },
];

export function chokepointAt(lat: number, lon: number): Chokepoint | null {
  return CHOKEPOINTS.find(({ box: [[s, w], [n, e]] }) => lat >= s && lat <= n && lon >= w && lon <= e) ?? null;
}
