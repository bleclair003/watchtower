// @vitest-environment node
/**
 * Phase 21: Ukraine front — General Staff update parsing, claims in headlines, the collector's
 * back-fill and the front meter. Test texts are written for these tests in the style of the reports
 * (no publisher text is stored in the repository).
 */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { claimsFrom, headlineClaim, mergeReports, parseGeneralStaff, type FrontReport } from '../../shared/domain/ukraineFront.ts';
import { reportRecord, uaGeneralStaff, UKRINFORM_WAR_RSS } from '../adapters/ukraineFront.ts';
import { frontMeter } from '../../shared/domain/meters/frontMeter.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-22T06:00:00Z');
const URL_ = 'https://example.test/war-update';

const EVENING = [
  'The General Staff said in an update as of 22:00 on November 21, 2026 that 116 combat engagements had taken place since the morning.',
  'The enemy carried out 51 airstrikes, dropping 162 guided aerial bombs, used 4,445 kamikaze drones and shelled positions and settlements 1,599 times.',
  'In the Lyman sector, the enemy launched five attacks toward Alpha and Beta.',
  'Russian forces launched 13 attacks in the Pokrovsk sector.',
  'The invaders tried to advance near Gamma, Delta and Epsilon.',
  'In the Huliaipole sector, Russian troops attacked Ukrainian positions nine times, toward Zeta.',
  'Russian forces conducted no offensive operations in the Kupiansk and Kramatorsk sectors.',
].join(' ');

const MORNING = [
  'The General Staff updated the situation as of 08:00 on Saturday, November 21.',
  'Russian forces carried out 78 airstrikes and conducted 1,976 shelling attacks.',
  'In the North Slobozhanshchyna and Kursk sectors, Russian forces launched ten attacks and shelled positions 149 times.',
  'Six Russian attempts to advance were stopped in the Lyman direction, near Eta.',
  'In the Pokrovsk direction, Ukrainian units stopped 26 Russian attacks.',
].join(' ');

describe('General Staff update', () => {
  it('reads an evening update: totals, sectors, settlements, quiet sectors', () => {
    const r = parseGeneralStaff(EVENING, URL_)!;
    expect([r.day, r.fullDay, r.total, r.airstrikes, r.guidedBombs, r.kamikazeDrones, r.shelling]).toEqual(['2026-11-21', false, 116, 51, 162, 4445, 1599]);
    expect(r.sectors).toEqual({ lyman: 5, pokrovsk: 13, huliaipole: 9 });
    expect(r.places).toEqual({ lyman: ['Alpha', 'Beta'], pokrovsk: ['Gamma', 'Delta', 'Epsilon'], huliaipole: ['Zeta'] });
    expect(r.quiet.sort()).toEqual(['kramatorsk', 'kupiansk']);
  });

  it('reads a morning update (whole previous day) with the total from the headline, and keeps a sector’s shelling out of the totals', () => {
    const r = parseGeneralStaff(MORNING, URL_, '2026-11-21T06:05:00Z', 'War update: 203 combat engagements on front line over past day, most in Pokrovsk direction')!;
    expect([r.day, r.fullDay, r.total, r.shelling]).toEqual(['2026-11-20', true, 203, 1976]);
    expect(r.sectors).toEqual({ 'north-slobozhanshchyna': 10, lyman: 6, pokrovsk: 26 });
  });

  it('falls back to the publish date when the update gives no time', () => {
    const r = parseGeneralStaff('In the Pokrovsk sector, the enemy launched 12 attacks.', URL_, '2026-11-15T07:56:00Z', 'War update: 171 combat engagements on front line over past day')!;
    expect([r.day, r.fullDay, r.total, r.sectors.pokrovsk]).toEqual(['2026-11-14', true, 171, 12]);
    expect(parseGeneralStaff('No date here.', URL_)).toBeNull();
  });

  it('keeps one report per day, a full day beating a partial one', () => {
    const base: FrontReport = { day: '2026-11-20', asOf: '2026-11-20T20:00:00Z', fullDay: false, total: 100, airstrikes: null, guidedBombs: null, kamikazeDrones: null, shelling: null, sectors: {}, quiet: [], places: {}, url: 'a' };
    const merged = mergeReports([base], [{ ...base, asOf: '2026-11-21T06:00:00Z', fullDay: true, total: 203 }, { ...base, day: '2025-01-01' }], 45, NOW);
    expect(merged.map((r) => [r.day, r.total])).toEqual([['2026-11-20', 203]]);
  });
});

describe('territorial claims in headlines', () => {
  it('reads Russian and Ukrainian claims, not vague ones', () => {
    expect(headlineClaim('Russia says it captured village of Alphavka in Donetsk region')).toEqual({ side: 'russia', place: 'Alphavka' });
    expect(headlineClaim('Russian forces take control of Beta Yar, Moscow claims')).toEqual({ side: 'russia', place: 'Beta Yar' });
    expect(headlineClaim('Russia claims capture of Gammivka')).toEqual({ side: 'russia', place: 'Gammivka' });
    expect(headlineClaim('Ukrainian forces recapture Deltansk, Zelensky says')).toEqual({ side: 'ukraine', place: 'Deltansk' });
    expect(headlineClaim('Russia claims capture of two villages')).toBeNull();
    expect(headlineClaim('Zelensky says Ukraine has yet to see written commitments')).toBeNull();
  });

  it('lists claims about Eastern Europe from the last 14 days, one per side and place per day', () => {
    const ev = (title: string, hoursAgo: number, regionIds = ['eastern-europe']): IntelligenceEvent => ({
      id: title + hoursAgo, contentHash: title, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: 'https://example.test/x', title,
      category: 'military', regionIds, countryCodes: [], publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(), occurredAt: null, collectedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
      credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'none',
    });
    const market = { ...ev('Market odds rose: "Will Russia capture Deltivka by December 31?"', 1), sourceId: 'polymarket', sourceClass: 'aggregator' as const };
    const claims = claimsFrom([ev('Russia says it captured Alphavka', 2), ev('Russia says it captured Alphavka', 3), ev('Russia says it captured Gammivka', 400), ev('Russia says it captured Betaville', 2, ['middle-east']), market], NOW);
    expect(claims.map((c) => [c.side, c.place])).toEqual([['russia', 'Alphavka']]);
  });
});

describe('collector', () => {
  const article = (headline: string, body: string, published: string) =>
    `<html><head><meta property="og:title" content="${headline}"><script>{"datePublished": "${published}"}</script></head><body><article><div class="newsText"><p>${body}</p></div><div class="analiticBody"></div></article></body></html>`;
  const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, validators: {}, bytes: body.length });

  it('reads update links from the feed and back-fill pages, records each full day once, and queues the rest', async () => {
    const pages: Record<string, string> = {
      [UKRINFORM_WAR_RSS]: `<rss><channel><item><title><![CDATA[War update: 203 combat engagements on front line over past day]]></title><link>https://www.ukrinform.net/rubric-ato/1002-war-update-203-combat-engagements.html</link></item><item><title><![CDATA[Other news]]></title><link>https://www.ukrinform.net/rubric-ato/1003-other.html</link></item></channel></rss>`,
      'https://www.ukrinform.net/rubric-ato?page=2': '<a href="/rubric-ato/1001-war-update-171-clashes.html">x</a>',
      'https://www.ukrinform.net/rubric-ato/1002-war-update-203-combat-engagements.html': article('War update: 203 combat engagements on front line over past day', 'In the Pokrovsk sector, the enemy launched 26 attacks.', '2026-11-21T06:05:00+02:00'),
      'https://www.ukrinform.net/rubric-ato/1001-war-update-171-clashes.html': article('War update: 171 combat engagements on front line over past day', 'In the Lyman sector, the enemy launched 7 attacks.', '2026-11-20T07:56:00+02:00'),
    };
    const r1 = await uaGeneralStaff.collect({ now: NOW, state: null, fetch: async (u) => ok(pages[u] ?? '') });
    expect(r1.events.map((e) => e.title)).toEqual(['Ukraine General Staff, 20 Nov: 203 combat engagements — most in Pokrovsk 26', 'Ukraine General Staff, 19 Nov: 171 combat engagements — most in Lyman 7']);
    expect(r1.events[0].regionIds).toEqual(['eastern-europe']);
    const r2 = await uaGeneralStaff.collect({ now: NOW + 1_800_000, state: r1.state!, fetch: async (u) => ok(pages[u] ?? '') });
    expect(r2.events).toHaveLength(0); // already recorded
  });

  it('describes a full day as one side’s figures', () => {
    const rec = reportRecord({ day: '2026-11-20', asOf: '2026-11-21T06:00:00Z', fullDay: true, total: 203, airstrikes: 78, guidedBombs: null, kamikazeDrones: 6224, shelling: 1976, sectors: { pokrovsk: 26 }, quiet: ['kramatorsk'], places: {}, url: URL_ }, '2026-11-22T00:00:00Z');
    expect(rec.summary).toContain("Ukraine's own figures (one side)");
    expect(rec.summary).toContain('No Russian offensive action in: Kramatorsk.');
  });
});

describe('front meter', () => {
  const day = (d: number, total: number): FrontReport => ({ day: `2026-11-${String(21 - d).padStart(2, '0')}`, asOf: '2026-11-21T06:00:00Z', fullDay: true, total, airstrikes: null, guidedBombs: null, kamikazeDrones: null, shelling: null, sectors: { pokrovsk: d === 0 ? 40 : 20 }, quiet: [], places: {}, url: URL_ });
  const input = (reports: FrontReport[]) => ({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], ukraineFront: { reports, today: null, claims: [] } });

  it('compares the latest day with the 14 before; builds until 7 earlier days exist', () => {
    expect(frontMeter(input([day(0, 300), day(1, 200)])).label).toBe('BUILDING BASELINE');
    const steady = Array.from({ length: 14 }, (_, i) => day(i + 1, 200));
    expect(frontMeter(input([day(0, 210), ...steady])).label).toBe('QUIET');
    const surge = frontMeter(input([day(0, 320), ...steady]));
    // Phase 24: 320 against a steady 200 is 6 typical spreads (10% floor) above normal.
    expect([surge.label, surge.value]).toEqual(['HIGH', 6]);
    expect(surge.components.find((c) => c.label.startsWith('Sectors'))?.value).toBe('Pokrovsk 40 (usual 20)');
    expect(surge.signals?.[0]).toMatchObject({ kind: 'spike', group: 'front' });
    // Against a jumpy fortnight 320 is only somewhat high.
    const jumpy = [120, 300, 150, 280, 200, 110, 310, 180, 140, 290, 160, 260, 130, 270].map((t, i) => day(i + 1, t));
    expect(frontMeter(input([day(0, 320), ...jumpy])).label).toBe('LOW');
  });
});
