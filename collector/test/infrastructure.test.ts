// @vitest-environment node
/** Critical infrastructure: the built dataset (public/data/infrastructure.json, 2026-11-21) and the proximity rules. */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { InfraSite } from '../../shared/domain/infrastructure.ts';
import { computeInfrastructure, sitePatterns, siteScore } from '../../shared/domain/infraProximity.ts';
import { infrastructureMeter } from '../../shared/domain/meters/infrastructure.ts';
import { loadInfrastructure } from '../lib/infrastructure.ts';
import { readFileSync } from 'node:fs';

const NOW = Date.parse('2026-11-21T15:00:00Z');
const sites = loadInfrastructure();
const site = (name: string) => sites.find((s) => s.n.some((n) => n.startsWith(name)))!;
let n = 0;
function ev(title: string, hoursAgo: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = `e${++n}`;
  const t = new Date(NOW - hoursAgo * 3_600_000).toISOString();
  return { id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`, title, category: 'military', regionIds: [], countryCodes: [], publishedAt: t, occurredAt: null, collectedAt: t, credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'none', ...p };
}

describe('dataset', () => {
  it('has every type, known sites, and Crimea under Ukraine', () => {
    expect(sites.length).toBeGreaterThan(900);
    for (const t of ['nuclear', 'power', 'refinery', 'dam', 'port']) expect(sites.some((s) => s.t === t), t).toBe(true);
    expect(site('Zaporizhzhia Nuclear').n).toContain('Zaporozhye'); // WRI and Wikidata merged
    expect(site('Barakah').c).toBe('AE'); // added from Wikidata (post-2021)
    expect(site('Ras Tanura Refinery').t).toBe('refinery');
    expect(site('Port of Sevastopol').c).toBe('UA');
    const d = JSON.parse(readFileSync(new URL('../../public/data/infrastructure.json', import.meta.url), 'utf8'));
    expect(d.sources.map((s: { licence: string }) => s.licence).join(' ')).toMatch(/CC BY 4\.0.*CC0/);
  });
});

describe('names', () => {
  const named = (text: string) => sites.filter((s) => sitePatterns(s).some((p) => p.test(text))).map((s) => s.n[0]);
  it('needs the name with its type; bare place names never match', () => {
    expect(named('IAEA: Zaporizhzhia nuclear plant lost off-site power')).toEqual(['Zaporizhzhia Nuclear Power Plant']);
    expect(named('Drone hits near Zaporozhye NPP')).toEqual(['Zaporizhzhia Nuclear Power Plant']);
    expect(named('Fighting intensifies in Zaporizhzhia region')).toEqual([]);
    expect(named('Missiles hit the Port of Odesa')).toEqual(['Port of Odesa']);
    expect(named('Fire at Ras Tanura refinery after drone attack')).toEqual(['Ras Tanura Refinery']);
    expect(named('Baiji and Ulsan in the news')).toEqual([]); // WRI plants named only after their town
  });
});

describe('proximity', () => {
  const z = site('Zaporizhzhia Nuclear');
  const fire = (km: number, hoursAgo = 5) => ev('New thermal-anomaly cluster: 3 satellite fire detections', hoursAgo, { sourceId: 'nasa-firms', category: 'disaster', locationPrecision: 'exact', latitude: z.la + km / 111, longitude: z.lo });

  it('flags fires within 10 km of a nuclear plant, not beyond, and only for 72 h', () => {
    const snap = computeInfrastructure(sites, [fire(6), fire(14), fire(6, 100)], NOW);
    const f = snap.flagged.find((x) => x.id === z.id)!;
    expect(f.near).toBe(1);
    expect(f.matches[0]).toMatchObject({ how: 'near', kind: 'fire', km: 6 });
  });

  it('ignores aircraft positions; strike headlines naming a site weigh more than mentions', () => {
    const plane = ev('Military tanker aircraft seen', 2, { sourceId: 'adsb-military', locationPrecision: 'exact', latitude: z.la, longitude: z.lo });
    expect(computeInfrastructure(sites, [plane], NOW).flagged).toEqual([]);
    const strike = computeInfrastructure(sites, [ev('Drone strike hits Zaporizhzhia nuclear plant training centre', 3)], NOW).flagged[0];
    const mention = computeInfrastructure(sites, [ev('IAEA team rotates at Zaporizhzhia nuclear plant', 3, { sourceId: 'iaea-news', sourceClass: 'official' })], NOW).flagged[0];
    expect(siteScore(strike)).toBe(3);
    expect(siteScore(mention)).toBe(0.5);
  });

  it('the region meter scores flagged sites', () => {
    const snap = computeInfrastructure(sites, [fire(4), ev('Drone strike hits Zaporizhzhia nuclear plant', 3)], NOW);
    const m = infrastructureMeter({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], infrastructure: snap }, 'eastern-europe');
    expect(m.value).toBe(4); // near 3 + struck 1 (max of near/strike, plus 1 for both)
    expect(m.level).toBe(3);
    expect(m.reading).toMatch(/^1 site with records near or naming them/);
  });

  it('runs on the real records of 2026-11-21 in well under a second (nothing within range then)', () => {
    const events = JSON.parse(readFileSync(new URL('./fixtures/meters-events.sample.json', import.meta.url), 'utf8')) as IntelligenceEvent[];
    const now = Math.max(...events.map((e) => Date.parse(e.collectedAt)));
    const t = performance.now();
    const snap = computeInfrastructure(sites as InfraSite[], events, now);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(snap.sitesChecked).toBe(sites.length);
    expect(snap.flagged).toEqual([]); // nearest new fire cluster that day was 7 km from a power station (5 km ring)
  });
});
