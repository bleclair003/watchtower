// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { headlineGeo } from '../../shared/domain/geo/domestic.ts';
import { matchUsPlaces } from '../../shared/domain/geo/usPlaces.ts';
import { regionsForExactPoint } from '../geo/countries.ts';
import { faaTfr, dhsNtas, femaDeclarations, tfrDate } from '../adapters/usDomestic.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-21T08:00:00Z');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: {} });

describe('US domestic tagging (headlines are real, 2026-11-20/21)', () => {
  it('a bare "US" is not domestic; a US place, or a US source naming no foreign place, is', () => {
    expect(headlineGeo('US strikes island near Kuwait').usDomestic).toBe(false);
    expect(headlineGeo('Texas execution took over an hour').usBasis).toBe('place');
    expect(headlineGeo('Bomb Experts Test Emerging Technologies at Fort Knox', 'unless-foreign').usStates).toEqual(['KY']);
    expect(headlineGeo('Soldiers Test New Medical Training Program', 'unless-foreign').usBasis).toBe('source');
    expect(headlineGeo('Soldiers Test New Medical Training Program', 'by-place').usDomestic).toBe(false);
  });

  it('US sources reporting from abroad are not domestic', () => {
    expect(headlineGeo('Hegseth Wraps Central, South American Trip by Delivering Anti-Cartel Message', 'unless-foreign').usDomestic).toBe(false);
    expect(headlineGeo('Kadena welcomes first permanently assigned F-15EX Eagle II aircraft', 'unless-foreign').countryCodes).toEqual(['JP']);
    expect(headlineGeo('Hegseth, in Caracas, announces US-Venezuela military partnership agreement', 'unless-foreign').regionIds).not.toContain('united-states');
  });

  it('a domestic target abroad-linked story is in both regions', () => {
    const g = headlineGeo('Trump says US taking very seriously any Iranian plot against Washington');
    expect(g.regionIds.sort()).toEqual(['middle-east', 'united-states']);
  });

  it('ambiguous names are not places', () => {
    expect(matchUsPlaces('Vance meets troops').states).toEqual([]);
    expect(matchUsPlaces('Austin says Pentagon reviewing').states).toEqual(['DC']);
    expect(matchUsPlaces('West Virginia flooding').states).toEqual(['WV']);
  });

  it('exact points use US borders: Alaska and Hawaii count, Mexico and Canada do not', () => {
    expect(regionsForExactPoint(61.2, -149.9)).toEqual(['united-states']);
    expect(regionsForExactPoint(21.3, -157.85)).toEqual(['united-states']);
    expect(regionsForExactPoint(32.5, -117.0)).toEqual([]);
    expect(regionsForExactPoint(43.65, -79.38)).toEqual([]);
  });
});

describe('FAA TFR adapter (real list)', () => {
  it('imports only security, VIP and special restrictions from the last 30 days, with a trimmed place', async () => {
    const r = await faaTfr.collect({ now: NOW, state: null, fetch: vi.fn(async () => ok(fixture('faa-tfr.sample.json'))) });
    expect(r.itemsSeen).toBe(67);
    const types = new Set(r.events.map((e) => e.metadata!.tfrType));
    expect([...types].every((t) => ['SECURITY', 'VIP', 'SPECIAL'].includes(t as string))).toBe(true);
    expect(r.events.every((e) => Date.parse(e.publishedAt!) >= NOW - 31 * 86_400_000)).toBe(true);
    const mayport = r.events.find((e) => /MAYPORT/.test(e.title))!;
    expect(mayport.title).toBe('FAA Security (national defence airspace) flight restriction — MAYPORT, FL');
    expect(mayport.sourceUrl).toBe('https://tfr.faa.gov/tfr3/?page=detail_6_9172');
    expect(mayport).toMatchObject({ regionIds: ['united-states'], countryCodes: ['US'], category: 'military' });
    expect(r.events.every((e) => validateEvent(e, NOW) === null)).toBe(true);
    expect(tfrDate('11/20/2026')).toBe('2026-11-20T00:00:00.000Z');
  });
});

describe('DHS NTAS adapter', () => {
  it('accepts the real empty feed', async () => {
    const r = await dhsNtas.collect({ now: NOW, state: null, fetch: vi.fn(async () => ok(fixture('ntas.sample.xml'))) });
    expect(r).toMatchObject({ events: [], itemsSeen: 0 });
  });

  it('turns an advisory into an event (SYNTHETIC advisory; format read defensively)', async () => {
    const body = `<?xml version="1.0"?><alerts><alert start="2026/11/20 10:00" end="2027/02/20 10:00" type="Bulletin" link="https://www.dhs.gov/ntas/advisory/test"><summary>SYNTHETIC heightened threat environment</summary><details>Details.</details></alert></alerts>`;
    const r = await dhsNtas.collect({ now: NOW, state: null, fetch: vi.fn(async () => ok(body)) });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ title: 'DHS NTAS Bulletin: SYNTHETIC heightened threat environment', regionIds: ['united-states'] });
    expect(validateEvent(r.events[0], NOW)).toBeNull();
    const ind = INDICATOR_CATALOG.find((d) => d.id === 'united-states.ntas-advisory')!;
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: 'dhs-ntas', health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(ind, r.events, status, NOW).state).toBe('TRIGGERED');
  });

  it('rejects a document that is not an NTAS feed', async () => {
    await expect(dhsNtas.collect({ now: NOW, state: null, fetch: vi.fn(async () => ok('<html><body>moved</body></html>')) })).rejects.toThrow(/no <alerts> root/);
  });
});

describe('FEMA adapter (real response)', () => {
  it('keeps one record per declaration with the number of areas', async () => {
    const r = await femaDeclarations.collect({ now: NOW, state: null, fetch: vi.fn(async () => ok(fixture('fema.sample.json'))) });
    expect(r.itemsSeen).toBe(24);
    expect(r.events).toHaveLength(2);
    const fl = r.events.find((e) => (e.metadata!.usStates as string[])[0] === 'FL')!;
    expect(fl.title).toMatch(/^FEMA Major disaster declaration — HURRICANE ISAIAS \(Florida\)$/);
    expect(r.events.every((e) => validateEvent(e, NOW) === null)).toBe(true);
  });
});

describe('US indicators', () => {
  const ev = (title: string, sourceId: string, regionIds = ['united-states']): IntelligenceEvent => ({
    id: `${sourceId}-${title}`.replace(/\W/g, '').slice(0, 32).padEnd(32, '0'), contentHash: `${sourceId}-${title}`, dataOrigin: 'live', sourceId, sourceName: sourceId,
    sourceClass: 'media', sourceUrl: 'https://example.org/', title, category: 'military', regionIds, countryCodes: ['US'],
    publishedAt: new Date(NOW - 3_600_000).toISOString(), occurredAt: null, collectedAt: new Date(NOW).toISOString(),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country',
  });
  const iso = (t: number) => new Date(t).toISOString();
  const status = [{ sourceId: 'war-gov-news', health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: null, consecutiveFailures: 0, parseErrors: 0, lastError: null }];

  it('installation incidents trigger only with two independent sources', () => {
    const def = INDICATOR_CATALOG.find((d) => d.id === 'united-states.installation-incident')!;
    const one = [ev('Shooting reported at Fort Liberty; base on lockdown', 'military-times')];
    expect(evaluateIndicator(def, one, status, NOW).state).toBe('ELEVATED');
    const two = [...one, ev('Army base locked down after shooting at Fort Liberty', 'npr-national')];
    expect(evaluateIndicator(def, two, status, NOW).state).toBe('TRIGGERED');
    expect(evaluateIndicator(def, [ev('Shooting at mall in Ohio', 'npr-national')], status, NOW).state).toBe('NORMAL');
    expect(evaluateIndicator(def, [ev('Shooting reported at Fort Liberty', 'military-times', ['middle-east'])], status, NOW).state).toBe('NORMAL');
  });

  it('National Guard deployments match deployment wording only', () => {
    const def = INDICATOR_CATALOG.find((d) => d.id === 'united-states.guard-deployment')!;
    expect(evaluateIndicator(def, [ev('National Guard deployed to Los Angeles', 'npr-national')], status, NOW).state).toBe('ELEVATED');
    expect(evaluateIndicator(def, [ev('National Guard band performs at parade', 'npr-national')], status, NOW).state).toBe('NORMAL');
  });

  it('State Dept and satellite-fire indicators do not exist for the US', () => {
    const us = INDICATOR_CATALOG.filter((d) => d.regionId === 'united-states').map((d) => d.id);
    expect(us.some((id) => /advisory-raised|advisory-activity|thermal-clusters/.test(id))).toBe(false);
  });
});
