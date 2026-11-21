/**
 * Military aircraft seen on ADS-B (Phase 13, item 1).
 *
 * Positions come from community ADS-B networks (adsb.lol, fallback adsb.fi): volunteer
 * receivers pick up what aircraft broadcast, and the network flags an aircraft as military
 * from its own community database. Only aircraft that transmit are seen; many military
 * flights do not, so absence of aircraft is not absence of activity.
 *
 * Types are ICAO Doc 8643 designators. Several tankers and command aircraft (KC-46, KC-10,
 * A330 MRTT, E-4B) share airliner designators, so they cannot be told apart from VIP or
 * transport airframes by type alone and are classed `other`.
 */

export const AIRCRAFT_CLASSES = ['tanker', 'isr', 'bomber', 'airlift', 'fighter', 'helicopter', 'other'] as const;
export type AircraftClass = (typeof AIRCRAFT_CLASSES)[number];

export const AIRCRAFT_CLASS_LABEL: Record<AircraftClass, string> = {
  tanker: 'Tanker',
  isr: 'Surveillance / command',
  bomber: 'Bomber',
  airlift: 'Airlift',
  fighter: 'Fighter / attack',
  helicopter: 'Helicopter / tiltrotor',
  other: 'Other / VIP / unknown',
};

/** Classes that become WATCHTOWER records and feed the air-activity indicators. */
export const NOTABLE_AIRCRAFT_CLASSES: AircraftClass[] = ['tanker', 'isr', 'bomber', 'airlift'];
/** Strategic classes: the air-activity indicator counts these. */
export const STRATEGIC_AIRCRAFT_CLASSES: AircraftClass[] = ['tanker', 'isr', 'bomber'];

/** ICAO designator → [name, class]. Names follow ICAO Doc 8643. */
export const AIRCRAFT_TYPES: Record<string, [string, AircraftClass]> = {
  // Tankers
  K35R: ['KC-135R/T Stratotanker', 'tanker'],
  K35E: ['KC-135E Stratotanker', 'tanker'],
  KE3: ['KE-3 tanker', 'tanker'],
  // Surveillance, maritime patrol, airborne early warning, command
  E3CF: ['E-3 Sentry (AWACS)', 'isr'],
  E3TF: ['E-3 Sentry (AWACS)', 'isr'],
  E767: ['E-767 AWACS', 'isr'],
  E737: ['737 AEW&C (E-7 Wedgetail)', 'isr'],
  E6: ['E-6 Mercury', 'isr'],
  E2: ['E-2 Hawkeye', 'isr'],
  A50: ['A-50 AEW&C', 'isr'],
  R135: ['RC-135', 'isr'],
  P8: ['P-8 Poseidon', 'isr'],
  P3: ['P-3 Orion', 'isr'],
  P1: ['Kawasaki P-1', 'isr'],
  IL38: ['Il-38', 'isr'],
  TU95: ['Tu-142', 'isr'],
  U2: ['U-2', 'isr'],
  Q4: ['RQ-4 Global Hawk', 'isr'],
  Q9: ['MQ-9 Reaper', 'isr'],
  // Bombers
  B52: ['B-52 Stratofortress', 'bomber'],
  B1: ['B-1 Lancer', 'bomber'],
  B2: ['B-2 Spirit', 'bomber'],
  B21: ['B-21 Raider', 'bomber'],
  T160: ['Tu-160', 'bomber'],
  T22M: ['Tu-22M', 'bomber'],
  // Airlift
  C17: ['C-17 Globemaster III', 'airlift'],
  C5M: ['C-5M Super Galaxy', 'airlift'],
  A400: ['A400M Atlas', 'airlift'],
  IL76: ['Il-76/78', 'airlift'],
  A124: ['An-124 Ruslan', 'airlift'],
  AN22: ['An-22', 'airlift'],
  AN12: ['An-12', 'airlift'],
  Y20: ['Y-20 Kunpeng', 'airlift'],
  KC2: ['Kawasaki C-2', 'airlift'],
  E390: ['C-390 / KC-390', 'airlift'],
  C130: ['C-130 Hercules', 'airlift'],
  C30J: ['C-130J Super Hercules', 'airlift'],
  C27J: ['C-27J Spartan', 'airlift'],
  C295: ['C-295', 'airlift'],
  // Fighters and attack aircraft (rarely broadcast)
  F15: ['F-15 Eagle', 'fighter'],
  F16: ['F-16 Fighting Falcon', 'fighter'],
  F18H: ['F/A-18 Hornet', 'fighter'],
  F18S: ['F/A-18 Super Hornet', 'fighter'],
  F22: ['F-22 Raptor', 'fighter'],
  F35: ['F-35 Lightning II', 'fighter'],
  VF35: ['F-35B Lightning II', 'fighter'],
  EUFI: ['Eurofighter Typhoon', 'fighter'],
  RFAL: ['Rafale', 'fighter'],
  TOR: ['Tornado', 'fighter'],
  SB39: ['Gripen', 'fighter'],
  SGCD: ['Gripen C/D', 'fighter'],
  SGEF: ['Gripen E/F', 'fighter'],
  SU27: ['Su-27/30/34/35 family', 'fighter'],
  SU57: ['Su-57', 'fighter'],
  SU24: ['Su-24', 'fighter'],
  SU25: ['Su-25', 'fighter'],
  MG29: ['MiG-29', 'fighter'],
  MG31: ['MiG-31', 'fighter'],
  F5: ['F-5', 'fighter'],
  // Helicopters and tiltrotors
  H60: ['UH-60 Black Hawk', 'helicopter'],
  H64: ['AH-64 Apache', 'helicopter'],
  H47: ['CH-47 Chinook', 'helicopter'],
  V22: ['V-22 Osprey', 'helicopter'],
  NH90: ['NH90', 'helicopter'],
  EH10: ['AW101 Merlin', 'helicopter'],
  TIGR: ['Tiger', 'helicopter'],
  MI8: ['Mi-8/17', 'helicopter'],
  MI24: ['Mi-24/35', 'helicopter'],
  MI26: ['Mi-26', 'helicopter'],
  MI28: ['Mi-28', 'helicopter'],
  KA52: ['Ka-52', 'helicopter'],
  EC45: ['EC145 / UH-72', 'helicopter'],
  A139: ['AW139', 'helicopter'],
  W3: ['W-3 Sokol', 'helicopter'],
};

export function aircraftClassOf(type: string | null | undefined): AircraftClass {
  return (type && AIRCRAFT_TYPES[type]?.[1]) || 'other';
}

export function aircraftTypeName(type: string | null | undefined): string | null {
  if (!type) return null;
  return AIRCRAFT_TYPES[type]?.[0] ?? null;
}

/** One aircraft position, compact (it is stored in the dashboard snapshot). */
export interface AircraftPosition {
  /** ICAO 24-bit address (hex). */
  hex: string;
  /** Callsign as broadcast, or null. */
  cs: string | null;
  /** Registration (from the network's database), or null. */
  reg: string | null;
  /** ICAO type designator, or null. */
  t: string | null;
  cls: AircraftClass;
  la: number;
  lo: number;
  /** Barometric altitude in feet, or null. */
  alt: number | null;
  /** Ground speed in knots, or null. */
  gs: number | null;
  /** Track in degrees, or null. */
  trk: number | null;
  /** Seconds since the position was received, at fetch time. */
  age: number;
  /** Emergency status broadcast (general, lifeguard, minfuel, nordo, unlawful, downed), or null. */
  em: string | null;
}

export interface AircraftProvider {
  id: 'adsb.lol' | 'adsb.fi';
  name: string;
  website: string;
  licence: string;
  /** Link to an aircraft on the provider's map. */
  aircraftUrl: (hex: string) => string;
}

export const AIRCRAFT_PROVIDERS: Record<AircraftProvider['id'], AircraftProvider> = {
  'adsb.lol': {
    id: 'adsb.lol',
    name: 'adsb.lol',
    website: 'https://adsb.lol',
    licence: 'ODbL 1.0',
    aircraftUrl: (hex) => `https://globe.adsb.lol/?icao=${encodeURIComponent(hex)}`,
  },
  'adsb.fi': {
    id: 'adsb.fi',
    name: 'adsb.fi',
    website: 'https://adsb.fi',
    licence: 'personal, non-commercial use; cite adsb.fi',
    aircraftUrl: (hex) => `https://globe.adsb.fi/?icao=${encodeURIComponent(hex)}`,
  },
};

/** Latest positions, written by the collector into the dashboard snapshot. */
export interface AircraftSnapshot {
  fetchedAt: string;
  provider: AircraftProvider['id'];
  /** Aircraft the network marked military (with or without a position). */
  totalMarked: number;
  aircraft: AircraftPosition[];
  /** Demo fixtures only: the UI labels these SIMULATED. */
  simulated?: boolean;
}

/** Positions older than this are not drawn (the collector runs every 30 minutes). */
export const AIRCRAFT_STALE_MINUTES = 90;

export function aircraftLabel(a: Pick<AircraftPosition, 'cs' | 'reg' | 'hex'>): string {
  return a.cs || a.reg || a.hex.toUpperCase();
}
