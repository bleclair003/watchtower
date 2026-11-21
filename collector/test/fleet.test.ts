// @vitest-environment node
/**
 * USNI News Fleet and Marine Tracker. The fixture is the real news.usni.org main feed of
 * 2026-11-21, trimmed to the Nov. 16 tracker and one other article.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { parseFeed } from '../lib/feed.ts';
import { FLEET_CATEGORY_FEED, FLEET_FEED, FLEET_SOURCE_ID, fleetEvents, parseFleetTracker, snapshotFromItem, trackerDate, usniFleetTracker } from '../adapters/usniFleet.ts';
import { areaNameOf, resolveFleetArea } from '../../shared/domain/fleet.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T09:00:00Z');
const xml = readFileSync(new URL('./fixtures/usni-feed.sample.xml', import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: {} });
const tracker = parseFeed(xml).find((i) => i.title.startsWith('USNI News Fleet and Marine Tracker'))!;

describe('fleet tracker parsing (real Nov. 16 tracker)', () => {
  const snap = snapshotFromItem(tracker)!;
  const area = (n: string) => snap.areas.find((a) => a.name === n)!;
  const hulls = (n: string) => area(n).ships.map((s) => s.hull);

  it('reads the date, the areas and the ships in them', () => {
    expect(snap.asOf).toBe('2026-11-16');
    expect(snap.url).toBe('https://news.usni.org/2026/11/16/usni-news-fleet-and-marine-tracker-nov-16-2026');
    expect(hulls('Arabian Sea')).toEqual(expect.arrayContaining(['CVN-73', 'CVN-77', 'CVN-71', 'DDG-86']));
    expect(hulls('Philippine Sea')).toContain('LHD-8');
    expect(hulls('Indian Ocean')).toContain('LHD-4');
    expect(hulls('Japan')).toEqual(['LHA-7']);
    expect(area('Arabian Sea')).toMatchObject({ regionIds: ['middle-east'], point: [16, 62] });
    expect(area('Japan').point).toBeNull(); // too vague to place
  });

  it('ignores the narrative before the first area and photo captions', () => {
    // The intro mentions USS Abraham Lincoln (CVN-71 relief) and a caption mentions HMAS Stalwart / USS Decatur.
    expect(snap.areas.flatMap((a) => a.ships).some((s) => s.hull === 'CVN-72')).toBe(false);
  });

  it('handles headings written as bold paragraphs, and skips ships described elsewhere', () => {
    const html = `<p>Intro: USS Nimitz (CVN-68) is operating in the Atlantic.</p>
      <h2>In Japan</h2><p>USS Tripoli (LHA-7) is in port in Sasebo, Japan.</p>
      <p>USS Ford (CVN-78) departed Yokosuka on Monday.</p>
      <p><strong>In the Philippine Sea</strong></p><p>USS Theodore Roosevelt (CVN-71) is underway in the Philippine Sea.</p>
      <figure><figcaption>USS Boxer (LHD-4) is operating in the Indian Ocean.</figcaption></figure>`;
    const areas = parseFleetTracker(html);
    expect(areas.map((a) => [a.name, a.ships.map((s) => s.hull)])).toEqual([
      ['Japan', ['LHA-7']],
      ['Philippine Sea', ['CVN-71']],
    ]);
  });

  it('normalises area headings and never guesses unknown areas', () => {
    expect(areaNameOf('In the Indian Ocean')).toBe('Indian Ocean');
    expect(areaNameOf('In Sasebo, Japan')).toBe('Sasebo, Japan');
    expect(areaNameOf('Carrier Strike Group 9')).toBeNull();
    expect(resolveFleetArea('Somewhere New')).toEqual({ point: null, regionIds: [], country: null });
    expect(trackerDate('USNI News Fleet and Marine Tracker: Sept. 8, 2026', '2026-09-09T00:00:00Z')).toBe('2026-09-08');
    expect(trackerDate('USNI News Fleet and Marine Tracker: April, 20 2026', '2026-04-20T00:00:00Z')).toBe('2026-04-20');
  });
});

describe('fleet records', () => {
  const snap = snapshotFromItem(tracker)!;

  it('records big decks only, and only when their area changes', () => {
    const prev = { 'CVN-73': 'Arabian Sea', 'CVN-77': 'Arabian Sea', 'CVN-71': 'Philippine Sea', 'LHD-4': 'Arabian Sea', 'LHD-8': 'Japan', 'LHA-7': 'Japan' };
    const { events, lastArea } = fleetEvents(snap, prev, new Date(NOW).toISOString());
    expect(events.map((e) => [e.metadata?.hull, e.metadata?.change, e.metadata?.previousArea])).toEqual([
      ['LHD-8', 'moved', 'Japan'],
      ['CVN-71', 'moved', 'Philippine Sea'],
      ['LHD-4', 'moved', 'Arabian Sea'],
    ]);
    const tr = events.find((e) => e.metadata?.hull === 'CVN-71')!;
    expect(validateEvent(tr, NOW)).toBeNull();
    expect(tr.title).toBe('Aircraft carrier USS Theodore Roosevelt (CVN-71) now in the Arabian Sea (MIDEAST) — USNI News Fleet Tracker, 2026-11-16');
    expect(tr).toMatchObject({ regionIds: ['middle-east'], countryCodes: [], locationPrecision: 'region', category: 'maritime', sourceClass: 'media' });
    expect(tr.latitude).toBeUndefined(); // never pinned to a point
    expect(tr.summary).toMatch(/approximate and weekly/);
    expect(lastArea['CVN-71']).toBe('Arabian Sea');
    expect(Object.keys(lastArea)).not.toContain('DDG-86');
  });

  it('a ship new to the tracker is an arrival', () => {
    const { events } = fleetEvents(snap, { 'CVN-73': 'Arabian Sea' }, new Date(NOW).toISOString());
    expect(events.find((e) => e.metadata?.hull === 'CVN-71')?.metadata?.change).toBe('arrived');
  });
});

describe('fleet adapter', () => {
  it('reads both feeds on the first run, then only the main feed, at most every 3 hours', async () => {
    const fetch = vi.fn(async (url: string) => ok(url === FLEET_FEED || url === FLEET_CATEGORY_FEED ? xml : ''));
    const first = await usniFleetTracker.collect({ now: NOW, state: null, fetch });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([FLEET_FEED, FLEET_CATEGORY_FEED]);
    expect(first.state.latest?.asOf).toBe('2026-11-16');
    expect(first.events.length).toBeGreaterThan(3); // first tracker: every big deck is "listed"
    expect(first.events.every((e) => e.metadata?.change === 'listed')).toBe(true);

    fetch.mockClear();
    const soon = await usniFleetTracker.collect({ now: NOW + 3_600_000, state: first.state, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(soon.notModified).toBe(true);

    const later = await usniFleetTracker.collect({ now: NOW + 4 * 3_600_000, state: first.state, fetch });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([FLEET_FEED]);
    expect(later.events).toEqual([]); // same tracker: nothing new
  });

  it('puts the latest tracker in the dashboard snapshot', async () => {
    const { runCollection } = await import('../pipeline.ts');
    const { MemoryStore } = await import('../store/memory.ts');
    const adapter = { ...usniFleetTracker, collect: (ctx: Parameters<typeof usniFleetTracker.collect>[0]) => usniFleetTracker.collect({ ...ctx, fetch: async () => ok(xml) }) };
    const { snapshot } = await runCollection([adapter as never], new MemoryStore(), { trigger: 'manual', now: () => NOW });
    expect(snapshot.fleet?.asOf).toBe('2026-11-16');
    expect(snapshot.fleet?.areas.length).toBeGreaterThan(4);
  });
});

describe('carrier-arrival indicators', () => {
  it('are valid and fire on a carrier moving into the region', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(FLEET_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.map((d) => d.regionId).sort()).toEqual(['eastern-europe', 'korean-peninsula', 'middle-east', 'red-sea', 'south-china-sea', 'taiwan-strait']);
    const snap = snapshotFromItem(tracker)!;
    const { events } = fleetEvents(snap, { 'CVN-71': 'Philippine Sea' }, new Date(NOW).toISOString());
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: FLEET_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    const me = defs.find((d) => d.id === 'middle-east.carrier-arrival')!;
    // Theodore Roosevelt moved in; George Washington and Bush were new to the "previous" map, so they count as arrivals too.
    expect(evaluateIndicator(me, events, status, NOW).state).toBe('TRIGGERED');
    const { events: one } = fleetEvents(snap, { 'CVN-71': 'Philippine Sea', 'CVN-73': 'Arabian Sea', 'CVN-77': 'Arabian Sea', 'LHD-4': 'Indian Ocean' }, new Date(NOW).toISOString());
    expect(evaluateIndicator(me, one, status, NOW).state).toBe('ELEVATED');
  });
});
