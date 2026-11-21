/**
 * US Navy fleet positions from the USNI News Fleet and Marine Tracker (Phase 13, item 2).
 *
 * USNI News publishes the tracker weekly (usually Monday). It places deployed ships in named
 * areas ("In the Arabian Sea", "In Sasebo, Japan"), based on Navy and public information. The
 * Navy does not publish exact positions, so neither does WATCHTOWER: a ship is shown at the
 * named area's reference point, marked approximate.
 */

/** Hull types WATCHTOWER tracks individually: aircraft carriers and big-deck amphibious ships. */
export const BIG_DECK_HULLS = ['CVN', 'LHA', 'LHD'] as const;
export type BigDeckHull = (typeof BIG_DECK_HULLS)[number];

export const HULL_LABEL: Record<string, string> = {
  CVN: 'Aircraft carrier',
  LHA: 'Amphibious assault ship',
  LHD: 'Amphibious assault ship',
  LPD: 'Amphibious transport dock',
  LSD: 'Dock landing ship',
  LCC: 'Command ship',
  CG: 'Cruiser',
  DDG: 'Destroyer',
  LCS: 'Littoral combat ship',
  ESB: 'Expeditionary sea base',
  SSN: 'Attack submarine',
  SSGN: 'Guided-missile submarine',
  T: 'Military Sealift Command ship',
};

export const isBigDeck = (hull: string): hull is BigDeckHull => (BIG_DECK_HULLS as readonly string[]).includes(hull);

export interface FleetShip {
  /** "USS Theodore Roosevelt" */
  name: string;
  /** "CVN-71" */
  hull: string;
  /** "CVN" */
  hullType: string;
}

/**
 * A named area from the tracker. `point` is the area's reference point (centre of a sea,
 * or the port), NOT a ship position. Null when the area is too vague to place (e.g. "Japan").
 */
export interface FleetArea {
  /** As written by USNI News, without "In" and "the" ("Arabian Sea"). */
  name: string;
  point: [lat: number, lon: number] | null;
  regionIds: string[];
  /** ISO alpha-2 for ports and countries; null for open water. */
  country: string | null;
  ships: FleetShip[];
}

export interface FleetSnapshot {
  /** Date the tracker gives positions for (YYYY-MM-DD). */
  asOf: string;
  title: string;
  url: string;
  publishedAt: string;
  areas: FleetArea[];
  /** Demo fixtures only: the UI labels these SIMULATED. */
  simulated?: boolean;
}

interface AreaRef {
  point: [number, number] | null;
  regionIds?: string[];
  country?: string;
}

/**
 * Reference points for the area names USNI News uses (collected from 29 trackers, Apr–Nov
 * 2026). Seas use an approximate centre; ports use the city. Watch regions are assigned only
 * where the area lies in or next to a watch area.
 */
export const FLEET_AREAS: Record<string, AreaRef> = {
  // Middle East and Red Sea
  'arabian sea': { point: [16.0, 62.0], regionIds: ['middle-east'] },
  'gulf of oman': { point: [24.5, 58.5], regionIds: ['middle-east'] },
  'arabian gulf': { point: [27.0, 51.0], regionIds: ['middle-east'] },
  'persian gulf': { point: [27.0, 51.0], regionIds: ['middle-east'] },
  'north arabian sea': { point: [21.0, 62.0], regionIds: ['middle-east'] },
  'eastern mediterranean': { point: [34.0, 31.0], regionIds: ['middle-east'] },
  'eastern mediterranean sea': { point: [34.0, 31.0], regionIds: ['middle-east'] },
  bahrain: { point: [26.2, 50.6], regionIds: ['middle-east'], country: 'BH' },
  'red sea': { point: [20.0, 38.5], regionIds: ['red-sea'] },
  'gulf of aden': { point: [12.5, 47.5], regionIds: ['red-sea'] },
  djibouti: { point: [11.6, 43.1], regionIds: ['red-sea'], country: 'DJ' },
  // Europe
  'mediterranean sea': { point: [36.0, 18.0] },
  mediterranean: { point: [36.0, 18.0] },
  'black sea': { point: [43.5, 34.0], regionIds: ['eastern-europe'] },
  'baltic sea': { point: [57.0, 19.0], regionIds: ['eastern-europe'] },
  'north sea': { point: [56.0, 3.0] },
  'english channel': { point: [50.2, -1.0] },
  'norwegian sea': { point: [68.0, 5.0] },
  norway: { point: null, country: 'NO' },
  'rota, spain': { point: [36.62, -6.35], country: 'ES' },
  'souda bay, greece': { point: [35.49, 24.14], country: 'GR' },
  'portsmouth, england': { point: [50.8, -1.1], country: 'GB' },
  'zeebrugge, belgium': { point: [51.33, 3.2], country: 'BE' },
  'kiel, germany': { point: [54.32, 10.14], country: 'DE' },
  // Asia-Pacific
  'south china sea': { point: [13.0, 114.0], regionIds: ['south-china-sea'] },
  'sulu sea': { point: [8.5, 120.0], regionIds: ['south-china-sea'] },
  'manila, philippines': { point: [14.6, 120.98], regionIds: ['south-china-sea'], country: 'PH' },
  'da nang, vietnam': { point: [16.07, 108.22], regionIds: ['south-china-sea'], country: 'VN' },
  'east china sea': { point: [29.0, 125.0] },
  'taiwan strait': { point: [24.0, 119.5], regionIds: ['taiwan-strait'] },
  'yellow sea': { point: [36.0, 123.0], regionIds: ['korean-peninsula'] },
  'sea of japan': { point: [40.0, 135.0], regionIds: ['korean-peninsula'] },
  'busan, south korea': { point: [35.1, 129.04], regionIds: ['korean-peninsula'], country: 'KR' },
  'philippine sea': { point: [20.0, 132.0] },
  'western pacific': { point: [15.0, 145.0] },
  japan: { point: null, country: 'JP' },
  'sasebo, japan': { point: [33.16, 129.72], country: 'JP' },
  'yokosuka, japan': { point: [35.28, 139.67], country: 'JP' },
  'okinawa, japan': { point: [26.5, 127.9], country: 'JP' },
  guam: { point: [13.44, 144.79], country: 'US' },
  singapore: { point: [1.29, 103.85], country: 'SG' },
  'strait of malacca': { point: [4.0, 100.0] },
  'andaman sea': { point: [10.0, 96.0] },
  'phuket, thailand': { point: [7.88, 98.39], country: 'TH' },
  'indian ocean': { point: [-5.0, 75.0] },
  'southern indian ocean': { point: [-25.0, 80.0] },
  // Pacific and Americas
  'pacific ocean': { point: null },
  'southern pacific': { point: [-20.0, -140.0] },
  'eastern pacific': { point: [15.0, -110.0] },
  'hawaiian operating areas': { point: [21.0, -158.5], country: 'US' },
  'pearl harbor, hawaii': { point: [21.35, -157.95], country: 'US' },
  'california operating area': { point: [32.5, -118.5] },
  'san diego': { point: [32.7, -117.2], country: 'US' },
  'western atlantic': { point: [33.0, -72.0] },
  'atlantic ocean': { point: [30.0, -40.0] },
  'south atlantic': { point: [-20.0, -20.0] },
  caribbean: { point: [15.0, -75.0] },
  'caribbean sea': { point: [15.0, -75.0] },
  'la guaira, venezuela': { point: [10.6, -66.93], country: 'VE' },
  'kingston, jamaica': { point: [17.97, -76.79], country: 'JM' },
  panama: { point: [9.0, -79.5], country: 'PA' },
  'new york city': { point: [40.7, -74.0], country: 'US' },
  'new orleans': { point: [29.95, -90.07], country: 'US' },
  'houston, texas': { point: [29.76, -95.37], country: 'US' },
  norfolk: { point: [36.95, -76.33], country: 'US' },
};

/** "In the Arabian Sea" → "Arabian Sea". */
export function areaNameOf(heading: string): string | null {
  const h = heading.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^In\s+(?:the\s+)?(.+?)\.?$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Reference point and regions for an area name; unknown names get no point (never guessed). */
export function resolveFleetArea(name: string): Pick<FleetArea, 'point' | 'regionIds' | 'country'> {
  const ref = FLEET_AREAS[name.toLowerCase()];
  return { point: ref?.point ?? null, regionIds: ref?.regionIds ?? [], country: ref?.country ?? null };
}

/** Trackers older than this are shown as out of date (USNI publishes weekly). */
export const FLEET_STALE_DAYS = 10;
