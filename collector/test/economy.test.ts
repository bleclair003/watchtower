// @vitest-environment node
/** Currency and oil stress. Fixtures are the real files of 2026-11-21 (exchange-api for Nov. 20, 13 and Oct. 21; EIA spot prices). */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { FX_SOURCE_ID, OIL_SOURCE_ID, fxEvents, fxMoves, fxRates, oilEvents, oilMoves, oilPrices } from '../adapters/economy.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T13:00:00Z');
const raw = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const latest = JSON.parse(raw('fx-usd-latest.sample.json'));
const week = JSON.parse(raw('fx-usd-2026-11-13.sample.json'));
const month = JSON.parse(raw('fx-usd-2026-10-21.sample.json'));
const eia = raw('eia-oil.sample.json');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: {} });
const iso = (t: number) => new Date(t).toISOString();
const status = (sourceId: string) => [{ sourceId, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 60 * 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];

describe('currencies (real)', () => {
  it('no watch currency crossed a threshold in the real month (shekel −3.9% / week is below 5%)', () => {
    const moves = fxMoves(latest.usd, week.usd, month.usd, latest.date);
    expect(moves.length).toBe(28);
    const ils = moves.find((m) => m.code === 'ils')!;
    expect(ils.week).toBeCloseTo(0.039, 2);
    expect(fxEvents(moves, iso(NOW))).toEqual([]);
  });

  it('a 6% weekly fall, or a 2.5% move in a peg, is recorded and tagged', () => {
    const stressed = { ...latest.usd, uah: week.usd.uah * 1.06, aed: week.usd.aed * 1.025 };
    const events = fxEvents(fxMoves(stressed, week.usd, month.usd, latest.date), iso(NOW));
    expect(events.map((e) => e.metadata?.currency).sort()).toEqual(['AED', 'UAH']);
    const uah = events.find((e) => e.metadata?.currency === 'UAH')!;
    expect(uah.title).toMatch(/^Currency stress: Ukrainian hryvnia lost 6\.0% against the US dollar in 7 days/);
    expect(uah.regionIds).toEqual(['eastern-europe']);
    expect(validateEvent(uah, NOW)).toBeNull();
    expect(events.find((e) => e.metadata?.currency === 'AED')!.title).toMatch(/\(pegged\)/);
  });

  it('one record per currency per ISO week', () => {
    const stressed = { ...latest.usd, uah: week.usd.uah * 1.06 };
    const a = fxEvents(fxMoves(stressed, week.usd, month.usd, latest.date), iso(NOW));
    const b = fxEvents(fxMoves({ ...stressed, uah: week.usd.uah * 1.07 }, week.usd, month.usd, latest.date), iso(NOW));
    expect(a[0].id).toBe(b[0].id);
  });

  it('three files a fetch, falls back to the mirror, then waits 6 hours', async () => {
    const fetch = vi.fn(async (url: string): Promise<FetchResult> => {
      if (url.includes('jsdelivr') && url.includes('@latest')) throw new Error('jsDelivr down');
      const body = url.includes('2026-11-13') ? week : url.includes('2026-10-21') ? month : latest;
      return ok(JSON.stringify(body));
    });
    const r = await fxRates.collect({ now: NOW, state: null, fetch });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-11-13/v1/currencies/usd.json`,
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-10-21/v1/currencies/usd.json`,
    ]);
    expect(r.itemsSeen).toBe(28);
    fetch.mockClear();
    expect((await fxRates.collect({ now: NOW + 3_600_000, state: r.state, fetch })).notModified).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('oil (real)', () => {
  it('Brent fell 22% in 30 days (recorded as a move down); WTI below threshold', () => {
    const moves = oilMoves(JSON.parse(eia).response.data);
    const events = oilEvents(moves, iso(NOW));
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Oil price: Brent $92.94 (2026-11-17), down 22% in 30 days');
    expect(events[0].metadata?.direction).toBe('down');
    expect(validateEvent(events[0], NOW)).toBeNull();
  });

  it('needs the key, sends it as a header, never in the URL', async () => {
    const prev = process.env.CONGRESS_API_KEY;
    process.env.CONGRESS_API_KEY = 'test-key';
    try {
      const fetch = vi.fn(async (_u: string, _v?: unknown, _h?: Record<string, string>): Promise<FetchResult> => ok(eia));
      const r = await oilPrices.collect({ now: NOW, state: null, fetch });
      expect(fetch.mock.calls[0][0]).not.toMatch(/api_key|test-key/);
      expect(fetch.mock.calls[0][2]).toMatchObject({ 'X-Api-Key': 'test-key' });
      expect(r.events.length).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.CONGRESS_API_KEY;
      else process.env.CONGRESS_API_KEY = prev;
    }
    expect(oilPrices.requiredEnv).toEqual(['CONGRESS_API_KEY']);
  });
});

describe('indicators', () => {
  it('currency stress per region; the oil spike counts rises only', () => {
    const fx = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(FX_SOURCE_ID));
    const oil = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(OIL_SOURCE_ID));
    expect(validateCatalog([...fx, ...oil])).toEqual([]);
    expect(fx.length).toBe(7);
    const stressed = { ...latest.usd, uah: week.usd.uah * 1.06 };
    const events = fxEvents(fxMoves(stressed, week.usd, month.usd, latest.date), iso(NOW));
    expect(evaluateIndicator(fx.find((d) => d.regionId === 'eastern-europe')!, events, status(FX_SOURCE_ID), NOW).state).toBe('ELEVATED');
    const spike = oil[0];
    const down = oilEvents(oilMoves(JSON.parse(eia).response.data), iso(NOW));
    expect(evaluateIndicator(spike, down, status(OIL_SOURCE_ID), NOW).state).not.toBe('ELEVATED');
    const up = down.map((e) => ({ ...e, metadata: { ...e.metadata, direction: 'up' } }));
    expect(evaluateIndicator(spike, up, status(OIL_SOURCE_ID), NOW).state).toBe('ELEVATED');
  });
});
