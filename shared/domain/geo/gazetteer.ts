/**
 * Text gazetteer: finds explicit mentions of countries and watch areas in a headline.
 *
 * What this is: a transparent, auditable lookup of names, a few unambiguous demonyms,
 * capitals and major cities, and a short list of armed groups that operate from one
 * territory. Every match reports the exact term that produced it.
 *
 * What this is not: geolocation. A headline that mentions a country is about that
 * country in some way, but the event may have happened elsewhere. Records tagged this
 * way carry `locationPrecision: 'country'` or `'region'`, NEVER coordinates, plus
 * `metadata.geoBasis = 'text-mention'` and `metadata.geoTerms`.
 *
 * Deliberately excluded because they are ambiguous in English news text:
 * bare "Georgia" (U.S. state), bare "Congo" (two countries), bare "Korea",
 * "Jerusalem" (status contested), "Aden" (usually "Gulf of Aden"), "American"
 * and "Washington" (U.S. state / generic), "Guinea" inside longer names (handled by
 * longest-match-first).
 */

interface Term {
  term: string;
  /** Match case exactly (abbreviations such as "US", "UK", "UAE"). */
  exact?: boolean;
}

type Entry = [iso: string, terms: (string | Term)[]];

const X = (term: string): Term => ({ term, exact: true });

/** ISO 3166-1 alpha-2 → terms. Sovereign states plus Kosovo, Palestine, Taiwan, Hong Kong, Macao, Western Sahara. */
const COUNTRY_TERMS: Entry[] = [
  ['AF', ['Afghanistan', 'Afghan', 'Kabul', 'Taliban']],
  ['AL', ['Albania', 'Albanian', 'Tirana']],
  ['DZ', ['Algeria', 'Algerian', 'Algiers']],
  ['AD', ['Andorra']],
  ['AO', ['Angola', 'Angolan', 'Luanda']],
  ['AG', ['Antigua and Barbuda', 'Antigua']],
  ['AR', ['Argentina', 'Argentine', 'Argentinian', 'Buenos Aires']],
  ['AM', ['Armenia', 'Armenian', 'Yerevan']],
  ['AU', ['Australia', 'Australian', 'Canberra']],
  ['AT', ['Austria', 'Austrian', 'Vienna']],
  ['AZ', ['Azerbaijan', 'Azerbaijani', 'Baku']],
  ['BS', ['Bahamas']],
  ['BH', ['Bahrain', 'Bahraini', 'Manama']],
  ['BD', ['Bangladesh', 'Bangladeshi', 'Dhaka']],
  ['BB', ['Barbados']],
  ['BY', ['Belarus', 'Belarusian', 'Minsk', 'Lukashenko']],
  ['BE', ['Belgium', 'Belgian', 'Brussels']],
  ['BZ', ['Belize']],
  ['BJ', ['Benin']],
  ['BT', ['Bhutan']],
  ['BO', ['Bolivia', 'Bolivian']],
  ['BA', ['Bosnia and Herzegovina', 'Bosnia', 'Bosnian', 'Sarajevo']],
  ['BW', ['Botswana']],
  ['BR', ['Brazil', 'Brazilian', 'Brasilia']],
  ['BN', ['Brunei']],
  ['BG', ['Bulgaria', 'Bulgarian']],
  ['BF', ['Burkina Faso', 'Ouagadougou']],
  ['BI', ['Burundi']],
  ['CV', ['Cabo Verde', 'Cape Verde']],
  ['KH', ['Cambodia', 'Cambodian', 'Phnom Penh']],
  ['CM', ['Cameroon', 'Cameroonian']],
  ['CA', ['Canada', 'Canadian', 'Ottawa']],
  ['CF', ['Central African Republic']],
  ['TD', ['Chad', 'Chadian', "N'Djamena"]],
  ['CL', ['Chile', 'Chilean']],
  ['CN', ['China', 'Chinese', 'Beijing', "People's Republic of China", X('PLA'), 'Xi Jinping', X('Xi')]],
  ['CO', ['Colombia', 'Colombian', 'Bogota']],
  ['KM', ['Comoros']],
  ['CD', ['Democratic Republic of the Congo', 'Democratic Republic of Congo', 'DR Congo', X('DRC'), 'Kinshasa', 'Goma']],
  ['CG', ['Republic of the Congo', 'Congo-Brazzaville', 'Brazzaville']],
  ['CR', ['Costa Rica']],
  ['CI', ["Côte d'Ivoire", 'Côte d’Ivoire', 'Ivory Coast', 'Ivorian']],
  ['HR', ['Croatia', 'Croatian', 'Zagreb']],
  ['CU', ['Cuba', 'Cuban', 'Havana']],
  ['CY', ['Cyprus', 'Cypriot', 'Nicosia']],
  ['CZ', ['Czechia', 'Czech Republic', 'Czech', 'Prague']],
  ['DK', ['Denmark', 'Danish', 'Copenhagen']],
  ['DJ', ['Djibouti', 'Djiboutian']],
  ['DM', ['Dominica']],
  ['DO', ['Dominican Republic', 'Santo Domingo']],
  ['EC', ['Ecuador', 'Ecuadorean', 'Ecuadorian', 'Quito']],
  ['EG', ['Egypt', 'Egyptian', 'Cairo']],
  ['SV', ['El Salvador', 'Salvadoran']],
  ['GQ', ['Equatorial Guinea']],
  ['ER', ['Eritrea', 'Eritrean', 'Asmara']],
  ['EE', ['Estonia', 'Estonian', 'Tallinn']],
  ['SZ', ['Eswatini', 'Swaziland']],
  ['ET', ['Ethiopia', 'Ethiopian', 'Addis Ababa']],
  ['FJ', ['Fiji', 'Fijian']],
  ['FI', ['Finland', 'Finnish', 'Helsinki']],
  ['FR', ['France', 'French', 'Paris', 'Macron']],
  ['GA', ['Gabon', 'Gabonese']],
  ['GM', ['Gambia', 'Gambian']],
  ['GE', ['Georgian', 'Tbilisi']],
  ['DE', ['Germany', 'German', 'Berlin']],
  ['GH', ['Ghana', 'Ghanaian', 'Accra']],
  ['GR', ['Greece', 'Greek', 'Athens']],
  ['GD', ['Grenada']],
  ['GT', ['Guatemala', 'Guatemalan']],
  ['GN', ['Guinea', 'Conakry']],
  ['GW', ['Guinea-Bissau', 'Guinea Bissau']],
  ['GY', ['Guyana', 'Guyanese']],
  ['HT', ['Haiti', 'Haitian', 'Port-au-Prince']],
  ['HN', ['Honduras', 'Honduran']],
  ['HK', ['Hong Kong']],
  ['HU', ['Hungary', 'Hungarian', 'Budapest', 'Orban', 'Orbán']],
  ['IS', ['Iceland', 'Icelandic', 'Reykjavik']],
  ['IN', ['India', 'Indian', 'New Delhi', 'Delhi', 'Modi']],
  ['ID', ['Indonesia', 'Indonesian', 'Jakarta']],
  ['IR', ['Iran', 'Iranian', 'Tehran', 'IRGC']],
  ['IQ', ['Iraq', 'Iraqi', 'Baghdad', 'Erbil', 'Mosul', 'Basra']],
  ['IE', ['Ireland', 'Irish', 'Dublin']],
  ['IL', ['Israel', 'Israeli', 'Tel Aviv', X('IDF'), 'Netanyahu']],
  ['IT', ['Italy', 'Italian', 'Rome']],
  ['JM', ['Jamaica', 'Jamaican']],
  ['JP', ['Japan', 'Japanese', 'Tokyo', 'Okinawa']],
  ['JO', ['Jordan', 'Jordanian', 'Amman']],
  ['KZ', ['Kazakhstan', 'Kazakh', 'Astana']],
  ['KE', ['Kenya', 'Kenyan', 'Nairobi']],
  ['KI', ['Kiribati']],
  ['XK', ['Kosovo', 'Pristina']],
  ['KW', ['Kuwait', 'Kuwaiti']],
  ['KG', ['Kyrgyzstan', 'Kyrgyz', 'Bishkek']],
  ['LA', ['Laos', 'Lao', 'Vientiane']],
  ['LV', ['Latvia', 'Latvian', 'Riga']],
  ['LB', ['Lebanon', 'Lebanese', 'Beirut', 'Hezbollah', 'Hizbollah']],
  ['LS', ['Lesotho']],
  ['LR', ['Liberia', 'Liberian', 'Monrovia']],
  ['LY', ['Libya', 'Libyan', 'Tripoli', 'Benghazi']],
  ['LI', ['Liechtenstein']],
  ['LT', ['Lithuania', 'Lithuanian', 'Vilnius']],
  ['LU', ['Luxembourg']],
  ['MO', ['Macao', 'Macau']],
  ['MG', ['Madagascar', 'Malagasy']],
  ['MW', ['Malawi', 'Malawian']],
  ['MY', ['Malaysia', 'Malaysian', 'Kuala Lumpur']],
  ['MV', ['Maldives', 'Maldivian']],
  ['ML', ['Mali', 'Malian', 'Bamako']],
  ['MT', ['Malta', 'Maltese']],
  ['MH', ['Marshall Islands']],
  ['MR', ['Mauritania', 'Mauritanian']],
  ['MU', ['Mauritius', 'Mauritian']],
  ['MX', ['Mexico', 'Mexican']],
  ['FM', ['Micronesia']],
  ['MD', ['Moldova', 'Moldovan', 'Chisinau', 'Transnistria']],
  ['MC', ['Monaco']],
  ['MN', ['Mongolia', 'Mongolian', 'Ulaanbaatar']],
  ['ME', ['Montenegro', 'Montenegrin']],
  ['MA', ['Morocco', 'Moroccan', 'Rabat']],
  ['MZ', ['Mozambique', 'Mozambican']],
  ['MM', ['Myanmar', 'Burma', 'Burmese', 'Naypyidaw', 'Yangon']],
  ['NA', ['Namibia', 'Namibian']],
  ['NR', ['Nauru']],
  ['NP', ['Nepal', 'Nepalese', 'Nepali', 'Kathmandu']],
  ['NL', ['Netherlands', 'Dutch', 'Amsterdam', 'The Hague']],
  ['NZ', ['New Zealand']],
  ['NI', ['Nicaragua', 'Nicaraguan']],
  ['NE', ['Niger', 'Nigerien', 'Niamey']],
  ['NG', ['Nigeria', 'Nigerian', 'Abuja', 'Lagos']],
  ['KP', ['North Korea', 'North Korean', 'DPRK', 'Pyongyang', 'Kim Jong Un']],
  ['MK', ['North Macedonia', 'Skopje']],
  ['NO', ['Norway', 'Norwegian', 'Oslo']],
  ['OM', ['Oman', 'Omani', 'Muscat']],
  ['PK', ['Pakistan', 'Pakistani', 'Islamabad', 'Karachi', 'Lahore']],
  ['PW', ['Palau']],
  ['PS', ['Palestine', 'Palestinian', 'Palestinians', 'Gaza', 'West Bank', 'Hamas', 'Ramallah']],
  ['PA', ['Panama', 'Panamanian']],
  ['PG', ['Papua New Guinea']],
  ['PY', ['Paraguay', 'Paraguayan']],
  ['PE', ['Peru', 'Peruvian', 'Lima']],
  ['PH', ['Philippines', 'Philippine', 'Filipino', 'Manila']],
  ['PL', ['Poland', 'Polish', 'Warsaw']],
  ['PT', ['Portugal', 'Portuguese', 'Lisbon']],
  ['QA', ['Qatar', 'Qatari', 'Doha']],
  ['RO', ['Romania', 'Romanian', 'Bucharest']],
  ['RU', ['Russia', 'Russian', 'Russians', 'Moscow', 'Kremlin', 'Putin']],
  ['RW', ['Rwanda', 'Rwandan', 'Kigali']],
  ['KN', ['Saint Kitts and Nevis']],
  ['LC', ['Saint Lucia']],
  ['VC', ['Saint Vincent and the Grenadines']],
  ['WS', ['Samoa', 'Samoan']],
  ['SM', ['San Marino']],
  ['ST', ['Sao Tome and Principe', 'São Tomé and Príncipe']],
  ['SA', ['Saudi Arabia', 'Saudi', 'Riyadh']],
  ['SN', ['Senegal', 'Senegalese', 'Dakar']],
  ['RS', ['Serbia', 'Serbian', 'Belgrade']],
  ['SC', ['Seychelles']],
  ['SL', ['Sierra Leone']],
  ['SG', ['Singapore', 'Singaporean']],
  ['SK', ['Slovakia', 'Slovak', 'Bratislava']],
  ['SI', ['Slovenia', 'Slovenian', 'Ljubljana']],
  ['SB', ['Solomon Islands']],
  ['SO', ['Somalia', 'Somali', 'Mogadishu', 'Somaliland', 'al-Shabaab', 'Al-Shabab']],
  ['ZA', ['South Africa', 'South African', 'Pretoria', 'Johannesburg']],
  ['KR', ['South Korea', 'South Korean', 'Seoul']],
  ['SS', ['South Sudan', 'South Sudanese', 'Juba']],
  ['ES', ['Spain', 'Spanish', 'Madrid']],
  ['LK', ['Sri Lanka', 'Sri Lankan', 'Colombo']],
  ['SD', ['Sudan', 'Sudanese', 'Khartoum', 'Darfur', 'El Fasher']],
  ['SR', ['Suriname']],
  ['SE', ['Sweden', 'Swedish', 'Stockholm']],
  ['CH', ['Switzerland', 'Swiss', 'Geneva', 'Bern']],
  ['SY', ['Syria', 'Syrian', 'Damascus', 'Aleppo', 'Idlib']],
  ['TW', ['Taiwan', 'Taiwanese', 'Taipei']],
  ['TJ', ['Tajikistan', 'Tajik', 'Dushanbe']],
  ['TZ', ['Tanzania', 'Tanzanian', 'Dodoma', 'Dar es Salaam']],
  ['TH', ['Thailand', 'Thai', 'Bangkok']],
  ['TL', ['Timor-Leste', 'East Timor']],
  ['TG', ['Togo', 'Togolese']],
  ['TO', ['Tonga', 'Tongan']],
  ['TT', ['Trinidad and Tobago', 'Trinidad']],
  ['TN', ['Tunisia', 'Tunisian', 'Tunis']],
  ['TR', ['Türkiye', 'Turkiye', 'Turkey', 'Turkish', 'Ankara', 'Istanbul', 'Erdogan', 'Erdoğan']],
  ['TM', ['Turkmenistan']],
  ['TV', ['Tuvalu']],
  ['UG', ['Uganda', 'Ugandan', 'Kampala']],
  [
    'UA',
    ['Ukraine', 'Ukrainian', 'Ukrainians', 'Kyiv', 'Kiev', 'Kharkiv', 'Odesa', 'Odessa', 'Kherson', 'Zaporizhzhia', 'Donetsk', 'Luhansk', 'Donbas', 'Crimea', 'Zelensky', 'Zelenskyy'],
  ],
  ['AE', ['United Arab Emirates', X('UAE'), 'Emirati', 'Abu Dhabi', 'Dubai']],
  ['GB', ['United Kingdom', X('UK'), X('U.K.'), 'Britain', 'British', 'London']],
  ['US', ['United States', X('US'), X('U.S.'), X('USA'), 'Pentagon', 'White House']],
  ['UY', ['Uruguay', 'Uruguayan']],
  ['UZ', ['Uzbekistan', 'Uzbek', 'Tashkent']],
  ['VU', ['Vanuatu']],
  ['VA', ['Vatican', 'Holy See']],
  ['VE', ['Venezuela', 'Venezuelan', 'Caracas']],
  ['VN', ['Vietnam', 'Viet Nam', 'Vietnamese', 'Hanoi']],
  ['EH', ['Western Sahara']],
  ['YE', ['Yemen', 'Yemeni', 'Sanaa', "Sana'a", 'Houthi', 'Houthis']],
  ['ZM', ['Zambia', 'Zambian', 'Lusaka']],
  ['ZW', ['Zimbabwe', 'Zimbabwean', 'Harare']],
];

/**
 * Major US bases abroad → host country. A headline about "Kadena" is about Japan, not the US
 * homeland (found on live data: "Kadena welcomes first … F-15EX" was counted as domestic).
 */
const US_BASES_ABROAD: Entry[] = [
  ['JP', ['Kadena', 'Yokosuka', 'Yokota', 'Misawa', 'Iwakuni', 'Sasebo', 'Camp Schwab', 'Futenma']],
  ['KR', ['Osan', 'Camp Humphreys', 'Kunsan']],
  ['DE', ['Ramstein', 'Grafenwoehr', 'Spangdahlem', 'Landstuhl']],
  ['IT', ['Aviano', 'Sigonella', 'Vicenza']],
  ['GB', ['Lakenheath', 'Mildenhall', 'Fairford']],
  ['ES', ['Naval Station Rota', 'Morón Air Base']],
  ['TR', ['Incirlik']],
  ['QA', ['Al Udeid']],
  ['KW', ['Camp Arifjan', 'Ali Al Salem']],
  ['BH', ['NSA Bahrain', 'Fifth Fleet headquarters']],
  ['DJ', ['Camp Lemonnier']],
  ['GR', ['Souda Bay']],
  ['IQ', ['Al Asad', 'Ain al-Asad']],
  ['SY', ['Al-Tanf', 'Al Tanf']],
  ['GL', ['Pituffik', 'Thule Air Base']],
  ['CU', ['Guantanamo', 'Guantánamo']],
  ['AF', ['Bagram', 'Sangin']],
  ['PL', ['Redzikowo', 'Camp Kosciuszko']],
  ['RO', ['Deveselu', 'Mihail Kogalniceanu']],
];

/** Named seas, straits and areas that identify a watch region without naming a country. */
const AREA_TERMS: [regionId: string, terms: string[]][] = [
  ['red-sea', ['Red Sea', 'Gulf of Aden', 'Bab el-Mandeb', 'Bab al-Mandab', 'Horn of Africa']],
  ['taiwan-strait', ['Taiwan Strait']],
  ['south-china-sea', ['South China Sea', 'Spratly', 'Spratlys', 'Paracel', 'Paracels', 'Scarborough Shoal', 'Second Thomas Shoal']],
  ['korean-peninsula', ['Korean Peninsula', 'Yellow Sea', 'DMZ']],
  ['middle-east', ['Strait of Hormuz', 'Persian Gulf', 'Golan Heights', 'Golan']],
  ['eastern-europe', ['Black Sea', 'Baltic states', 'Suwalki Gap']],
];

export interface GazetteerMatch {
  countryCodes: string[];
  /** Watch regions named directly by an area term (country-derived regions are added by the caller). */
  areaRegionIds: string[];
  /** Exact source terms that produced each match, in order of appearance. */
  terms: string[];
}

interface Compiled {
  re: RegExp;
  kind: 'country' | 'area';
  code: string;
  term: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Letters/digits on either side mean we are inside a longer word ("Niger" in "Nigeria").
const wrap = (s: string) => `(?<![\\p{L}\\p{N}])${escape(s).replace(/['’]/g, "['’]")}(?:'s|’s)?(?![\\p{L}\\p{N}])`;

const COMPILED: Compiled[] = [
  ...[...COUNTRY_TERMS, ...US_BASES_ABROAD].flatMap(([code, terms]) =>
    terms.map((t) => {
      const term = typeof t === 'string' ? t : t.term;
      const exact = typeof t !== 'string' && t.exact;
      return { re: new RegExp(wrap(term), exact ? 'gu' : 'giu'), kind: 'country' as const, code, term };
    }),
  ),
  ...AREA_TERMS.flatMap(([code, terms]) => terms.map((term) => ({ re: new RegExp(wrap(term), 'giu'), kind: 'area' as const, code, term }))),
  // Longest terms first, so "Papua New Guinea" is consumed before "Guinea", "South Sudan" before "Sudan".
].sort((a, b) => b.term.length - a.term.length);

/** All countries / areas explicitly mentioned in `text`. Pure and deterministic. */
export function matchGazetteer(text: string): GazetteerMatch {
  const taken: [number, number][] = [];
  const hits: { at: number; kind: 'country' | 'area'; code: string; term: string }[] = [];
  for (const c of COMPILED) {
    c.re.lastIndex = 0;
    for (const m of text.matchAll(c.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ at: start, kind: c.kind, code: c.code, term: m[0] });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    countryCodes: uniq(hits.filter((h) => h.kind === 'country').map((h) => h.code)),
    areaRegionIds: uniq(hits.filter((h) => h.kind === 'area').map((h) => h.code)),
    terms: uniq(hits.map((h) => h.term)),
  };
}

/** Exact country-name lookup (for feeds whose title IS a country name, such as UK FCDO travel advice). */
export function countryByName(name: string): string | null {
  const n = name.trim().toLowerCase();
  for (const [code, terms] of COUNTRY_TERMS) {
    if (terms.some((t) => (typeof t === 'string' ? t : t.term).toLowerCase() === n)) return code;
  }
  return null;
}
