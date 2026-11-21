// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { matchGazetteer, countryByName } from '../../shared/domain/geo/gazetteer.ts';
import { regionsForPoint } from '../../shared/domain/regions.ts';
import { classifyTopic } from '../lib/topic.ts';
import { validateEvent } from '../lib/validate.ts';
import { makeFeedAdapter } from '../adapters/feedAdapter.ts';
import { bbcWorld, iaeaNews, parseIaeaDate } from '../adapters/news.ts';
import { fcdoTravelAdvice } from '../adapters/fcdoTravelAdvice.ts';
import { usgsEarthquakes } from '../adapters/usgsEarthquakes.ts';
import { gdacs } from '../adapters/gdacs.ts';
import { iodaOutages, IGNORED_SIGNALS, MIN_DURATION_HOURS } from '../adapters/ioda.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
/** Fixtures were captured from the live feeds at about this time. */
const NOW = Date.parse('2026-11-20T22:00:00Z');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: { etag: '"v1"' } });
const fetchMap = (map: Record<string, string>) =>
  vi.fn(async (url: string): Promise<FetchResult> => {
    const key = Object.keys(map).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    return ok(map[key]);
  });
const allValid = (events: IntelligenceEvent[]) => events.map((e) => validateEvent(e, NOW)).filter(Boolean);

describe('gazetteer', () => {
  it('matches whole names, longest first', () => {
    expect(matchGazetteer('Floods in Niger and Nigeria').countryCodes).toEqual(['NE', 'NG']);
    expect(matchGazetteer('Papua New Guinea quake').countryCodes).toEqual(['PG']);
    expect(matchGazetteer('South Sudan and Sudan talks').countryCodes).toEqual(['SS', 'SD']);
    expect(matchGazetteer("Ukraine's allies meet in Warsaw").countryCodes).toEqual(['UA', 'PL']);
  });

  it('treats abbreviations case-sensitively and skips ambiguous names', () => {
    expect(matchGazetteer('US strikes island').countryCodes).toEqual(['US']);
    expect(matchGazetteer('Tell us what you think').countryCodes).toEqual([]);
    expect(matchGazetteer('Storm hits Georgia coast').countryCodes).toEqual([]);
    expect(matchGazetteer('Georgian protesters in Tbilisi').countryCodes).toEqual(['GE']);
  });

  it('maps named seas and straits to watch regions without inventing a country', () => {
    const m = matchGazetteer('Tanker attacked in the Red Sea');
    expect(m.countryCodes).toEqual([]);
    expect(m.areaRegionIds).toEqual(['red-sea']);
    expect(m.terms).toEqual(['Red Sea']);
  });

  it('resolves exact country names', () => {
    expect(countryByName('Palestine')).toBe('PS');
    expect(countryByName('Turkey')).toBe('TR');
    expect(countryByName('Atlantis')).toBeNull();
  });

  it('finds points inside watch-area boxes only', () => {
    expect(regionsForPoint(41.3, 129.1)).toEqual(['korean-peninsula']);
    expect(regionsForPoint(-24.7, 171.2)).toEqual([]);
  });
});

describe('headline topic classifier', () => {
  it('uses keywords in priority order and records the term', () => {
    expect(classifyTopic('Russian missile hits Poland')).toEqual({ category: 'military', term: 'missile' });
    expect(classifyTopic('UK sanctions firms over settlements')).toEqual({ category: 'diplomatic', term: 'sanctions' });
    expect(classifyTopic('Hackers hit ministry')).toEqual({ category: 'cyber', term: 'hackers' });
  });

  it('does not read figurative "coup" as unrest, and defaults to general', () => {
    expect(classifyTopic('Historic talks are a coup for Putin').category).toBe('diplomatic');
    expect(classifyTopic('Army stages military coup').category).toBe('military');
    expect(classifyTopic('Pancreatic cancer pill shows promise')).toEqual({ category: 'general', term: null });
  });
});

describe('generic feed adapter (BBC fixtures)', () => {
  const world = fixture('bbc-world.sample.xml');
  const mideast = fixture('bbc-mideast.sample.xml');
  const adapter = makeFeedAdapter({
    sourceId: 'bbc-world',
    feeds: [
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', label: 'world' },
      { url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', label: 'middle_east' },
    ],
    publisher: 'BBC News',
    category: 'classify',
    credibility: 'single-source',
    baseUrl: 'https://www.bbc.co.uk/',
    skip: (item) => (/\/(videos|live)\//.test(item.link) ? 'non-article' : null),
  });

  it('merges feeds, de-duplicates by article, never attaches coordinates', async () => {
    const r = await adapter.collect({
      now: NOW,
      state: null,
      fetch: fetchMap({ 'https://feeds.bbci.co.uk/news/world/rss.xml': world, 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml': mideast }),
    });
    expect(r.itemsSeen).toBe(51);
    const keys = r.events.map((e) => e.sourceUrl.split(/[?#]/)[0]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.events.every((e) => !/\/(videos|live)\//.test(e.sourceUrl))).toBe(true);
    expect(r.events.every((e) => e.latitude === undefined && e.longitude === undefined)).toBe(true);
    expect(r.events.every((e) => e.credibility === 'single-source' && e.sourceClass === 'media')).toBe(true);
    expect(allValid(r.events)).toEqual([]);
  });

  it('records the basis for every geographic and topic tag', async () => {
    const r = await adapter.collect({
      now: NOW,
      state: null,
      fetch: fetchMap({ 'https://feeds.bbci.co.uk/news/world/rss.xml': world, 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml': mideast }),
    });
    for (const e of r.events) {
      const m = e.metadata!;
      if (e.countryCodes.length) {
        expect(e.locationPrecision).toBe('country');
        expect(m.geoBasis).toBe('text-mention');
        expect((m.geoTerms as string[]).length).toBeGreaterThan(0);
      }
      if (e.category !== 'general') expect(m.topicTerm).toBeTruthy();
    }
    expect(r.events.some((e) => e.regionIds.includes('middle-east'))).toBe(true);
  });

  it('the registered BBC adapter reads four feeds', async () => {
    const f = fetchMap({ 'https://feeds.bbci.co.uk/news/world': world });
    await bbcWorld.collect({ now: NOW, state: null, fetch: f });
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe('IAEA', () => {
  it('parses its "YY-MM-DD HH:mm" dates as UTC', () => {
    expect(parseIaeaDate('\n26-11-19  19:02\n')).toBe('2026-11-19T19:02:00.000Z');
    expect(parseIaeaDate('Thu, 19 Nov 2026')).toBeNull();
  });

  it('dates every item in the real feed', async () => {
    const r = await iaeaNews.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://www.iaea.org/': fixture('iaea.sample.xml') }) });
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.every((e) => e.publishedAt !== null)).toBe(true);
    expect(allValid(r.events)).toEqual([]);
  });
});

describe('UK FCDO travel advice', () => {
  it('maps each updated page to a country and keeps FCDO change notes verbatim', async () => {
    const r = await fcdoTravelAdvice.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://www.gov.uk/': fixture('fcdo.sample.atom') }) });
    expect(r.events).toHaveLength(20);
    const byCountry = Object.fromEntries(r.events.map((e) => [e.metadata!.fcdoCountry as string, e]));
    expect(byCountry.USA.countryCodes).toEqual(['US']);
    expect(byCountry.Palestine.countryCodes).toEqual(['PS']);
    expect(byCountry.Palestine.regionIds).toEqual(['middle-east']);
    expect(byCountry.Yemen.regionIds).toEqual(['red-sea']);
    expect(byCountry.Pakistan.summary).toMatch(/regional tensions/);
    expect(r.events.every((e) => e.countryCodes.length === 1)).toBe(true);
    expect(allValid(r.events)).toEqual([]);
  });
});

describe('USGS earthquakes', () => {
  it('keeps exact epicentres and assigns regions only by watch-area box', async () => {
    const r = await usgsEarthquakes.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://earthquake.usgs.gov/': fixture('usgs.sample.json') }) });
    expect(r.events).toHaveLength(12);
    for (const e of r.events) {
      expect(e.locationPrecision).toBe('exact');
      expect(typeof e.latitude).toBe('number');
      expect(e.countryCodes).toEqual([]);
      expect(e.regionIds).toEqual(regionsForPoint(e.latitude!, e.longitude!));
    }
    expect(allValid(r.events)).toEqual([]);
  });

  it('labels non-earthquake seismic types and the Korea indicator fires on them', async () => {
    const doc = JSON.parse(fixture('usgs.sample.json'));
    doc.features[0].properties.type = 'explosion';
    doc.features[0].geometry.coordinates = [129.08, 41.29, 0];
    const r = await usgsEarthquakes.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://earthquake.usgs.gov/': JSON.stringify(doc) }) });
    const ev = r.events[0];
    expect(ev.title).toMatch(/^Seismic event \(USGS type: explosion\)/);
    expect(ev.regionIds).toEqual(['korean-peninsula']);
    const def = INDICATOR_CATALOG.find((d) => d.id === 'korean-peninsula.seismic-non-earthquake')!;
    const iso = (t: number) => new Date(t).toISOString();
    const status = [
      {
        sourceId: 'usgs-earthquakes', health: 'ONLINE' as const, lastAttemptAt: iso(NOW - 600_000), lastSuccessAt: iso(NOW - 600_000),
        firstSuccessAt: iso(NOW - 86_400_000), lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null,
      },
    ];
    expect(evaluateIndicator(def, r.events, status, NOW).state).toBe('TRIGGERED');
    expect(evaluateIndicator(def, r.events.slice(1), status, NOW).state).toBe('NORMAL');
  });
});

describe('GDACS', () => {
  const xml = fixture('gdacs.sample.xml');

  it('imports Orange/Red anywhere but Green only inside watch areas', async () => {
    const r = await gdacs.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://www.gdacs.org/': xml }) });
    expect(r.itemsSeen).toBe(12);
    expect(r.events.map((e) => e.metadata!.alertLevel)).toEqual(['Orange', 'Orange', 'Orange', 'Orange']);
    expect(r.events.every((e) => e.locationPrecision === 'exact' && e.sourceUrl.startsWith('https://'))).toBe(true);
    expect(allValid(r.events)).toEqual([]);

    // Move one Green earthquake into the Korean Peninsula box: now it is imported.
    const moved = xml.replace('<geo:lat>-24.6996</geo:lat>', '<geo:lat>38.0</geo:lat>').replace('<geo:long>171.2326</geo:long>', '<geo:long>128.0</geo:long>');
    const r2 = await gdacs.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://www.gdacs.org/': moved }) });
    const green = r2.events.find((e) => e.metadata!.alertLevel === 'Green')!;
    expect(green.regionIds).toEqual(['korean-peninsula']);
  });

  it('gives an escalated alert a new id', async () => {
    const a = await gdacs.collect({ now: NOW, state: null, fetch: fetchMap({ 'https://www.gdacs.org/': xml }) });
    const b = await gdacs.collect({
      now: NOW,
      state: null,
      fetch: fetchMap({ 'https://www.gdacs.org/': xml.replace('<gdacs:alertlevel>Orange</gdacs:alertlevel>', '<gdacs:alertlevel>Red</gdacs:alertlevel>') }),
    });
    expect(b.events[0].metadata!.alertLevel).toBe('Red');
    expect(b.events[0].id).not.toBe(a.events[0].id);
  });
});

describe('IODA internet outages', () => {
  const body = fixture('ioda.sample.json');
  const now = Number(fixture('ioda.sample.now').trim()) * 1000;

  it(`imports only country outages of ${MIN_DURATION_HOURS} h or more, worded as detections`, async () => {
    const r = await iodaOutages.collect({ now, state: { firstRunAt: '2026-11-20T00:00:00Z' }, fetch: fetchMap({ 'https://api.ioda': body }) });
    const rows = (JSON.parse(body).data as { location: string; duration: number; datasource: string }[]).filter(
      (x) => /^country\/[A-Z]{2}$/.test(x.location) && x.duration >= MIN_DURATION_HOURS * 3600 && !IGNORED_SIGNALS.has(x.datasource),
    );
    expect(r.events).toHaveLength(rows.length);
    for (const e of r.events) {
      expect(e.title).toMatch(/^Internet connectivity drop detected — .+, from \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      expect(e.metadata!.signal).not.toBe('gtr');
      expect(e.summary).toMatch(/does not say which/);
      expect(e.countryCodes).toHaveLength(1);
      expect(e.locationPrecision).toBe('country');
    }
    expect(allValid(r.events)).toEqual([]);
  });

  it('asks for a short window on later runs', async () => {
    const f = fetchMap({ 'https://api.ioda': body });
    await iodaOutages.collect({ now, state: { firstRunAt: 'x' }, fetch: f });
    const url = new URL(f.mock.calls[0][0] as string);
    expect(Number(url.searchParams.get('until')) - Number(url.searchParams.get('from'))).toBe(3 * 86_400);
    expect(url.searchParams.get('entityType')).toBe('country');
  });
});

describe('catalog v3', () => {
  it('is valid and keeps experimental signals out of the RAI', () => {
    expect(validateCatalog(INDICATOR_CATALOG)).toEqual([]);
    expect(INDICATOR_CATALOG.filter((d) => d.experimental).every((d) => d.weight === 0)).toBe(true);
    expect(INDICATOR_CATALOG.filter((d) => d.id.endsWith('.media-conflict-reporting')).every((d) => d.experimental)).toBe(true);
  });
});
