// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { whoIsFirst } from '../../shared/domain/speed.ts';
import { buildStories } from '../../shared/domain/stories/stories.ts';

const NOW = Date.parse('2026-11-21T15:00:00Z');
const H = 3_600_000;
let n = 0;
const ev = (title: string, sourceId: string, h: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent => {
  const id = `e${++n}`;
  const t = new Date(NOW - h * H).toISOString();
  return { id, contentHash: id, dataOrigin: 'live', sourceId, sourceName: sourceId, sourceClass: 'media', sourceUrl: `https://example.test/${id}`, title, category: 'military', regionIds: ['middle-east'], countryCodes: ['IL'], publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p };
};

describe("who's first", () => {
  it('outlets: who published a shared story first and how far behind the others were', () => {
    const r = whoIsFirst([ev('Israel strikes Gaza camp killing seven', 'aljazeera', 10), ev('Israeli strike on Gaza camp kills seven', 'bbc-world', 6)], NOW);
    expect(r.storiesCompared).toBe(1);
    const aj = r.outlets.find((o) => o.sourceId === 'aljazeera')!;
    const bbc = r.outlets.find((o) => o.sourceId === 'bbc-world')!;
    expect(aj).toMatchObject({ name: 'Al Jazeera English', first: 1, medianLagHours: null });
    expect(bbc).toMatchObject({ first: 0, medianLagHours: 4 });
  });

  it('kinds: an exact-time source paired with a later news report on the same country', () => {
    const quake = ev('Earthquake M6.4 — 50 km E of Hualien, Taiwan', 'usgs-earthquakes', 10, { sourceClass: 'scientific', category: 'disaster', countryCodes: ['TW'], metadata: { magnitude: 6.4 } });
    const news = ev('Strong earthquake shakes eastern Taiwan', 'bbc-world', 7, { countryCodes: ['TW'], category: 'disaster' });
    const other = ev('Earthquake in Chile', 'bbc-world', 7, { countryCodes: ['CL'], category: 'disaster' });
    const k = whoIsFirst([quake, news, other], NOW).kinds.find((x) => x.id === 'earthquake')!;
    expect(k).toMatchObject({ records: 1, paired: 1, sourceFirst: 1, medianLead: 3, unit: 'hours' });
  });

  it('date-only sources are compared in whole days, and pairs need 48 hours or less', () => {
    const sanc = ev('UK sanctions: 20 new designations targeting Russia', 'uk-sanctions', 30, { category: 'economic', countryCodes: ['RU'], metadata: { subtype: 'sanctions-designations' } });
    const news = ev('UK sanctions Russian shadow fleet', 'bbc-world', 5, { countryCodes: ['RU'] });
    const late = ev('New sanctions on Russia', 'bbc-world', 30 - 60, { countryCodes: ['RU'] });
    const k = whoIsFirst([sanc, news, late], NOW).kinds.find((x) => x.id === 'sanctions')!;
    expect(k.unit).toBe('days');
    expect(k.paired).toBe(1);
  });

  it('story grouping stays fast on a month of headlines (words computed once per report)', () => {
    const base = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const big: IntelligenceEvent[] = [];
    for (let k = 0; k < 15; k++) for (const e of base) big.push({ ...e, id: `${e.id}-${k}`, publishedAt: new Date(Date.parse(e.publishedAt ?? e.collectedAt) - k * 2 * 86_400_000).toISOString() });
    buildStories(big.slice(0, 50)); // warm the gazetteer
    const t = performance.now();
    buildStories(big);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});
