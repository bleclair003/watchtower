// @vitest-environment node
/** Phase 22: overnight air attacks on Ukraine — parsing (invented sample texts), collector, meter. */
import { describe, expect, it } from 'vitest';
import { interceptRate, mergeAirReports, parseAirReport, type AirReport } from '../../shared/domain/airAttacks.ts';
import { isAirReportLink, uaAirForce } from '../adapters/uaAirForce.ts';
import { UKRINFORM_WAR_RSS } from '../adapters/ukraineFront.ts';
import { airAttackMeter } from '../../shared/domain/meters/airAttackMeter.ts';
import type { FetchResult } from '../lib/http.ts';

const PUB = '2026-11-21T07:17:00Z';

describe('Air Force report parsing', () => {
  it('reads launches, shoot-downs and hits; ignores dates, model numbers and sub-counts', () => {
    const text = [
      'Starting at 18:00 on Friday, November 20, Russian forces attacked Ukraine with three Iskander-M/KN-23/S-400 ballistic missiles and 148 attack drones, including Shaheds (87 of them jet-powered) and S8000 Banderol missiles.',
      'The attack was repelled by aircraft and mobile fire groups.',
      'As of 08:00, air defense forces had shot down or suppressed 117 drones.',
      'Hits were recorded at 19 locations, while debris fell at nine locations.',
    ].join(' ');
    expect(parseAirReport(text, 'Air defense neutralizes 117 of 148 Russian drones launched overnight', 'u', PUB)).toEqual({
      day: '2026-11-21', drones: 148, missiles: 3, ballistic: 3, dronesDown: 117, missilesDown: null, hitLocations: 19, debrisLocations: 9, url: 'u',
    });
  });

  it('reads a bulleted weapons list (list items end like sentences) and "strikes were recorded at"', () => {
    const text = [
      'Starting at 18:00 on Thursday, November 19, Russian forces used the following weapons to attack Ukraine:',
      'Iskander-M ballistic missiles and Zircon missiles. They were launched from Bryansk;',
      '84 air- and sea-launched Kh-101, Kalibr and Iskander-K cruise missiles. They were launched from the Black Sea;',
      '404 Shahed attack drones (123 of them jet-powered), Gerbera drones and decoys;',
      'The attack was repelled by Ukrainian aircraft.',
      'As of 10:30, air defenses had shot down or suppressed 462 targets: 82 missiles and 380 drones.',
      'Missile and drone strikes were recorded at 23 locations.',
    ].join(' ');
    const r = parseAirReport(text, 'Ukraine’s air defenses down 82 missiles, 380 Russian drones overnight', 'u', '2026-11-20T08:30:00Z')!;
    expect([r.drones, r.missiles, r.dronesDown, r.missilesDown, r.hitLocations]).toEqual([404, 84, 380, 82, 23]);
    expect(interceptRate(r)).toBeCloseTo(462 / 488, 3);
  });

  it('prefers the headline’s shot-down figures and does not read missiles across a drone count', () => {
    const r = parseAirReport('Russian forces attacked Ukraine with 143 attack drones and two S8000 Banderol missiles. Air defenses shot down or suppressed 141 drones and two missiles.', 'Air defense neutralizes 124 Russian drones, two S8000 Banderol missiles', 'u', PUB)!;
    expect([r.drones, r.missiles, r.dronesDown, r.missilesDown]).toEqual([143, 2, 124, 2]);
    expect(parseAirReport('UK announces new air defense aid for Ukraine.', 'UK to strengthen Ukraine’s air defenses', 'u', PUB)).toBeNull();
  });

  it('keeps one report per night, the fuller one', () => {
    const base: AirReport = { day: '2026-11-21', drones: 100, missiles: null, ballistic: null, dronesDown: 80, missilesDown: null, hitLocations: null, debrisLocations: null, url: 'a' };
    expect(mergeAirReports([base], [{ ...base, drones: 148, url: 'b' }, { ...base, day: '2025-01-01' }], 45, Date.parse(PUB)).map((r) => [r.day, r.url])).toEqual([['2026-11-21', 'b']]);
  });
});

describe('collector', () => {
  it('recognises air-defence report links only', () => {
    expect(isAirReportLink('https://www.ukrinform.net/rubric-ato/4187055-air-defense-neutralizes-117-of-148-russian-drones.html')).toBe(true);
    expect(isAirReportLink('https://www.ukrinform.net/rubric-ato/4186737-ukraines-air-defenses-down-82-missiles.html')).toBe(true);
    expect(isAirReportLink('https://www.ukrinform.net/rubric-ato/4186300-uk-to-announce-new-commitments-to-strengthen-ukraines-air-defenses.html')).toBe(false);
  });

  it('reads reports from the feed and records each night once', async () => {
    const link = 'https://www.ukrinform.net/rubric-ato/4187055-air-defense-neutralizes-117-of-148-russian-drones.html';
    const pages: Record<string, string> = {
      [UKRINFORM_WAR_RSS]: `<rss><channel><item><title><![CDATA[Air defense neutralizes 117 of 148 Russian drones launched overnight]]></title><link>${link}</link></item></channel></rss>`,
      [link]: `<meta property="og:title" content="Air defense neutralizes 117 of 148 Russian drones launched overnight"><script>{"datePublished": "2026-11-21T09:17:00+02:00"}</script><div class="newsText"><p>Russian forces attacked Ukraine with 148 attack drones. Air defenses shot down 117 drones.</p></div><div class="analiticBody"></div>`,
    };
    const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, validators: {}, bytes: b.length });
    const r1 = await uaAirForce.collect({ now: Date.parse('2026-11-22T00:00:00Z'), state: null, fetch: async (u) => ok(pages[u] ?? '') });
    expect(r1.events.map((e) => e.title)).toEqual(['Overnight attack on Ukraine (night to 21 Nov): 148 drones; 117 drones shot down or suppressed']);
    expect(r1.events[0].summary).toContain("Ukraine's own figures (one side)");
    const r2 = await uaAirForce.collect({ now: Date.parse('2026-11-22T00:30:00Z'), state: r1.state!, fetch: async (u) => ok(pages[u] ?? '') });
    expect(r2.events).toHaveLength(0);
  });
});

describe('air attack meter', () => {
  const night = (i: number, drones: number, missiles = 0): AirReport => ({ day: `2026-11-${String(21 - i).padStart(2, '0')}`, drones, missiles, ballistic: null, dronesDown: Math.round(drones * 0.8), missilesDown: null, hitLocations: 5, debrisLocations: null, url: 'u' });
  const input = (air: AirReport[]) => ({ now: Date.parse(PUB), events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], ukraineFront: { reports: [], today: null, claims: [], air } });
  const usual = Array.from({ length: 14 }, (_, i) => night(i + 1, 120));

  it('compares last night with the 14 before, and a big missile salvo raises it on its own', () => {
    expect(airAttackMeter(input([night(0, 130), ...usual])).label).toBe('QUIET');
    expect(airAttackMeter(input([night(0, 260), ...usual])).label).toBe('ELEVATED'); // 2.2×
    expect(airAttackMeter(input([night(0, 100, 85), ...usual])).label).toBe('HIGH'); // 85 missiles
    expect(airAttackMeter(input([night(0, 100), night(1, 100)])).label).toBe('BUILDING BASELINE');
    expect(airAttackMeter(input([night(0, 100, 50)])).label).toBe('ELEVATED'); // salvo counts even while building
  });
});
