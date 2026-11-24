import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { canadaTravel, CANADA_TRAVEL_URL, type CanadaTravelState } from '../adapters/canadaTravel.ts';
import { cdcTravel, CDC_FEED_URL } from '../adapters/cdcTravel.ts';
import { buildTravelAdvice, findJointRaises, isAdviceRaise, parseCdcTitle } from '../../shared/domain/travelAdvice.ts';
import { jointRaiseRecord } from '../lib/convergenceRecords.ts';
import { validateEvent } from '../lib/validate.ts';
import { classifyCountry } from '../../shared/domain/countryConvergence.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const H = 3_600_000;
const iso = (h: number) => new Date(NOW - h * H).toISOString();

const country = (code: string, name: string, level: number, publishedH: number) => ({
  'country-iso': code,
  'advisory-state': level,
  'has-regional-advisory': 0,
  'recent-updates-type': 'Risk level change',
  'date-published': { asp: iso(publishedH) },
  eng: { name, 'url-slug': name.toLowerCase(), 'advisory-text': ['Take normal security precautions', 'Exercise a high degree of caution', 'Avoid non-essential travel', 'Avoid all travel'][level], 'recent-updates': 'Invented update' },
});
function file(entries: ReturnType<typeof country>[]) {
  const data: Record<string, unknown> = {};
  for (let k = 0; k < 120; k++) data[`Z${k}`] = country(`Q${String.fromCharCode(65 + (k % 26))}`.slice(0, 2), `Filler ${k}`, 0, 2000);
  for (const e of entries) data[e['country-iso']] = e;
  data['AZORES'] = { ...country('', 'Azores', 0, 10), 'country-iso': '' };
  return JSON.stringify({ metadata: {}, data });
}
const ok = (body: string) => async () => ({ kind: 'ok' as const, status: 200, body, validators: {}, bytes: body.length });

describe('Canada travel advice', () => {
  it('records recent high levels on the first read, then raises and lowers only', async () => {
    const first = await canadaTravel.collect({ now: NOW, state: null, fetch: ok(file([country('LB', 'Lebanon', 3, 48), country('FR', 'France', 1, 48), country('BY', 'Belarus', 3, 2000)])) });
    expect(first.events.map((e) => e.countryCodes[0])).toEqual(['LB']);
    expect(first.rejected).toEqual([]);
    const lb = first.events[0];
    expect(validateEvent(lb, NOW)).toBeNull();
    expect(lb.title).toBe('Lebanon — Canada: Avoid all travel');
    expect(lb.metadata).toMatchObject({ advisoryLevel: 4, canadaLevel: 3, change: 'initial' });
    expect(lb.sourceUrl).toBe('https://travel.gc.ca/destinations/lebanon');

    const raised = await canadaTravel.collect({ now: NOW + H, state: first.state, fetch: ok(file([country('LB', 'Lebanon', 3, 48), country('FR', 'France', 2, 1), country('BY', 'Belarus', 2, 1)])) });
    expect(raised.events.map((e) => [e.countryCodes[0], e.metadata?.change])).toEqual([['FR', 'raised'], ['BY', 'lowered']]);
    expect(raised.events[0].title).toBe('France — Canada: Avoid non-essential travel (raised from “Exercise a high degree of caution”)');
    expect(isAdviceRaise(raised.events[0])).toBe(true);
    expect((raised.state as CanadaTravelState).levels.FR.level).toBe(2);
    // Same levels, new text: nothing.
    const same = await canadaTravel.collect({ now: NOW + 2 * H, state: raised.state, fetch: ok(file([country('LB', 'Lebanon', 3, 0.5), country('FR', 'France', 2, 0.5), country('BY', 'Belarus', 2, 0.5)])) });
    expect(same.events).toEqual([]);
  });

  it('tags Israel and Palestine together, and refuses a near-empty file', async () => {
    const r = await canadaTravel.collect({ now: NOW, state: null, fetch: ok(file([country('IL', 'Israel and Palestine', 2, 5)])) });
    expect(r.events[0].countryCodes).toEqual(['IL', 'PS']);
    await expect(canadaTravel.collect({ now: NOW, state: null, fetch: ok(JSON.stringify({ data: { LB: country('LB', 'Lebanon', 3, 1) } })) })).rejects.toThrow(/only 1 countries/);
    expect(CANADA_TRAVEL_URL).toMatch(/^https:\/\/data\.international\.gc\.ca\//);
  });
});

describe('CDC travel health notices', () => {
  const rss = (items: [string, string, string][]) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Travel Notices</title>${items
      .map(([t, slug, h]) => `<item><title>${t}</title><link>https://wwwnc.cdc.gov/travel/notices/${slug}</link><pubDate>${new Date(NOW - Number(h) * H).toUTCString()}</pubDate><description>Invented notice.</description></item>`)
      .join('')}</channel></rss>`;

  it('parses titles into level, disease and places', () => {
    expect(parseCdcTitle('Level 2 - Yellow Fever in Burkina Faso, Côte d’Ivoire, and Ghana')).toEqual({ level: 2, disease: 'Yellow Fever', places: ['Burkina Faso', 'Côte d’Ivoire', 'Ghana'] });
    expect(parseCdcTitle('Level 1 - Global Measles')).toEqual({ level: 1, disease: 'Global Measles', places: [] });
    expect(parseCdcTitle('Something else')).toBeNull();
  });

  it('makes records with countries, reads at most every 3 hours, and grades levels for convergence', async () => {
    const urls: string[] = [];
    const body = rss([
      ['Level 4 - Invented Fever in Ituri and Nord-Kivu Provinces of the Democratic Republic of the Congo', 'level4/a', '5'],
      ['Level 1 - Global Dengue', 'level1/b', '10'],
      ['Level 2 - Invented Flu in Senegal', 'level2/c', '2000'],
    ]);
    const fetch = async (u: string) => {
      urls.push(u);
      return { kind: 'ok' as const, status: 200, body, validators: {}, bytes: body.length };
    };
    const r = await cdcTravel.collect({ now: NOW, state: null, fetch });
    expect(urls).toEqual([CDC_FEED_URL]);
    expect(r.events.map((e) => e.countryCodes)).toEqual([['CD'], []]);
    for (const e of r.events) expect(validateEvent(e, NOW)).toBeNull();
    expect(r.events[0].title).toMatch(/^CDC Level 4 \(avoid nonessential travel\): Invented Fever in Ituri/);
    expect(classifyCountry(r.events[0])).toEqual({ type: 'health-notice', feed: 'cdc', role: 'anomaly' });
    const again = await cdcTravel.collect({ now: NOW + H, state: r.state, fetch });
    expect(again.notModified).toBe(true);
    expect(urls).toHaveLength(1);
  });
});

describe('joint travel-advice raises', () => {
  const rec = (sourceId: string, country: string, h: number, meta: Record<string, unknown>): IntelligenceEvent => ({
    id: `${sourceId}-${country}-${h}`,
    contentHash: 'x',
    dataOrigin: 'live',
    sourceId,
    sourceName: sourceId,
    sourceClass: 'official',
    sourceUrl: 'https://example.test/',
    title: `Invented ${sourceId} ${country}`,
    category: 'diplomatic',
    regionIds: ['middle-east'],
    countryCodes: [country],
    publishedAt: iso(h),
    collectedAt: iso(h),
    credibility: 'official',
    verificationStatus: 'unreviewed',
    locationPrecision: 'country',
    metadata: meta,
  });

  it('needs two governments raising within 72 hours; three is strong; reissues and lowers do not count', () => {
    const us = rec('state-travel-advisories', 'IL', 10, { change: 'raised', advisoryLevel: 3 });
    const ca = rec('canada-travel-advisories', 'IL', 30, { change: 'raised', advisoryLevel: 3 });
    const uk = rec('uk-fcdo-travel', 'IL', 50, { changeNote: 'FCDO now advises against all but essential travel to the north' });
    const ukNoLonger = rec('uk-fcdo-travel', 'IL', 50, { changeNote: 'FCDO no longer advises against all travel to the area' });
    const reissue = rec('canada-travel-advisories', 'LB', 5, { change: 'reissued' });
    expect(isAdviceRaise(uk)).toBe(true);
    expect(isAdviceRaise(ukNoLonger)).toBe(false);
    expect(findJointRaises([us, reissue], NOW)).toEqual([]);
    const two = findJointRaises([us, ca], NOW);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ country: 'IL', level: 'watch', governments: ['canada-travel-advisories', 'state-travel-advisories'] });
    expect(findJointRaises([us, ca, uk], NOW)[0].level).toBe('strong');
    expect(findJointRaises([us, rec('canada-travel-advisories', 'IL', 80, { change: 'raised' })], NOW)).toEqual([]);

    const r = jointRaiseRecord(findJointRaises([us, ca, uk], NOW)[0], iso(0));
    expect(validateEvent(r, NOW)).toBeNull();
    expect(r.title).toBe('Travel advice raised by 3 governments for Israel within 72 h (Canada, United States, United Kingdom)');
    expect(r.metadata).toMatchObject({ subtype: 'joint-advice-raise', level: 'strong' });
    expect(r.sourceUrl).toBe('https://watchtower-hq.web.app/regions/middle-east');
    // The same joint raise gets the same id run after run.
    expect(jointRaiseRecord(findJointRaises([us, ca, uk], NOW)[0], iso(-1)).id).toBe(r.id);
  });

  it('builds the region table from each government', () => {
    const t = buildTravelAdvice({
      us: { 'https://example.test/us-lb': { name: 'Lebanon', iso: 'LB', level: 4, publishedAt: iso(100) } },
      ca: { LB: { level: 3, publishedAt: iso(90) }, FR: { level: 1, publishedAt: iso(9) } },
      events: [rec('uk-fcdo-travel', 'LB', 20, { changeNote: 'Invented change note' }), rec('cdc-travel-notices', 'LB', 30, { advisoryLevel: 2 })],
      countries: ['LB', 'IL'],
      joint: [],
      now: NOW,
    });
    expect(t.countries).toHaveLength(1);
    expect(t.countries[0]).toMatchObject({
      country: 'LB',
      us: { level: 4, label: 'Do not travel' },
      ca: { level: 3, label: 'Avoid all travel' },
      uk: { level: null, label: 'Invented change note' },
    });
    expect(t.countries[0].cdc?.[0].level).toBe(2);
  });
});
