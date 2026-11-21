/**
 * US place names for deciding whether a headline is about something INSIDE the United States.
 *
 * "US" alone is not enough: most headlines that say "US" are about US actions abroad
 * ("US strikes island"). A headline counts as domestic when it names a state, a major city or a
 * military installation. Every match reports the term, and the state it implies.
 *
 * Excluded as ambiguous in news text: "Mobile", "Reading", "Independence", "Austin" and "Charlotte"
 * (people), "Norfolk" and "Richmond" (also English places), and bases that share a surname or word
 * ("Vance", "Tinker", "Maxwell", "Fallon") unless written with "Air Force Base" or similar. Bare "Washington" is kept and means the
 * federal government in DC (the usual sense in headlines); "Washington state" maps to WA.
 * "Georgia" means the US state here; the country gazetteer already ignores bare "Georgia".
 */

const STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington state'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['DC', 'District of Columbia'], ['PR', 'Puerto Rico'],
  ['GU', 'Guam'],
];

/** Cities and federal places → state. */
const CITIES: [string, string[]][] = [
  ['DC', ['Washington', 'Washington DC', 'Washington, DC', 'Capitol Hill', 'White House', 'Pentagon', 'Arlington']],
  ['NY', ['New York City', 'NYC', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Rikers', 'Buffalo', 'Albany']],
  ['CA', ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Oakland', 'Palisades', 'Anaheim']],
  ['IL', ['Chicago']], ['TX', ['Houston', 'Dallas', 'San Antonio', 'El Paso', 'Fort Worth', 'Brownsville']],
  ['AZ', ['Phoenix', 'Tucson']], ['PA', ['Philadelphia', 'Pittsburgh']], ['FL', ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Palm Beach', 'Mar-a-Lago', 'Key West']],
  ['GA', ['Atlanta', 'Savannah']], ['MA', ['Boston']], ['WA', ['Seattle', 'Tacoma', 'Spokane']], ['OR', ['Portland']],
  ['CO', ['Denver', 'Colorado Springs']], ['NV', ['Las Vegas', 'Reno']], ['MI', ['Detroit']], ['MN', ['Minneapolis', 'St Paul']],
  ['MO', ['St Louis', 'Kansas City']], ['TN', ['Nashville', 'Memphis']], ['LA', ['New Orleans', 'Baton Rouge']],
  ['NC', ['Raleigh']], ['OH', ['Cleveland', 'Cincinnati', 'Columbus']], ['MD', ['Baltimore', 'Annapolis']],
  ['UT', ['Salt Lake City']], ['NM', ['Albuquerque', 'Santa Fe']], ['HI', ['Honolulu']], ['AK', ['Anchorage', 'Fairbanks']],
  ['VA', ['Virginia Beach', 'Quantico']], ['WI', ['Milwaukee']], ['IN', ['Indianapolis']],
];

/** Military installations (current and former names) → state. */
const INSTALLATIONS: [string, string[]][] = [
  ['NC', ['Fort Bragg', 'Fort Liberty', 'Camp Lejeune', 'Cherry Point', 'Seymour Johnson']],
  ['TX', ['Fort Hood', 'Fort Cavazos', 'Fort Bliss', 'Fort Sam Houston', 'Lackland', 'Dyess', 'Corpus Christi Army Depot']],
  ['KY', ['Fort Campbell', 'Fort Knox']], ['CO', ['Fort Carson', 'Peterson Space Force Base', 'Schriever', 'Cheyenne Mountain', 'Air Force Academy']],
  ['NY', ['Fort Drum', 'West Point']], ['GA', ['Fort Stewart', 'Fort Benning', 'Fort Moore', 'Fort Gordon', 'Fort Eisenhower', 'Kings Bay', 'Robins Air Force Base']],
  ['OK', ['Fort Sill', 'Tinker Air Force Base', 'Altus Air Force Base']], ['KS', ['Fort Leavenworth', 'Fort Riley', 'McConnell']],
  ['WA', ['Joint Base Lewis-McChord', 'Fort Lewis', 'Naval Base Kitsap', 'Fairchild Air Force Base', 'Whidbey Island']],
  ['AK', ['Fort Wainwright', 'Joint Base Elmendorf-Richardson', 'Elmendorf', 'Eielson', 'Clear Space Force Station']],
  ['AZ', ['Fort Huachuca', 'Davis-Monthan', 'Luke Air Force Base', 'Yuma Proving Ground']],
  ['CA', ['Fort Irwin', 'Camp Pendleton', 'Twentynine Palms', 'Naval Base San Diego', 'Edwards Air Force Base', 'Vandenberg', 'Beale', 'Travis Air Force Base', 'Miramar', 'China Lake']],
  ['VA', ['Naval Station Norfolk', 'Langley', 'Fort Belvoir', 'Fort Eustis', 'Fort Gregg-Adams', 'Fort Lee', 'Dam Neck', 'Oceana']],
  ['FL', ['MacDill', 'Eglin', 'Tyndall', 'Hurlburt', 'Patrick Space Force Base', 'Cape Canaveral', 'Mayport', 'Pensacola']],
  ['HI', ['Pearl Harbor', 'Hickam', 'Schofield Barracks', 'Kaneohe']], ['CT', ['Groton']], ['MD', ['Fort Meade', 'Aberdeen Proving Ground', 'Joint Base Andrews', 'Naval Academy']],
  ['MO', ['Whiteman', 'Fort Leonard Wood']], ['ND', ['Minot', 'Grand Forks Air Force Base', 'Grand Forks AFB']], ['MT', ['Malmstrom']],
  ['WY', ['F.E. Warren', 'Warren Air Force Base']], ['NE', ['Offutt']], ['LA', ['Barksdale', 'Fort Polk', 'Fort Johnson']], ['SD', ['Ellsworth']],
  ['NV', ['Nellis', 'Creech', 'Naval Air Station Fallon']], ['OH', ['Wright-Patterson']], ['NM', ['Kirtland', 'Holloman', 'White Sands', 'Cannon Air Force Base', 'Los Alamos']],
  ['UT', ['Hill Air Force Base', 'Dugway']], ['SC', ['Fort Jackson', 'Parris Island', 'Shaw Air Force Base', 'Joint Base Charleston']], ['AL', ['Redstone Arsenal', 'Fort Novosel', 'Fort Rucker', 'Maxwell Air Force Base']],
  ['NJ', ['Joint Base McGuire', 'Picatinny']], ['IL', ['Great Lakes Naval', 'Scott Air Force Base']], ['MS', ['Keesler', 'Columbus Air Force Base']],
  ['GU', ['Andersen Air Force Base', 'Andersen AFB']], ['TN', ['Arnold Air Force Base', 'Oak Ridge']],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERMS = [
  ...STATES.map(([code, name]) => ({ code, term: name })),
  ...CITIES.flatMap(([code, names]) => names.map((term) => ({ code, term }))),
  ...INSTALLATIONS.flatMap(([code, names]) => names.map((term) => ({ code, term }))),
]
  // Longest first: "West Virginia" before "Virginia", "Washington state" before "Washington".
  .sort((a, b) => b.term.length - a.term.length)
  .map((t) => ({ ...t, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(t.term)}(?![\\p{L}\\p{N}])`, 'gu') }));

export interface UsPlaceMatch {
  /** Postal codes of the states (and DC, PR, GU) named or implied, in order of appearance. */
  states: string[];
  terms: string[];
}

/** Case-sensitive (place names are capitalised), longest-first, non-overlapping. */
export function matchUsPlaces(text: string): UsPlaceMatch {
  const taken: [number, number][] = [];
  const hits: { at: number; code: string; term: string }[] = [];
  for (const t of TERMS) {
    t.re.lastIndex = 0;
    for (const m of text.matchAll(t.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ at: start, code: t.code, term: m[0] });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  return { states: [...new Set(hits.map((h) => h.code))], terms: [...new Set(hits.map((h) => h.term))] };
}

export const US_STATE_NAMES: Record<string, string> = Object.fromEntries(STATES.map(([c, n]) => [c, n.replace(/ state$/, '')]));
