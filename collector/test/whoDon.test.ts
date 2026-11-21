// @vitest-environment node
/** WHO Disease Outbreak News. The fixture is the real API response of 2026-11-21 (40 latest reports). */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { WHO_DON_SOURCE_ID, donEvents, splitDonTitle, whoDiseaseOutbreakNews, type DonItem } from '../adapters/whoDon.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T13:00:00Z');
const body = readFileSync(new URL('./fixtures/who-don.sample.json', import.meta.url), 'utf8');
const items = (JSON.parse(body) as { value: DonItem[] }).value;

describe('WHO outbreak reports (real)', () => {
  it('splits disease and countries, including UN-style names', () => {
    expect(splitDonTitle('Ebola disease caused by Bundibugyo virus- Democratic Republic of the Congo, Kenya and Nigeria').countries).toEqual(['CD', 'KE', 'NG']);
    expect(splitDonTitle('Pneumonia of undetermined etiology - the Russian Federation').countries).toEqual(['RU']);
    expect(splitDonTitle('Middle East respiratory syndrome coronavirus - Kingdom of Saudi Arabia').countries).toEqual(['SA']);
    expect(splitDonTitle('Yellow fever - WHO African Region').countries).toEqual([]);
  });

  it('records the last 45 days, flags high-consequence pathogens, tags regions', () => {
    const events = donEvents(items, NOW);
    expect(events.length).toBe(10); // Oct. 8 – Nov. 20
    const mers = events.find((e) => e.metadata?.donId === '2026-DON626')!;
    expect(mers.title).toBe('WHO outbreak report (high-consequence pathogen): Middle East respiratory syndrome (MERS) — Qatar');
    expect(mers.regionIds).toEqual(['middle-east']);
    expect(mers.sourceUrl).toBe('https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON626');
    expect(validateEvent(mers, NOW)).toBeNull();
    const russia = events.find((e) => e.metadata?.donId === '2026-DON620')!;
    expect(russia.regionIds).toEqual(['eastern-europe']);
    expect(russia.metadata?.highConsequence).toBe(true); // undetermined etiology
    expect(events.find((e) => e.metadata?.donId === '2026-DON627')!.metadata?.highConsequence).toBe(false); // chikungunya
  });
});

describe('adapter and indicators', () => {
  it('one request at most every 3 hours', async () => {
    const fetch = vi.fn(async (_url: string): Promise<FetchResult> => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: {} }));
    const r = await whoDiseaseOutbreakNews.collect({ now: NOW, state: null, fetch });
    expect(fetch.mock.calls[0][0]).toMatch(/\$select=/);
    expect(r.events.length).toBe(10);
    fetch.mockClear();
    expect((await whoDiseaseOutbreakNews.collect({ now: NOW + 3_600_000, state: r.state, fetch })).notModified).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('one report naming a Middle East country within 30 days is ELEVATED (two would trigger)', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(WHO_DON_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(7);
    const events = donEvents(items, NOW);
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: WHO_DON_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 60 * 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    // MERS in Qatar (Nov. 13) only: Saudi MERS (Oct. 15) is older than 30 days.
    expect(evaluateIndicator(defs.find((d) => d.regionId === 'middle-east')!, events, status, NOW).state).toBe('ELEVATED');
  });
});
