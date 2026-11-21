import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '@shared/domain/types';
import { summarizeRegion } from './regionSummary';
import { parseCommand } from './commands';

const NOW = Date.parse('2026-11-21T12:00:00Z');
let n = 0;
const ev = (p: Partial<IntelligenceEvent> & { title: string; hoursAgo: number }): IntelligenceEvent => {
  const id = `e${++n}`;
  const at = new Date(NOW - p.hoursAgo * 3_600_000).toISOString();
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC News — World', sourceClass: 'media',
    sourceUrl: `https://www.bbc.co.uk/news/articles/${id}`, category: 'military', regionIds: ['middle-east'], countryCodes: ['IL'],
    publishedAt: at, occurredAt: null, collectedAt: at, credibility: 'single-source', verificationStatus: 'unreviewed',
    locationPrecision: 'country', ...p,
  };
};

describe('region summary', () => {
  it('counts relevant records in the window, by country (region countries first) and category', () => {
    const s = summarizeRegion(
      [
        ev({ title: 'Israel strikes', hoursAgo: 2, countryCodes: ['IL', 'US'] }),
        ev({ title: 'Iran missile test', hoursAgo: 30, countryCodes: ['IR'] }),
        ev({ title: 'Quake', hoursAgo: 5, category: 'disaster', sourceClass: 'scientific', countryCodes: [], locationPrecision: 'exact', latitude: 32, longitude: 35 }),
        ev({ title: 'Football final in Doha', hoursAgo: 1, category: 'general', sourceUrl: 'https://www.aljazeera.com/sports/x' }),
        ev({ title: 'Old', hoursAgo: 24 * 8 }),
        ev({ title: 'Elsewhere', hoursAgo: 1, regionIds: ['red-sea'] }),
      ],
      'middle-east',
      NOW,
    );
    expect(s.events.map((e) => e.title)).toEqual(['Israel strikes', 'Quake', 'Iran missile test']);
    expect([s.last24h, s.prev24h, s.plotted]).toEqual([2, 1, 1]);
    expect(s.byCountry).toEqual([
      { code: 'IL', count: 1, inRegion: true },
      { code: 'IR', count: 1, inRegion: true },
      { code: 'US', count: 1, inRegion: false },
    ]);
    expect(s.byCategory[0]).toEqual({ category: 'military', count: 2 });
  });

  it('REGION command opens a region page, or the index without an argument', () => {
    expect(parseCommand('region mideast')).toEqual({ kind: 'navigate', to: '/regions/middle-east' });
    expect(parseCommand('REGION')).toEqual({ kind: 'navigate', to: '/regions' });
    expect(parseCommand('REGIONS')).toEqual({ kind: 'navigate', to: '/regions' });
    expect(parseCommand('region atlantis').kind).toBe('error');
  });
});
