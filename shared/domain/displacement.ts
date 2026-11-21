/** Phase 13 item 15: UNHCR displacement figures per watch-region country (slow-moving context, not alerts). */

/** ISO3 (as UNHCR reports it) → ISO2 for every watch-region country outside the US. */
export const DISPLACEMENT_ISO3: Record<string, string> = {
  ISR: 'IL', PSE: 'PS', LBN: 'LB', SYR: 'SY', JOR: 'JO', IRQ: 'IQ', IRN: 'IR', SAU: 'SA', KWT: 'KW', BHR: 'BH', QAT: 'QA', ARE: 'AE', OMN: 'OM',
  UKR: 'UA', RUS: 'RU', BLR: 'BY', MDA: 'MD', POL: 'PL', LTU: 'LT', LVA: 'LV', EST: 'EE', ROU: 'RO',
  TWN: 'TW', PRK: 'KP', KOR: 'KR', PHL: 'PH', VNM: 'VN', MYS: 'MY', BRN: 'BN', YEM: 'YE', ERI: 'ER', DJI: 'DJ', SOM: 'SO',
};

export interface DisplacementFigures {
  /** Refugees originating from the country, living abroad. */
  refugeesAbroad: number;
  /** Asylum seekers from the country, abroad. */
  asylumSeekersAbroad: number;
  /** Internally displaced people inside the country. */
  idps: number;
  /** Refugees hosted in the country. */
  refugeesHosted: number;
  /** Asylum seekers hosted in the country. */
  asylumSeekersHosted: number;
  /** Refugees who returned to the country in the year. */
  returnedRefugees: number;
}

export interface DisplacementRow {
  country: string; // ISO2
  latest: DisplacementFigures;
  previous: DisplacementFigures | null;
}

export interface DisplacementSnapshot {
  fetchedAt: string;
  /** The latest UNHCR reporting year (the current year is a mid-year figure until the annual release). */
  year: number;
  previousYear: number;
  rows: DisplacementRow[];
  simulated?: boolean;
}

export const EMPTY_FIGURES: DisplacementFigures = { refugeesAbroad: 0, asylumSeekersAbroad: 0, idps: 0, refugeesHosted: 0, asylumSeekersHosted: 0, returnedRefugees: 0 };

/** Change as a fraction, or null when the earlier figure is zero or missing. */
export function figureChange(now: number, before: number | undefined): number | null {
  return before && before > 0 ? now / before - 1 : null;
}
