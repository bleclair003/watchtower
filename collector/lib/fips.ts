/**
 * The State Department travel-advisory feed tags countries with FIPS 10-4
 * codes, NOT ISO 3166-1. Many differ in dangerous ways: "RS" is Russia in
 * FIPS but Serbia in ISO; "IS" is Israel in FIPS but Iceland in ISO.
 *
 * This table covers every tag observed in the live feed on 2026-11-20 and is
 * verified by collector/test/fips.test.ts against the feed's own country
 * names. Unknown tags are recorded but left unmapped (never guessed).
 */
export const FIPS_TO_ISO: Record<string, string> = {
  A1: 'BQ', A2: 'GF', AA: 'AW', AC: 'AG', AE: 'AE', AF: 'AF', AG: 'DZ', AJ: 'AZ', AL: 'AL', AM: 'AM',
  AN: 'AD', AO: 'AO', AR: 'AR', AS: 'AU', AU: 'AT', AV: 'AI', AY: 'AQ', BA: 'BH', BB: 'BB', BC: 'BW',
  BD: 'BM', BE: 'BE', BF: 'BS', BG: 'BD', BH: 'BZ', BK: 'BA', BL: 'BO', BM: 'MM', BN: 'BJ', BO: 'BY',
  BP: 'SB', BR: 'BR', BT: 'BT', BU: 'BG', BX: 'BN', BY: 'BI', CA: 'CA', CB: 'KH', CD: 'TD', CE: 'LK',
  CF: 'CG', CG: 'CD', CH: 'CN', CI: 'CL', CJ: 'KY', CM: 'CM', CN: 'KM', CO: 'CO', CS: 'CR', CT: 'CF',
  CU: 'CU', CV: 'CV', CY: 'CY', DA: 'DK', DJ: 'DJ', DO: 'DM', DR: 'DO', EC: 'EC', EG: 'EG', EI: 'IE',
  EK: 'GQ', EN: 'EE', ER: 'ER', ES: 'SV', ET: 'ET', EZ: 'CZ', FI: 'FI', FJ: 'FJ', FM: 'FM', FP: 'PF',
  FR: 'FR', GA: 'GM', GB: 'GA', GG: 'GE', GH: 'GH', GJ: 'GD', GL: 'GL', GM: 'DE', GP: 'GP', GR: 'GR',
  GT: 'GT', GV: 'GN', GW: 'GW', GY: 'GY', HA: 'HT', HK: 'HK', HO: 'HN', HR: 'HR', HU: 'HU', IC: 'IS',
  ID: 'ID', IN: 'IN', IR: 'IR', IS: 'IL', IT: 'IT', IV: 'CI', IZ: 'IQ', JA: 'JP', JM: 'JM', JO: 'JO',
  KE: 'KE', KG: 'KG', KN: 'KP', KR: 'KI', KS: 'KR', KU: 'KW', KV: 'XK', KZ: 'KZ', LA: 'LA', LE: 'LB',
  LG: 'LV', LH: 'LT', LI: 'LR', LO: 'SK', LS: 'LI', LT: 'LS', LU: 'LU', LY: 'LY', MA: 'MG', MC: 'MO',
  MD: 'MD', MF: 'MF', MG: 'MN', MH: 'MS', MI: 'MW', MJ: 'ME', MK: 'MK', ML: 'ML', MO: 'MA', MP: 'MU',
  MQ: 'MQ', MR: 'MR', MT: 'MT', MU: 'OM', MV: 'MV', MX: 'MX', MY: 'MY', MZ: 'MZ', NC: 'NC', NG: 'NE',
  NH: 'VU', NI: 'NG', NL: 'NL', NN: 'SX', NO: 'NO', NP: 'NP', NR: 'NR', NS: 'SR', NT: 'BL', NU: 'NI',
  NZ: 'NZ', OD: 'SS', PA: 'PY', PE: 'PE', PK: 'PK', PL: 'PL', PM: 'PA', PO: 'PT', PP: 'PG', PS: 'PW',
  QA: 'QA', RI: 'RS', RM: 'MH', RO: 'RO', RP: 'PH', RS: 'RU', RW: 'RW', SA: 'SA', SC: 'KN', SE: 'SC',
  SF: 'ZA', SG: 'SN', SI: 'SI', SL: 'SL', SN: 'SG', SO: 'SO', SP: 'ES', SR: 'CH', ST: 'LC', SU: 'SD',
  SW: 'SE', SY: 'SY', TD: 'TT', TH: 'TH', TI: 'TJ', TK: 'TC', TN: 'TO', TO: 'TG', TP: 'ST', TS: 'TN',
  TT: 'TL', TU: 'TR', TV: 'TV', TW: 'TW', TX: 'TM', TZ: 'TZ', UC: 'CW', UG: 'UG', UK: 'GB', UP: 'UA',
  UV: 'BF', UY: 'UY', UZ: 'UZ', VC: 'VC', VE: 'VE', VI: 'VG', VM: 'VN', WA: 'NA', WS: 'WS', WZ: 'SZ',
  YM: 'YE', ZA: 'ZM', ZI: 'ZW',
};

/**
 * Advisory-name overrides where the feed's tag is shared by several
 * jurisdictions (Gaza and the West Bank are both tagged "IS").
 */
const NAME_OVERRIDES: Record<string, string> = {
  gaza: 'PS',
  'the west bank': 'PS',
  'west bank': 'PS',
  tonga: 'TO',
};

/** Resolves an advisory to ISO alpha-2, preferring explicit name overrides. Returns null if unknown. */
export function advisoryToIso(fipsTag: string | undefined, countryName: string): string | null {
  const override = NAME_OVERRIDES[countryName.trim().toLowerCase()];
  if (override) return override;
  if (!fipsTag) return null;
  return FIPS_TO_ISO[fipsTag.trim().toUpperCase()] ?? null;
}
