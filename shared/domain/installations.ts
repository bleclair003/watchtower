import type { IntelligenceEvent } from './types.ts';

/**
 * Military installations (map layer). US data: DoD MIRTA points (public/data/installations-us.json,
 * built by scripts/build-installations.ts). Coordinates come from the dataset only.
 */
export interface Installation {
  name: string;
  /** MIRTA siteReportingComponent code (usa, usn, usaf, usmc, armyNationalGuard, …). */
  component: string;
  /** MIRTA siteOperationalStatus code (act, semi, care, excs, clsd). */
  status: string;
  state: string;
  country: string;
  joint: boolean;
  lon: number;
  lat: number;
}

export interface InstallationDataset {
  source: string;
  sourceUrl: string;
  licence: string;
  dataCurrency: string;
  coverage: string;
  retrievedAt: string;
  count: number;
  installations: Installation[];
}

export type Branch = 'army' | 'navy' | 'air-force' | 'marines' | 'other';

export const COMPONENTS: Record<string, { label: string; branch: Branch }> = {
  usa: { label: 'U.S. Army', branch: 'army' },
  usar: { label: 'U.S. Army Reserve', branch: 'army' },
  armyNationalGuard: { label: 'Army National Guard', branch: 'army' },
  usn: { label: 'U.S. Navy', branch: 'navy' },
  usnr: { label: 'U.S. Navy Reserve', branch: 'navy' },
  usaf: { label: 'U.S. Air Force / Space Force', branch: 'air-force' },
  afr: { label: 'Air Force Reserve', branch: 'air-force' },
  airNationalGuard: { label: 'Air National Guard', branch: 'air-force' },
  usmc: { label: 'U.S. Marine Corps', branch: 'marines' },
  usmcr: { label: 'Marine Corps Reserve', branch: 'marines' },
  whs: { label: 'Washington Headquarters Services', branch: 'other' },
  other: { label: 'Other DoD', branch: 'other' },
};

export const componentOf = (code: string) => COMPONENTS[code] ?? { label: code, branch: 'other' as Branch };

export const STATUS_LABEL: Record<string, string> = {
  act: 'Active',
  semi: 'Semi-active',
  care: 'Caretaker',
  excs: 'Excess',
  clsd: 'Closed',
};

/** Installations renamed in 2023 and (most) restored in 2025: either name may appear in headlines. */
const RENAMES: [string, string][] = [
  ['Fort Bragg', 'Fort Liberty'],
  ['Fort Hood', 'Fort Cavazos'],
  ['Fort Benning', 'Fort Moore'],
  ['Fort Gordon', 'Fort Eisenhower'],
  ['Fort Lee', 'Fort Gregg-Adams'],
  ['Fort Polk', 'Fort Johnson'],
  ['Fort Rucker', 'Fort Novosel'],
  ['Fort A.P. Hill', 'Fort Walker'],
  ['Fort Pickett', 'Fort Barfoot'],
];

const TYPE_WORDS =
  /\b(Air Force Base|Air Reserve Base|Air National Guard Base|Air Guard Station|Space Force Base|Space Force Station|Naval Air Station|Naval Station|Naval Base|Naval Support Activity|Naval Air Facility|Naval Weapons Station|Marine Corps Base|Marine Corps Air Station|Marine Corps Logistics Base|Joint Base|Army Airfield|Air Station|AFB|ARB|SFB|NAS|MCAS|AAF)\b/g;
const GENERIC = new Set(
  'army navy air force reserve center centers readiness training area range armory national guard usarc station office research depot plant facility site activity support command field base joint naval marine corps space the of and at us u.s. dla ammunition test'.split(
    ' ',
  ),
);

/**
 * One-word short names that are also common words, first names or surnames (found while checking
 * real FAA data: "Clear" for Clear Space Force Station would match "it is not clear").
 */
const RISKY_SINGLE = new Set(
  'clear hill scott shaw moody robins dover travis pope peterson andrews luke patrick cannon vance tinker maxwell columbus wright eagle little grand mountain lake river island point harbor bay springs city falls park key western eastern northern southern central march hawaii meridian homestead cavalier arnold edwards hunter buckley fairchild grissom dobbins crane wheeler sheppard philadelphia albany newport charleston'.split(' '),
);

/** Names a headline might use for this installation: the full name, a short core name, and renames. */
export function installationAliases(name: string): string[] {
  const out = new Set<string>([name]);
  const core = name.replace(TYPE_WORDS, ' ').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
  const meaningful = core.split(' ').filter((w) => !GENERIC.has(w.toLowerCase()) && /[A-Za-z]/.test(w));
  const singleRisky = !core.includes(' ') && RISKY_SINGLE.has(core.toLowerCase());
  if (core && core !== name && meaningful.length > 0 && core.length >= 5 && !singleRisky) out.add(core);
  for (const [a, b] of RENAMES) {
    if (name.includes(a)) out.add(name.replace(a, b)).add(b);
    if (name.includes(b)) out.add(name.replace(b, a)).add(a);
  }
  return [...out].filter((a) => a.length >= 5);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface RelatedRecord {
  event: IntelligenceEvent;
  reason: string;
}

/**
 * Records related to an installation, newest first:
 *  - the title or summary names it (full name, short name or former/current name), or
 *  - an exact-location record lies within `radiusKm` of its point.
 * Each record states why it is listed.
 */
export function relatedRecords(inst: Installation, events: IntelligenceEvent[], radiusKm = 50): RelatedRecord[] {
  const aliases = installationAliases(inst.name);
  const bounded = (x: string) => `(?<![\\p{L}\\p{N}])${x}(?![\\p{L}\\p{N}])`;
  const patterns = aliases.map((a) => {
    const full = a === inst.name;
    const single = !a.includes(' ');
    // Full names: any case. One-word short names: Capitalised or ALL CAPS only. Longer short names: any case.
    const re = full || !single ? new RegExp(bounded(escape(a)), 'iu') : new RegExp(bounded(`(?:${escape(a)}|${escape(a.toUpperCase())})`), 'u');
    return { a, full, re };
  });
  const out: RelatedRecord[] = [];
  for (const e of events) {
    const text = `${e.title} ${e.summary ?? ''}`;
    // Short names ("Norfolk", "Grand Forks") are also towns elsewhere: count them only in US records.
    const usRecord = e.regionIds.includes('united-states') || e.countryCodes.includes('US');
    const hit = patterns.find((p) => (p.full || usRecord) && p.re.test(text));
    if (hit) {
      out.push({ event: e, reason: `names "${hit.a}"` });
      continue;
    }
    if ((e.locationPrecision === 'exact' || e.locationPrecision === 'city') && typeof e.latitude === 'number' && typeof e.longitude === 'number') {
      const d = distanceKm(inst.lat, inst.lon, e.latitude, e.longitude);
      if (d <= radiusKm) out.push({ event: e, reason: `${Math.round(d)} km away` });
    }
  }
  const t = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);
  return out.sort((a, b) => t(b.event) - t(a.event));
}
