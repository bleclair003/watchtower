// @vitest-environment node
/** Polymarket odds. The fixture is the real Gamma API geopolitics response of 2026-11-21 (fields WATCHTOWER reads only). */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { GAMMA_EVENTS, marketMoveEvents, polymarketOdds } from '../adapters/polymarket.ts';
import { appendHistory, marketRegions, selectMarkets, unpackHistory, type GammaEvent } from '../../shared/domain/predictionMarkets.ts';
import { marketOdds } from '../../shared/domain/meters/markets.ts';
import { validateEvent } from '../lib/validate.ts';
import { getSource } from '../../shared/domain/sources.ts';

const NOW = Date.parse('2026-11-21T14:30:00Z');
const body = readFileSync(new URL('./fixtures/polymarket-events.sample.json', import.meta.url), 'utf8');
const events = JSON.parse(body) as GammaEvent[];
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: {} });

describe('market selection (real)', () => {
  it('keeps traded watch-region questions, one open market per event, never the US region', () => {
    const sel = selectMarkets(events, NOW);
    expect(sel.length).toBeGreaterThanOrEqual(30);
    expect(sel.every((m) => !m.regionIds.includes('united-states') && m.regionIds.length > 0)).toBe(true);
    expect(new Set(sel.map((m) => m.eventTitle)).size).toBe(sel.length);
    const taiwan = sel.find((m) => m.question === 'Will China invade Taiwan by end of 2026?')!;
    expect(taiwan.regionIds).toEqual(['taiwan-strait']);
    expect(sel.find((m) => /Strait of Hormuz traffic returns to normal by December 31/.test(m.question))!.regionIds).toEqual(['middle-east']);
    expect(sel.some((m) => /Venezuela|Cuba|Greenland/.test(m.question))).toBe(false);
    // The ceasefire event's most-traded OPEN market, not one that already closed in July.
    expect(sel.find((m) => m.eventTitle.startsWith('Israel x Iran ceasefire continues'))!.question).toMatch(/December 31/);
  });

  it('tags regions from place names and demonyms', () => {
    expect(marketRegions('Kharg Island no longer under Iranian control by...?').regionIds).toEqual(['middle-east']);
    expect(marketRegions('NATO x Russia military clash by...?').regionIds).toEqual(['eastern-europe']);
    expect(marketRegions('Will the U.S. invade Iran before 2027?')).toEqual({ regionIds: ['middle-east'], countryCodes: ['IR'] });
  });

  it('keeps a 6-hourly, 14-day packed history', () => {
    let h = '';
    for (let i = 0; i < 20 * 8; i++) h = appendHistory(h, NOW + i * 3 * 3_600_000, 0.2);
    const pts = unpackHistory(h);
    expect(pts.length).toBe(14 * 4); // 4 a day for 14 days
    expect(pts[1][0] - pts[0][0]).toBe(6 * 3_600_000);
  });
});

describe('records, adapter and meter', () => {
  const moved = () => {
    const sel = selectMarkets(events, NOW);
    sel[0] = { ...sel[0], yes: 0.41, change24h: -0.2 };
    return sel;
  };

  it('a 15-point move in 24 hours makes one record per market, day and direction', () => {
    const recs = marketMoveEvents(moved(), NOW);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toMatch(/^Market odds fell: ".+" 61% → 41% in 24 h \(Polymarket\)$/);
    expect(recs[0].summary).toMatch(/betting odds, not WATCHTOWER’s assessment/);
    expect(validateEvent(recs[0], NOW)).toBeNull();
    expect(marketMoveEvents(selectMarkets(events, NOW), NOW).length).toBe(0); // real day: no 15-point moves
  });

  it('reads the public API about hourly and carries history', async () => {
    const fetch = vi.fn(async (_u: string): Promise<FetchResult> => ok(body));
    const r = await polymarketOdds.collect({ now: NOW, state: null, fetch });
    expect(fetch.mock.calls[0][0]).toBe(GAMMA_EVENTS);
    expect(GAMMA_EVENTS.startsWith('https://gamma-api.polymarket.com/')).toBe(true);
    expect(r.state.latest?.markets.length).toBeGreaterThanOrEqual(30);
    fetch.mockClear();
    expect((await polymarketOdds.collect({ now: NOW + 30 * 60_000, state: r.state, fetch })).notModified).toBe(true);
    const later = await polymarketOdds.collect({ now: NOW + 7 * 3_600_000, state: r.state, fetch });
    expect(unpackHistory(later.state.latest!.markets[0].history).length).toBe(2);
    expect(getSource('polymarket')?.termsNotes).toMatch(/forbid scraping the website/);
  });

  it('the meter reports the biggest move and labels odds as betting odds', () => {
    const m = marketOdds({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], predictionMarkets: { fetchedAt: new Date(NOW).toISOString(), provider: 'polymarket', markets: moved() } });
    expect(m.label).toBe('MAX MOVE 20 PTS');
    expect(m.level).toBe(3);
    expect(m.notes[0]).toMatch(/Betting odds/);
    expect(marketOdds({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [] }).label).toBe('NO DATA');
  });
});
