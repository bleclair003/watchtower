/**
 * Phase 15 item 11: known dates ahead — tension-prone dates for the watch regions. Curated by hand;
 * edit this list to add or remove dates.
 *
 *  - Fixed annual dates (national days, founding days, anniversaries) recur every year.
 *  - Regular exercises have no fixed date: they are listed by the month they are usually held and
 *    marked approximate — the actual dates are announced nearer the time.
 *  - Elections are listed only once their date is confirmed by the electoral authority (checked
 *    2026-11-21); dates that were ambiguous were left out rather than guessed.
 * Lunar-calendar dates (Ashura, Quds Day, Israeli Independence Day) move each year and are not listed.
 */

export type KnownDateKind = 'anniversary' | 'national-day' | 'exercise' | 'election';

export interface KnownDate {
  id: string;
  title: string;
  kind: KnownDateKind;
  regionIds: string[];
  /** Recurring every year on this month (1–12) and day; for exercises, day is omitted (approximate month). */
  month: number;
  day?: number;
  /** One-off dates (elections): exact ISO date. */
  date?: string;
  note: string;
  url: string | null;
}

const W = (t: string) => `https://en.wikipedia.org/wiki/${t}`;

export const KNOWN_DATES: KnownDate[] = [
  // Middle East
  { id: 'soleimani', title: 'Anniversary of the killing of Qasem Soleimani (2020)', kind: 'anniversary', regionIds: ['middle-east'], month: 1, day: 3, note: 'Commemorations in Iran and Iraq; past anniversaries brought threats against US forces.', url: W('Assassination_of_Qasem_Soleimani') },
  { id: 'iran-revolution', title: 'Anniversary of the Iranian Revolution (22 Bahman)', kind: 'national-day', regionIds: ['middle-east'], month: 2, day: 11, note: 'Falls on 10 or 11 February depending on the Iranian calendar year; rallies and military displays.', url: W('Iranian_Revolution') },
  { id: 'nakba-day', title: 'Nakba Day', kind: 'anniversary', regionIds: ['middle-east'], month: 5, day: 15, note: 'Palestinian commemoration; protests in the West Bank, Gaza and abroad.', url: W('Nakba_Day') },
  { id: 'oct-7', title: 'Anniversary of the 7 October 2023 attack on Israel', kind: 'anniversary', regionIds: ['middle-east'], month: 10, day: 7, note: 'Commemorations in Israel; heightened security and rhetoric.', url: W('October_7_attacks') },
  // Eastern Europe
  { id: 'invasion-anniversary', title: "Anniversary of Russia's full-scale invasion of Ukraine (2022)", kind: 'anniversary', regionIds: ['eastern-europe'], month: 2, day: 24, note: 'Statements, sanctions packages and strikes have clustered around this date.', url: W('Russian_invasion_of_Ukraine') },
  { id: 'victory-day', title: 'Victory Day (Russia)', kind: 'national-day', regionIds: ['eastern-europe'], month: 5, day: 9, note: 'Military parade in Moscow; ceasefire announcements and strikes have both been timed around it.', url: W('Victory_Day_(9_May)') },
  { id: 'ukraine-independence', title: 'Independence Day of Ukraine', kind: 'national-day', regionIds: ['eastern-europe'], month: 8, day: 24, note: 'Past years saw heavy Russian strikes around this date.', url: W('Independence_Day_of_Ukraine') },
  // Taiwan Strait and China
  { id: 'lai-inauguration', title: 'Anniversary of the Taiwan presidential inauguration (20 May 2024)', kind: 'anniversary', regionIds: ['taiwan-strait'], month: 5, day: 20, note: 'The PLA held the "Joint Sword-2024A" exercise days after the 2024 inauguration.', url: W('Inauguration_of_Lai_Ching-te') },
  { id: 'ccp-founding', title: 'Founding anniversary of the Chinese Communist Party', kind: 'national-day', regionIds: ['taiwan-strait', 'south-china-sea'], month: 7, day: 1, note: 'Speeches setting policy tone.', url: W('Chinese_Communist_Party') },
  { id: 'pla-day', title: 'PLA founding day (Army Day)', kind: 'national-day', regionIds: ['taiwan-strait', 'south-china-sea'], month: 8, day: 1, note: 'Military messaging; occasionally exercises announced around it.', url: W("People's_Liberation_Army") },
  { id: 'prc-national-day', title: 'National Day of the People’s Republic of China', kind: 'national-day', regionIds: ['taiwan-strait', 'south-china-sea'], month: 10, day: 1, note: 'Golden Week; anniversary rhetoric on Taiwan.', url: W("National_Day_of_the_People's_Republic_of_China") },
  { id: 'double-ten', title: 'National Day of the Republic of China (Double Ten)', kind: 'national-day', regionIds: ['taiwan-strait'], month: 10, day: 10, note: "The Taiwan president's speech often draws PLA responses.", url: W('National_Day_of_the_Republic_of_China') },
  { id: 'taiwan-local-2026', title: 'Taiwan local elections ("nine-in-one") and nuclear-energy referendum', kind: 'election', regionIds: ['taiwan-strait'], month: 11, date: '2026-11-28', note: 'Scheduled by the Central Election Commission (31 Oct 2025; formal notice 20 Aug 2026).', url: W('2026_Taiwanese_local_elections') },
  // Korean Peninsula
  { id: 'kim-jong-il-birthday', title: 'Day of the Shining Star (Kim Jong Il’s birthday)', kind: 'national-day', regionIds: ['korean-peninsula'], month: 2, day: 16, note: 'North Korean holiday; launches have been timed near state holidays.', url: W('Day_of_the_Shining_Star') },
  { id: 'day-of-the-sun', title: 'Day of the Sun (Kim Il Sung’s birthday)', kind: 'national-day', regionIds: ['korean-peninsula'], month: 4, day: 15, note: 'North Korea’s most important holiday; past parades and launches.', url: W('Day_of_the_Sun') },
  { id: 'kpa-day', title: 'Founding anniversary of the Korean People’s Revolutionary Army (1932)', kind: 'national-day', regionIds: ['korean-peninsula'], month: 4, day: 25, note: 'Military parades in some years.', url: W("Korean_People's_Army") },
  { id: 'armistice', title: 'Korean War armistice (Victory Day in North Korea)', kind: 'anniversary', regionIds: ['korean-peninsula'], month: 7, day: 27, note: 'Parades and military messaging in Pyongyang.', url: W('Korean_Armistice_Agreement') },
  { id: 'dprk-founding', title: 'Founding day of the DPRK (1948)', kind: 'national-day', regionIds: ['korean-peninsula'], month: 9, day: 9, note: 'Parades in some years; a 2016 nuclear test fell on this date.', url: W('North_Korea') },
  { id: 'wpk-founding', title: 'Founding day of the Workers’ Party of Korea', kind: 'national-day', regionIds: ['korean-peninsula'], month: 10, day: 10, note: 'Parades in milestone years.', url: W("Workers'_Party_of_Korea") },
  // South China Sea
  { id: 'arbitration', title: 'Anniversary of the South China Sea arbitration award (2016)', kind: 'anniversary', regionIds: ['south-china-sea'], month: 7, day: 12, note: 'Statements by the Philippines and allies; Chinese rejections.', url: W('South_China_Sea_Arbitration') },
  // Red Sea and Yemen
  { id: 'galaxy-leader', title: 'Anniversary of the Houthi seizure of the Galaxy Leader (2023)', kind: 'anniversary', regionIds: ['red-sea'], month: 11, day: 19, note: 'Start of the Houthi campaign against Red Sea shipping.', url: W('Galaxy_Leader') },
  { id: 'sanaa-takeover', title: 'Anniversary of the Houthi takeover of Sanaa (2014)', kind: 'anniversary', regionIds: ['red-sea'], month: 9, day: 21, note: 'Marked by the Houthis as a revolution anniversary; rallies and speeches.', url: W('Houthi_takeover_in_Yemen') },
  // United States
  { id: '9-11', title: 'Anniversary of the 11 September 2001 attacks', kind: 'anniversary', regionIds: ['united-states'], month: 9, day: 11, note: 'Heightened security posture.', url: W('September_11_attacks') },
  // Regular exercises (approximate months)
  { id: 'freedom-shield', title: 'Freedom Shield (US–South Korea exercise)', kind: 'exercise', regionIds: ['korean-peninsula'], month: 3, note: 'Usually held in March; North Korea typically responds with statements or launches.', url: W('Freedom_Shield') },
  { id: 'ulchi-freedom-shield', title: 'Ulchi Freedom Shield (US–South Korea exercise)', kind: 'exercise', regionIds: ['korean-peninsula'], month: 8, note: 'Usually held in August.', url: W('Ulchi-Freedom_Shield') },
  { id: 'han-kuang', title: 'Han Kuang (Taiwan’s annual military exercise)', kind: 'exercise', regionIds: ['taiwan-strait'], month: 7, note: 'Live-fire phase usually in July.', url: W('Han_Kuang_Exercise') },
  { id: 'balikatan', title: 'Balikatan (US–Philippines exercise)', kind: 'exercise', regionIds: ['south-china-sea'], month: 4, note: 'Usually April to May.', url: W('Balikatan') },
];

export interface KnownDateOccurrence {
  id: string;
  title: string;
  kind: KnownDateKind;
  regionIds: string[];
  /** ISO date (UTC midnight); for approximate items, the first day of the month. */
  at: string;
  approximate: boolean;
  note: string;
  url: string | null;
}

/** Occurrences from `now` to `now + days` (recurring dates in this year or next; elections once). */
export function knownDatesAhead(now: number, days: number, list: KnownDate[] = KNOWN_DATES): KnownDateOccurrence[] {
  const end = now + days * 86_400_000;
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const out: KnownDateOccurrence[] = [];
  for (const d of list) {
    const candidates: { t: number; approximate: boolean }[] = [];
    if (d.date) candidates.push({ t: Date.parse(`${d.date}T00:00:00Z`), approximate: false });
    else {
      const y = new Date(now).getUTCFullYear();
      for (const year of [y, y + 1]) {
        if (d.day) candidates.push({ t: Date.UTC(year, d.month - 1, d.day), approximate: false });
        else {
          // Approximate month: include while any part of the month lies ahead within the window.
          const start = Date.UTC(year, d.month - 1, 1);
          const monthEnd = Date.UTC(year, d.month, 0);
          if (monthEnd >= today && start <= end) candidates.push({ t: Math.max(start, today), approximate: true });
        }
      }
    }
    for (const c of candidates) {
      if (c.t >= today && c.t <= end) {
        out.push({ id: d.id, title: d.title, kind: d.kind, regionIds: d.regionIds, at: new Date(c.t).toISOString(), approximate: c.approximate, note: d.note, url: d.url });
        break;
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
