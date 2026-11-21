/**
 * Sanctions lists (Phase 13, item 4): US OFAC SDN, EU consolidated list, UK Sanctions List.
 *
 * WATCHTOWER compares each list with its previous copy and records NEW designations, grouped
 * by list, day and target country. The target country comes from the sanctions programme or
 * regime (e.g. OFAC RUSSIA-EO14024 → RU); thematic programmes (counter-terrorism, cyber,
 * human rights) use the designees' addresses or nationality instead.
 */
import { countryByName } from './geo/gazetteer.ts';

export type SanctionsListId = 'ofac' | 'eu' | 'uk';

export interface SanctionsListDef {
  id: SanctionsListId;
  sourceId: string;
  short: string;
  name: string;
  page: string;
}

export const SANCTIONS_LISTS: Record<SanctionsListId, SanctionsListDef> = {
  ofac: { id: 'ofac', sourceId: 'ofac-sdn', short: 'OFAC', name: 'US Treasury OFAC SDN list', page: 'https://ofac.treasury.gov/recent-actions' },
  eu: { id: 'eu', sourceId: 'eu-sanctions', short: 'EU', name: 'EU consolidated financial sanctions list', page: 'https://www.sanctionsmap.eu/' },
  uk: { id: 'uk', sourceId: 'uk-sanctions', short: 'UK', name: 'UK Sanctions List', page: 'https://www.gov.uk/government/publications/the-uk-sanctions-list' },
};
export const SANCTIONS_SOURCE_IDS = Object.values(SANCTIONS_LISTS).map((l) => l.sourceId);

export type DesigneeKind = 'individual' | 'entity' | 'vessel' | 'aircraft';

/** One listed person, entity, vessel or aircraft, reduced to what WATCHTOWER uses. */
export interface Designee {
  id: string;
  name: string;
  kind: DesigneeKind;
  programs: string[];
  /** ISO alpha-2 from addresses, nationality, citizenship (not vessel flags: flags of convenience). */
  countries: string[];
  /** Designation date where the list gives one (EU, UK), YYYY-MM-DD. */
  designatedOn: string | null;
  imo: string | null;
  mmsi: string | null;
}

/** OFAC programme prefixes → target country. Thematic programmes are absent on purpose. */
const OFAC_PROGRAM_COUNTRY: [RegExp, string][] = [
  [/^(RUSSIA|UKRAINE|CAATSA - RUSSIA|PEESA)/, 'RU'],
  [/^(IRAN|IFSR|IRGC|HRIT-IR|IFCA|CAATSA - IRAN)/, 'IR'],
  [/^DPRK/, 'KP'],
  [/^SYRIA/, 'SY'],
  [/^BELARUS/, 'BY'],
  [/^VENEZUELA/, 'VE'],
  [/^CUBA/, 'CU'],
  [/^BURMA/, 'MM'],
  [/^LEBANON/, 'LB'],
  [/^YEMEN/, 'YE'],
  [/^IRAQ/, 'IQ'],
  [/^SOMALIA/, 'SO'],
  [/^(SUDAN|DARFUR)/, 'SD'],
  [/^SOUTH SUDAN/, 'SS'],
  [/^LIBYA/, 'LY'],
  [/^NICARAGUA/, 'NI'],
  [/^(DRCONGO)/, 'CD'],
  [/^CAR$/, 'CF'],
  [/^BALKANS/, 'RS'],
  [/^MALI/, 'ML'],
];

/** EU programme codes → target country. */
const EU_PROGRAMME_COUNTRY: Record<string, string> = {
  UKR: 'RU', RUS: 'RU', RUSDA: 'RU', BLR: 'BY', IRN: 'IR', SYR: 'SY', PRK: 'KP', YEM: 'YE', IRQ: 'IQ', LBY: 'LY', SOM: 'SO', MDA: 'MD',
  HAM: 'PS', VEN: 'VE', MMR: 'MM', AFG: 'AF', COD: 'CD', CAF: 'CF', SDN: 'SD', SSD: 'SS', NIC: 'NI', HTI: 'HT', LBN: 'LB', TUN: 'TN', GIN: 'GN', GNB: 'GW', MLI: 'ML', NER: 'NE', ZWE: 'ZW', BDI: 'BI', GTM: 'GT',
};

/** UK regime name fragments → target country. */
const UK_REGIME_COUNTRY: [RegExp, string][] = [
  [/\bRussia\b/, 'RU'], [/\bIran\b/, 'IR'], [/\bSyria\b/, 'SY'], [/Democratic People's Republic of Korea/, 'KP'], [/\bBelarus\b/, 'BY'],
  [/\bYemen\b/, 'YE'], [/\bIraq\b/, 'IQ'], [/\bLibya\b/, 'LY'], [/\bSomalia\b/, 'SO'], [/\bSouth Sudan\b/, 'SS'], [/\bSudan\b/, 'SD'],
  [/\bVenezuela\b/, 'VE'], [/\bMyanmar\b/, 'MM'], [/\bAfghanistan\b/, 'AF'], [/\bNicaragua\b/, 'NI'], [/Democratic Republic of the Congo/, 'CD'],
  [/Central African Republic/, 'CF'], [/\bHaiti\b/, 'HT'], [/\bMali\b/, 'ML'], [/Guinea-Bissau/, 'GW'], [/\bGuinea\b/, 'GN'], [/\bBosnia\b/, 'BA'],
];

/** Program/regime → target country, or null for thematic programmes. */
export function programCountry(list: SanctionsListId, program: string): string | null {
  if (list === 'ofac') return OFAC_PROGRAM_COUNTRY.find(([re]) => re.test(program))?.[1] ?? null;
  if (list === 'eu') return EU_PROGRAMME_COUNTRY[program] ?? null;
  return UK_REGIME_COUNTRY.find(([re]) => re.test(program))?.[1] ?? null;
}

const NAME_FIXES: Record<string, string> = {
  'korea, north': 'KP', 'korea, south': 'KR', palestinian: 'PS', 'west bank': 'PS', gaza: 'PS', 'north gaza': 'PS', 'northern gaza': 'PS',
  crimea: 'UA', 'bahamas, the': 'BS', 'the gambia': 'GM', 'congo, democratic republic of the': 'CD', 'congo, republic of the': 'CG',
  'cote d ivoire': 'CI', 'man, isle of': 'IM', 'virgin islands, british': 'VG', 'north macedonia, the republic of': 'MK', burma: 'MM',
  "democratic people's republic of korea": 'KP', 'occupied palestinian territories': 'PS', 'palestinian territories': 'PS',
};

/** Country name as written in a sanctions list → ISO alpha-2, or null. */
export function sanctionsCountry(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.replace(/^Region:\s*/i, '').trim();
  if (!n) return null;
  return NAME_FIXES[n.toLowerCase()] ?? countryByName(n);
}

/**
 * Target country of a designee: the programme's country when it has one, else the most
 * common country among its addresses and nationality. Null when neither says.
 */
export function targetCountry(list: SanctionsListId, d: Pick<Designee, 'programs' | 'countries'>): { country: string | null; basis: 'programme' | 'address' | 'none' } {
  for (const p of d.programs) {
    const c = programCountry(list, p);
    if (c) return { country: c, basis: 'programme' };
  }
  return d.countries[0] ? { country: d.countries[0], basis: 'address' } : { country: null, basis: 'none' };
}

export const KIND_LABEL: Record<DesigneeKind, [string, string]> = {
  individual: ['individual', 'individuals'],
  entity: ['entity', 'entities'],
  vessel: ['vessel', 'vessels'],
  aircraft: ['aircraft', 'aircraft'],
};

/** A sanctioned vessel with identifiers (for matching ship positions later). */
export interface SanctionedVessel {
  name: string;
  imo: string | null;
  mmsi: string | null;
  list: SanctionsListId;
  programs: string[];
}
