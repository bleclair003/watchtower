// @vitest-environment node
/**
 * Military space launches. The fixture is the real Launch Library 2 list of the 40 latest launches
 * (2026-09-26 to 2026-11-21), slimmed to the fields WATCHTOWER reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { LAUNCHES_SOURCE_ID, isMilitaryLaunch, launchEvents, militaryLaunches, ownerCountry, type LL2Launch } from '../adapters/launches.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const body = readFileSync(new URL('./fixtures/ll2-previous.sample.json', import.meta.url), 'utf8');
const launches = (JSON.parse(body) as { results: LL2Launch[] }).results;
const byName = (s: string) => launches.find((l) => l.name.includes(s))!;
const synthetic = (p: Partial<LL2Launch> & { country: string }): LL2Launch => ({
  id: `x-${p.country}`, name: p.name ?? 'Rocket | Payload', net: '2026-11-19T03:00:00Z', status: { abbrev: 'Failure' },
  launch_service_provider: { name: p.launch_service_provider?.name ?? 'National agency' }, mission: { name: 'Payload', type: p.mission?.type ?? 'Earth Science' },
  pad: { name: 'Pad', country: { alpha_2_code: p.country }, location: { name: 'Site' } },
});

describe('military launch rule (real launches)', () => {
  it('keeps Government/Top Secret and military operators; drops commercial and science', () => {
    expect(isMilitaryLaunch(byName('USSF-317'))).toBe(true);
    expect(isMilitaryLaunch(byName('Yaogan 51'))).toBe(true);
    expect(isMilitaryLaunch(byName('Glonass'))).toBe(true); // Russian Space Forces
    expect(isMilitaryLaunch(byName('Starlink Group 15-18'))).toBe(false);
    expect(isMilitaryLaunch(byName('MMX'))).toBe(false);
    expect(isMilitaryLaunch(byName('Crew-13'))).toBe(false);
  });

  it('every North Korean or Iranian launch counts; Baikonur counts as Russia', () => {
    expect(isMilitaryLaunch(synthetic({ country: 'KP' }))).toBe(true);
    expect(isMilitaryLaunch(synthetic({ country: 'IR' }))).toBe(true);
    expect(ownerCountry(synthetic({ country: 'KZ' }))).toBe('RU');
  });

  it('records completed military launches only, with region by owner country', () => {
    const events = launchEvents(launches, NOW);
    expect(events).toHaveLength(12);
    const ussf = events.find((e) => e.title.includes('USSF-317'))!;
    expect(ussf.title).toBe('Military/classified space launch: USSF-317 on Falcon 9 Block 5 (United States, LEO) — success, 2026-11-21');
    expect(ussf.regionIds).toEqual(['united-states']);
    expect(validateEvent(ussf, NOW)).toBeNull();
    expect(events.find((e) => e.title.includes('Glonass'))!.regionIds).toEqual(['eastern-europe']);
    expect(events.find((e) => e.title.includes('Shijian 24'))!.regionIds).toEqual([]); // China is in no watch region
  });
});

describe('adapter and indicators', () => {
  it('one request at most every 3 hours', async () => {
    const fetch = vi.fn(async (_url: string): Promise<FetchResult> => ({ kind: "ok", status: 200, body, bytes: body.length, validators: {} }));
    const r = await militaryLaunches.collect({ now: NOW, state: null, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/net__gte=2026-10-22T12:00:00Z/);
    expect(r.events).toHaveLength(12);
    fetch.mockClear();
    expect((await militaryLaunches.collect({ now: NOW + 3_600_000, state: r.state, fetch })).notModified).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a failed North Korean launch triggers the Korea indicator', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(LAUNCHES_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    const events = launchEvents([synthetic({ country: 'KP', name: 'Chollima-1 | Malligyong-1 (2)' })], NOW);
    expect(events[0].title).toMatch(/North Korea.*FAILURE/);
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: LAUNCHES_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(defs.find((d) => d.id === 'korean-peninsula.dprk-space-launch')!, events, status, NOW).state).toBe('TRIGGERED');
  });
});
