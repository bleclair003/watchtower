import type { WatchRegion } from './types';

/**
 * Initial operator watch regions.
 *
 * Bounding boxes are deliberately coarse *watch areas* for display and
 * filtering — they are not political boundaries and carry no claim about
 * sovereignty or the extent of any conflict.
 */
export const WATCH_REGIONS: WatchRegion[] = [
  {
    id: 'middle-east',
    name: 'Middle East',
    shortCode: 'MIDEAST',
    description: 'Levant, Gulf states, Iran and Iraq.',
    bbox: [34.0, 12.5, 63.5, 38.5],
    countryCodes: ['IL', 'PS', 'LB', 'SY', 'JO', 'IQ', 'IR', 'SA', 'KW', 'BH', 'QA', 'AE', 'OM'],
  },
  {
    id: 'eastern-europe',
    name: 'Eastern Europe / Ukraine',
    shortCode: 'EASTEUR',
    description: 'Ukraine, Russia (western), Belarus, Moldova and NATO eastern flank.',
    bbox: [19.0, 43.5, 41.0, 57.5],
    countryCodes: ['UA', 'RU', 'BY', 'MD', 'PL', 'LT', 'LV', 'EE', 'RO'],
  },
  {
    id: 'taiwan-strait',
    name: 'Taiwan Strait',
    shortCode: 'TWSTRAIT',
    description: 'Taiwan and the adjacent Chinese coastline.',
    bbox: [117.0, 21.5, 123.0, 26.5],
    countryCodes: ['TW'],
  },
  {
    id: 'korean-peninsula',
    name: 'Korean Peninsula',
    shortCode: 'KOREA',
    description: 'North and South Korea and adjacent waters.',
    bbox: [124.0, 33.0, 131.0, 43.0],
    countryCodes: ['KP', 'KR'],
  },
  {
    id: 'south-china-sea',
    name: 'South China Sea',
    shortCode: 'SCS',
    description: 'South China Sea maritime area and littoral states.',
    bbox: [105.0, 3.0, 121.0, 21.5],
    countryCodes: ['PH', 'VN', 'MY', 'BN'],
  },
  {
    id: 'red-sea',
    name: 'Red Sea / Gulf of Aden',
    shortCode: 'REDSEA',
    description: 'Red Sea, Bab el-Mandeb, Gulf of Aden and Horn of Africa coast.',
    bbox: [32.0, 10.5, 52.0, 28.0],
    countryCodes: ['YE', 'ER', 'DJ', 'SO'],
  },
  {
    id: 'global-cyber',
    name: 'Global Cybersecurity',
    shortCode: 'CYBER',
    description: 'Non-geographic: cyber advisories and incidents worldwide.',
    bbox: null,
    countryCodes: [],
  },
];

export function getRegion(id: string): WatchRegion | undefined {
  return WATCH_REGIONS.find((r) => r.id === id);
}
