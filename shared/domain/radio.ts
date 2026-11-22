/**
 * Radio listening links (Phase 28, v0.64.0).
 *
 * WATCHTOWER only LINKS to radio: it never plays, records, transcribes or re-streams audio, and never
 * connects to a receiver itself (receivers have 4–8 listener slots; the viewer's click is the only use).
 *  - Shortwave: the public KiwiSDR receiver list (kiwisdr.com/public, via the rx.linkfanel.net mirror),
 *    fetched once a day; a link opens the receiver already tuned (`?f=8992usb`).
 *  - Air traffic control: LiveATC's airport page (it says itself when an airport is not covered, and why).
 *  - US scanners: Broadcastify's state page (their terms forbid automated feed lists, so it is a fixed table).
 * Every frequency below cites where it comes from; anything not confirmed is left out.
 */
import { getRegion } from './regions.ts';

// ------------------------------------------------------------------ receivers

/** One public KiwiSDR receiver, trimmed to what a link needs. */
export interface RadioReceiver {
  name: string;
  /** Base address, e.g. http://host:8073 (no path, no credentials). */
  url: string;
  lat: number;
  lon: number;
  /** Tunable range in kHz. */
  minKhz: number;
  maxKhz: number;
  /** Listener slots (from the list; how many are free changes by the minute). */
  slots: number;
}

export interface RadioReceiversSnapshot {
  fetchedAt: string;
  /** When the list itself was generated, as it says (or null). */
  listTime: string | null;
  receivers: RadioReceiver[];
  simulated?: boolean;
}

const RAD = Math.PI / 180;
export function distanceKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const a = Math.sin(((la2 - la1) * RAD) / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(((lo2 - lo1) * RAD) / 2) ** 2;
  return 12_742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Only plain http(s) addresses on the host itself: no credentials, no path, no query. */
export function cleanReceiverUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Parses the dyatlov-format list (`var kiwisdr_com = [ {...}, ... ];`, with trailing commas).
 * Receivers that are offline, have no position or no usable address are dropped.
 */
export function parseKiwiList(body: string): { receivers: RadioReceiver[]; listTime: string | null } {
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('receiver list: no array found');
  const json = body.slice(start, end + 1).replace(/,(\s*[\]}])/g, '$1');
  const raw = JSON.parse(json) as Record<string, unknown>[];
  if (!Array.isArray(raw)) throw new Error('receiver list: not an array');
  const stamp = /data timestamp:\s*([^\n]+)/.exec(body)?.[1]?.trim();
  const listTime = stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
  const receivers: RadioReceiver[] = [];
  for (const r of raw) {
    if (r.offline === 'yes' || (r.status && r.status !== 'active')) continue;
    const url = cleanReceiverUrl(r.url);
    const gps = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(String(r.gps ?? ''));
    if (!url || !gps) continue;
    const lat = Number(gps[1]);
    const lon = Number(gps[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const bands = /^(\d+)-(\d+)$/.exec(String(r.bands ?? ''));
    const minKhz = bands ? Number(bands[1]) / 1000 : 0;
    const maxKhz = bands ? Number(bands[2]) / 1000 : 30_000;
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim();
    receivers.push({
      name: name.length > 60 ? `${name.slice(0, 59)}…` : name || url,
      url,
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      minKhz,
      maxKhz,
      slots: Math.max(1, Math.min(16, Number(r.users_max) || 4)),
    });
  }
  return { receivers, listTime };
}

/** The nearest receivers that can tune to every given frequency. */
export function nearestReceivers(receivers: RadioReceiver[], lat: number, lon: number, kHz: number[], n = 3): (RadioReceiver & { km: number })[] {
  return receivers
    .filter((r) => kHz.every((k) => k >= r.minKhz && k <= r.maxKhz))
    .map((r) => ({ ...r, km: distanceKm(lat, lon, r.lat, r.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

export type RadioMode = 'usb' | 'lsb' | 'am' | 'cw';

/** Opens a KiwiSDR receiver tuned to the frequency (kHz) and mode. */
export function kiwiTuneUrl(r: Pick<RadioReceiver, 'url'>, kHz: number, mode: RadioMode): string {
  return `${r.url}/?f=${kHz}${mode}`;
}

/** The University of Twente WebSDR (Netherlands, 0–29 MHz): a fixed fallback that needs no list. */
export const TWENTE_WEBSDR = { name: 'University of Twente WebSDR (Netherlands)', url: 'http://websdr.ewi.utwente.nl:8901', maxKhz: 29_000 };
export const twenteTuneUrl = (kHz: number, mode: RadioMode) => `${TWENTE_WEBSDR.url}/?tune=${kHz}${mode}`;

// ------------------------------------------------------------------ ATC and scanners

export const liveAtcUrl = (icao: string) => `https://www.liveatc.net/search/?icao=${encodeURIComponent(icao.toUpperCase())}`;

/** Broadcastify state pages use the US state FIPS code (checked: 6 California, 36 New York, 48 Texas, 72 Puerto Rico). */
const STATE_FIPS: Record<string, [number, string]> = {
  AL: [1, 'Alabama'], AK: [2, 'Alaska'], AZ: [4, 'Arizona'], AR: [5, 'Arkansas'], CA: [6, 'California'], CO: [8, 'Colorado'], CT: [9, 'Connecticut'],
  DE: [10, 'Delaware'], DC: [11, 'District of Columbia'], FL: [12, 'Florida'], GA: [13, 'Georgia'], HI: [15, 'Hawaii'], ID: [16, 'Idaho'], IL: [17, 'Illinois'],
  IN: [18, 'Indiana'], IA: [19, 'Iowa'], KS: [20, 'Kansas'], KY: [21, 'Kentucky'], LA: [22, 'Louisiana'], ME: [23, 'Maine'], MD: [24, 'Maryland'],
  MA: [25, 'Massachusetts'], MI: [26, 'Michigan'], MN: [27, 'Minnesota'], MS: [28, 'Mississippi'], MO: [29, 'Missouri'], MT: [30, 'Montana'], NE: [31, 'Nebraska'],
  NV: [32, 'Nevada'], NH: [33, 'New Hampshire'], NJ: [34, 'New Jersey'], NM: [35, 'New Mexico'], NY: [36, 'New York'], NC: [37, 'North Carolina'],
  ND: [38, 'North Dakota'], OH: [39, 'Ohio'], OK: [40, 'Oklahoma'], OR: [41, 'Oregon'], PA: [42, 'Pennsylvania'], RI: [44, 'Rhode Island'],
  SC: [45, 'South Carolina'], SD: [46, 'South Dakota'], TN: [47, 'Tennessee'], TX: [48, 'Texas'], UT: [49, 'Utah'], VT: [50, 'Vermont'], VA: [51, 'Virginia'],
  WA: [53, 'Washington'], WV: [54, 'West Virginia'], WI: [55, 'Wisconsin'], WY: [56, 'Wyoming'], PR: [72, 'Puerto Rico'],
};

/** `US-NY` → Broadcastify's New York page, or null outside the table. */
export function broadcastifyState(isoRegion: string): { name: string; url: string } | null {
  const m = /^US-([A-Z]{2})$/.exec(isoRegion);
  const s = m ? STATE_FIPS[m[1]] : undefined;
  return s ? { name: s[1], url: `https://www.broadcastify.com/listen/stid/${s[0]}` } : null;
}

// ------------------------------------------------------------------ frequencies

export interface RadioSource {
  label: string;
  url: string;
}

export interface RadioFrequency {
  id: string;
  name: string;
  /** Frequencies in kHz. */
  kHz: number[];
  mode: RadioMode;
  /** 'global' entries show on every region panel. */
  regions: 'global' | string[];
  hear: string;
  /** Best times, when the sources say. */
  when?: string;
  /** Day and night frequencies, with the UTC hours counted as day there, when the sources say. */
  dayNight?: { day: number; night: number; dayFromUtc: number; dayToUtc: number };
  /** Where to look for a receiver: a point near the transmitters, or the region being viewed. */
  listenNear: [number, number] | 'region';
  /**
   * 'broadcast': meant for anyone (weather, time, broadcast stations). 'communication': traffic between
   * stations (ATC, military, ship to shore). Several countries, the UK among them, forbid listening to the second kind.
   */
  kind: 'broadcast' | 'communication';
  sources: RadioSource[];
}

const PRIYOM = 'priyom.org (CC BY-NC-SA 4.0)';

export const RADIO_FREQUENCIES: RadioFrequency[] = [
  {
    id: 'hfgcs',
    name: 'US Air Force HF network (HFGCS)',
    kHz: [4724, 6739, 8992, 11175, 13200, 15016],
    mode: 'usb',
    regions: 'global',
    hear: 'Coded emergency action messages (EAMs), "Skyking" broadcasts and calls to aircraft. Watchers note unusual bursts of messages.',
    when: '11175 by day, 4724 at night (North American time); 8992 is used most',
    dayNight: { day: 11175, night: 4724, dayFromUtc: 12, dayToUtc: 24 },
    listenNear: [39, -95],
    kind: 'communication',
    sources: [
      { label: PRIYOM, url: 'https://priyom.org/military-stations/united-states/hfgcs' },
      { label: 'ab9il.net — HFGCS on internet SDRs', url: 'https://ab9il.net/aviation/hfgcs-internet-sdr.html' },
    ],
  },
  {
    id: 'shannon-volmet',
    name: 'Shannon VOLMET (aviation weather)',
    kHz: [3413, 5505, 8957, 13264],
    mode: 'usb',
    regions: 'global',
    hear: 'A continuous recorded broadcast of weather at major European airports, for aircraft over the Atlantic. Useful to check a receiver works.',
    when: '3413 at night only; the others around the clock',
    listenNear: [52.7, -8.9],
    kind: 'broadcast',
    sources: [{ label: 'RadioReference wiki — VOLMET', url: 'https://wiki.radioreference.com/index.php/VOLMET' }],
  },
  {
    id: 'nat-hf',
    name: 'North Atlantic oceanic air traffic (HF)',
    kHz: [8906, 8864, 8879, 8891],
    mode: 'usb',
    regions: 'global',
    hear: 'Position reports between transatlantic flights and oceanic controllers (Gander, Shanwick, New York, Santa Maria, Reykjavik): families NAT-A 8906, NAT-B 8864, NAT-C 8879, NAT-D 8891.',
    listenNear: [53, -20],
    kind: 'communication',
    sources: [
      { label: 'RadioReference wiki — MWARA', url: 'https://wiki.radioreference.com/index.php/MWARA' },
      { label: 'LiveATC — North Atlantic HF guidance (PDF)', url: 'https://www.liveatc.net/downloads/NAT-HF-Guidance.pdf' },
    ],
  },
  {
    id: 'maritime-distress',
    name: 'Maritime distress and calling (HF voice)',
    kHz: [2182, 4125, 6215, 8291, 12290, 16420],
    mode: 'usb',
    regions: 'global',
    hear: 'Ship distress, urgency and safety calls. Usually quiet. The US Coast Guard stopped listening on most of these in 2022.',
    listenNear: 'region',
    kind: 'communication',
    sources: [
      { label: '47 CFR 80.369 (US distress frequencies)', url: 'https://www.law.cornell.edu/cfr/text/47/80.369' },
      { label: 'US Coast Guard NAVCEN — HF voice', url: 'https://navcen.uscg.gov/simplex' },
    ],
  },
  {
    id: 'uvb-76',
    name: 'UVB-76 "The Buzzer" (Russian military)',
    kHz: [4625],
    mode: 'usb',
    regions: ['eastern-europe'],
    hear: 'A continuous buzz, broken now and then by voice messages in Russian. Changes in its activity get noticed and discussed.',
    listenNear: [56, 37],
    kind: 'communication',
    sources: [{ label: PRIYOM, url: 'https://priyom.org/military-stations/russia/the-buzzer' }],
  },
  {
    id: 'the-pip',
    name: '"The Pip" (Russian military)',
    kHz: [5448, 3756],
    mode: 'usb',
    regions: ['eastern-europe'],
    hear: 'Short repeating pips, broken now and then by voice messages in Russian.',
    when: '5448 by day, 3756 at night (Moscow time)',
    dayNight: { day: 5448, night: 3756, dayFromUtc: 4, dayToUtc: 16 },
    listenNear: [56, 37],
    kind: 'communication',
    sources: [{ label: PRIYOM, url: 'https://priyom.org/military-stations/russia/the-pip' }],
  },
];

/** The frequency the sources suggest at this hour, when they give a day/night pair. */
export function suggestedNow(f: RadioFrequency, now: number): number | null {
  if (!f.dayNight) return null;
  const h = new Date(now).getUTCHours();
  const { day, night, dayFromUtc, dayToUtc } = f.dayNight;
  return h >= dayFromUtc && h < dayToUtc ? day : night;
}

/** The region's own entries first, then the global ones. */
export function frequenciesFor(regionId: string | null): RadioFrequency[] {
  const own = regionId === null ? [] : RADIO_FREQUENCIES.filter((f) => f.regions !== 'global' && f.regions.includes(regionId));
  return [...own, ...RADIO_FREQUENCIES.filter((f) => f.regions === 'global')];
}

/** Where to look for a receiver for this frequency when viewing a region (or the world). */
export function listenPoint(f: RadioFrequency, regionId: string | null): [number, number] {
  if (f.listenNear !== 'region') return f.listenNear;
  const r = regionId ? getRegion(regionId) : undefined;
  if (!r?.bbox) return [50, 5];
  const [w, s, e, n] = r.bbox;
  return [(s + n) / 2, (w + e) / 2];
}

export const RADIO_LEGAL_NOTE =
  'Listening rules differ by country. In the UK (Wireless Telegraphy Act 2006 s.48) and several other countries it is an offence to listen to ' +
  'communications not meant for you, such as air traffic control, military or ship-to-shore traffic, or to pass on what you hear; broadcasts such as VOLMET are fine. ' +
  'WATCHTOWER only links to receivers run by others; it does not play, record or transcribe anything.';

// ------------------------------------------------------------------ nearest airport

export interface Airport {
  icao: string;
  lat: number;
  lon: number;
  /** ISO 3166-2 region, e.g. US-NY, GB-ENG. */
  region: string;
  name: string;
}

export function unpackAirports(packed: string): Airport[] {
  const out: Airport[] = [];
  for (const row of packed.split(';')) {
    const [icao, la, lo, region, name] = row.split('|');
    const lat = Number(la);
    const lon = Number(lo);
    if (!icao || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ icao, lat, lon, region: region ?? '', name: name ?? icao });
  }
  return out;
}

export function nearestAirport(airports: Airport[], lat: number, lon: number, maxKm: number): (Airport & { km: number }) | null {
  let best: (Airport & { km: number }) | null = null;
  for (const a of airports) {
    if (Math.abs(a.lat - lat) > maxKm / 100) continue; // cheap pre-filter (1° latitude ≈ 111 km)
    const km = distanceKm(lat, lon, a.lat, a.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { ...a, km };
  }
  return best;
}

/** The North Atlantic oceanic area, roughly: where HF, not VHF, carries air traffic control. */
export const inNorthAtlantic = (lat: number, lon: number) => lat >= 35 && lat <= 70 && lon >= -55 && lon <= -12;

export interface ListenLink {
  kind: 'atc' | 'scanner' | 'hf';
  label: string;
  url: string;
  note?: string;
}

/** How far to look for an airport whose tower or approach could be on LiveATC. */
export const ATC_RADIUS_KM = 200;
const SCANNER_RADIUS_KM = 120;

/**
 * Listening links for a located record: the nearest airport's LiveATC page for aircraft records, the
 * state's Broadcastify page for any record in the US, and North Atlantic HF for aircraft over the ocean.
 */
export function listenLinks(
  rec: { lat: number; lon: number; aviation: boolean },
  airports: Airport[],
  receivers: RadioReceiver[],
): ListenLink[] {
  const links: ListenLink[] = [];
  const near = nearestAirport(airports, rec.lat, rec.lon, Math.max(ATC_RADIUS_KM, SCANNER_RADIUS_KM));
  if (rec.aviation && near && near.km <= ATC_RADIUS_KM) {
    const uk = near.region.startsWith('GB-');
    links.push({
      kind: 'atc',
      label: `ATC near ${near.icao} ${near.name} (${Math.round(near.km)} km) — LiveATC`,
      url: liveAtcUrl(near.icao),
      note: uk
        ? 'No UK feeds: UK law does not allow ATC audio to be broadcast or listened to.'
        : 'LiveATC says on that page whether the airport is covered.',
    });
  }
  if (near && near.km <= SCANNER_RADIUS_KM && near.region.startsWith('US-')) {
    const st = broadcastifyState(near.region);
    if (st) links.push({ kind: 'scanner', label: `Scanner feeds — ${st.name} (Broadcastify)`, url: st.url, note: 'Police, fire, EMS and some aviation feeds; pick a county on that page.' });
  }
  if (rec.aviation && inNorthAtlantic(rec.lat, rec.lon) && !(near && near.km <= ATC_RADIUS_KM)) {
    const nat = RADIO_FREQUENCIES.find((f) => f.id === 'nat-hf')!;
    const rx = nearestReceivers(receivers, nat.listenNear[0] as number, nat.listenNear[1] as number, nat.kHz, 1)[0];
    links.push({
      kind: 'hf',
      label: `North Atlantic oceanic HF ${nat.kHz[0]} kHz — ${rx ? rx.name : TWENTE_WEBSDR.name}`,
      url: rx ? kiwiTuneUrl(rx, nat.kHz[0], nat.mode) : twenteTuneUrl(nat.kHz[0], nat.mode),
      note: 'Oceanic controllers and flights; other families: 8864, 8879, 8891 kHz.',
    });
  }
  return links;
}
