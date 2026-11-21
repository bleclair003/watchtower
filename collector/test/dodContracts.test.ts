// @vitest-environment node
/**
 * DoD contract announcements. Fixtures are real: the contracts RSS of 2026-11-21 and the award
 * text of two day pages (Nov. 20, and a day with a Foreign Military Sales award to South Korea).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { DOD_CONTRACTS_FEED, DOD_CONTRACTS_SOURCE_ID, awardEvents, dodContracts, isNotable, parseContractsDay } from '../adapters/dodContracts.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';

const NOW = Date.parse('2026-11-21T11:00:00Z');
const nowIso = new Date(NOW).toISOString();
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: { etag: '"c"' } });
const day = fx('dod-contracts-day.sample.html');
const fmsDay = fx('dod-contracts-day-fms.sample.html');

describe('parsing a real contracts day', () => {
  const awards = parseContractsDay(day);

  it('reads service, contractor, amount, purpose and contract number', () => {
    expect(awards.length).toBeGreaterThan(8);
    const trident = awards.find((a) => a.contractor === 'Lockheed Martin Corp.' && a.service === 'NAVY')!;
    expect(trident).toMatchObject({ amountUsd: 1_533_124_563, munitions: true, ceiling: true, purpose: 'TRIDENT II (D5) missile production and deployed systems support' });
    const f108 = awards.find((a) => a.contractor === 'Chromalloy Component Services Inc.')!;
    expect(f108).toMatchObject({ service: 'AIR FORCE', amountUsd: 871_000_000, purpose: 'F108 engine sustainment', munitions: false });
  });

  it('labels multiple-award ceilings and avoids "Missile Range" false positives', () => {
    const multi = awards.find((a) => a.contractor.endsWith('companies (multiple-award)') && a.service === 'AIR FORCE')!;
    expect(multi).toMatchObject({ amountUsd: 16_100_000_000, ceiling: true });
    const ships = awards.find((a) => a.contractor.startsWith('Crowley'))!;
    expect(ships.munitions).toBe(false); // range-instrumentation ships, not munitions
  });

  it('records only notable awards', () => {
    const events = awardEvents('2026-11-20', 'https://www.war.gov/x', awards, nowIso);
    expect(events.map((e) => e.title)).toEqual([
      'DoD contract: $16.10B ceiling to 57 companies (multiple-award) for advanced propulsion enterprise work (Air Force, 2026-11-20)',
      'DoD contract: $1.53B ceiling to Lockheed Martin Corp. for TRIDENT II (D5) missile production and deployed systems support (Navy, 2026-11-20) [munitions]',
      'DoD contract: $316M to The Charles Stark Draper Laboratory for Trident II D5 Strategic Weapons System Program (Navy, 2026-11-20) [munitions]',
    ]);
    for (const e of events) {
      expect(validateEvent(e, NOW)).toBeNull();
      expect(e.regionIds).toEqual(['united-states']);
    }
  });

  it('tags Foreign Military Sales awards to the partner’s region', () => {
    const awards2 = parseContractsDay(fmsDay);
    const kr = awards2.find((a) => a.fmsCountries.includes('KR'))!;
    expect(isNotable(kr)).toBe(true);
    const [e] = awardEvents('2026-11-13', 'https://www.war.gov/y', [kr], nowIso);
    expect(e.regionIds).toEqual(['korean-peninsula']);
    expect(e.title).toMatch(/\[FMS: KR\]$/);
  });

  it('refuses an unrecognised page', () => {
    expect(() => parseContractsDay('<html>maintenance</html>')).toThrow(/page body not found/);
  });
});

describe('adapter and indicators', () => {
  it('reads each day page once (5 on the first run), then only new days', async () => {
    const fetch = vi.fn(async (url: string) => ok(url === DOD_CONTRACTS_FEED ? fx('dod-contracts-feed.sample.xml') : day));
    const first = await dodContracts.collect({ now: NOW, state: null, fetch });
    expect(fetch).toHaveBeenCalledTimes(6); // feed + 5 days
    expect(first.state.processed.length).toBe(5);
    fetch.mockClear();
    const again = await dodContracts.collect({ now: NOW + 1_800_000, state: { ...first.state, processed: first.state.processed }, fetch });
    // The feed lists 10 days; the 5 older ones are read now, then nothing is left.
    expect(fetch).toHaveBeenCalledTimes(6);
    fetch.mockClear();
    await dodContracts.collect({ now: NOW + 3_600_000, state: again.state, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('indicators are valid and experimental', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(DOD_CONTRACTS_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(7);
    expect(defs.every((d) => d.experimental && d.weight === 0)).toBe(true);
  });
});
