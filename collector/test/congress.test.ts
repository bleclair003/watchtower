// @vitest-environment node
/**
 * Congress.gov. Fixtures are real API responses captured 2026-11-21 with the public demo key:
 * recently updated House and Senate joint resolutions, bills, the committee-meeting list and one
 * meeting (a Senate Commerce hearing, which must not be recorded).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { CONGRESS_KEY_ENV, CONGRESS_SOURCE_ID, classifyMeasure, congress, congressNumber, hearingEvents, measureEvents } from '../adapters/congress.ts';
import { redactSecrets } from '../lib/secrets.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const nowIso = new Date(NOW).toISOString();
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const json = (n: string) => JSON.parse(fx(n));
const bills = [...json('congress-hjres.sample.json').bills, ...json('congress-sjres.sample.json').bills, ...json('congress-bills.sample.json').bills];
afterEach(() => delete process.env[CONGRESS_KEY_ENV]);

describe('classification', () => {
  it('war powers, arms-sale and nuclear disapprovals, NDAA; nothing else', () => {
    expect(classifyMeasure('A joint resolution to direct the removal of United States Armed Forces from hostilities within or against the Islamic Republic of Iran that have not been authorized by Congress.')).toBe('war-powers');
    expect(classifyMeasure('To authorize the use of military force against the Houthis.')).toBe('war-powers');
    expect(classifyMeasure('A joint resolution providing for congressional disapproval of the proposed foreign military sale to the Government of Israel of certain defense articles and services.')).toBe('arms-sale-disapproval');
    expect(classifyMeasure('Disapproving the proposed civilian nuclear cooperation agreement between the United States and Saudi Arabia')).toBe('nuclear-cooperation');
    expect(classifyMeasure('National Defense Authorization Act for Fiscal Year 2027')).toBe('ndaa');
    expect(classifyMeasure('To amend the Internal Revenue Code of 1986 to establish a tax credit for composting.')).toBeNull();
    expect(congressNumber('2026-11-21')).toBe(119);
    expect(congressNumber('2027-02-01')).toBe(120);
  });
});

describe('records (real resolutions)', () => {
  const events = measureEvents(bills, nowIso, '2026-01-01T00:00:00Z');

  it('one per measure and latest action, tagged by country, with floor votes marked', () => {
    const vote = events.find((e) => e.metadata?.measure === 'S.J.Res. 172')!;
    expect(vote.title).toBe('Congress — war powers: S.J.Res. 172 (IR): Motion to discharge Senate Committee on Foreign Relations rejected by Yea-Nay Vote. 47 - 48. Record Vote Number: 174.');
    expect(vote).toMatchObject({ regionIds: ['middle-east'], countryCodes: ['IR'], sourceUrl: 'https://www.congress.gov/bill/119th-congress/senate-joint-resolution/172' });
    expect(vote.metadata?.floorVote).toBe(true);
    expect(validateEvent(vote, NOW)).toBeNull();
    const israel = events.find((e) => e.metadata?.measure === 'S.J.Res. 32')!;
    expect(israel.metadata?.congressKind).toBe('arms-sale-disapproval');
    expect(israel.countryCodes).toEqual(['IL']);
    expect(events.every((e) => e.metadata?.congressKind !== undefined)).toBe(true);
    expect(events.some((e) => /constitution/i.test(e.title))).toBe(false); // constitutional amendments are not recorded
  });

  it('only actions inside the look-back window', () => {
    expect(measureEvents(bills, nowIso, '2026-10-01T00:00:00Z').map((e) => e.metadata?.measure).sort()).toEqual(['S.J.Res. 221']);
  });

  it('hearings only for security committees', () => {
    const commerce = { ...json('congress-meeting-detail.sample.json').committeeMeeting, eventId: '338860' };
    expect(hearingEvents([commerce], nowIso)).toEqual([]);
    const [h] = hearingEvents([{ ...commerce, eventId: '1', title: 'Hearings to examine the situation in Ukraine.', committees: [{ name: 'Senate Armed Services' }] }], nowIso);
    expect(h.title).toBe('Senate Armed Services hearing (2026-12-01): Hearings to examine the situation in Ukraine.');
    expect(h.regionIds).toEqual(['eastern-europe']);
  });
});

describe('adapter', () => {
  it('sends the key in a header, never in the URL, and reads only new meetings', async () => {
    process.env[CONGRESS_KEY_ENV] = 'congTESTkey789';
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fetch = vi.fn(async (url: string, _v?: unknown, headers?: Record<string, string>): Promise<FetchResult> => {
      calls.push({ url, headers });
      const body = url.includes('/hjres') ? fx('congress-hjres.sample.json') : url.includes('/sjres') ? fx('congress-sjres.sample.json') : url.includes('/bill?') ? fx('congress-bills.sample.json') : /committee-meeting\/119\?/.test(url) ? fx('congress-meetings.sample.json') : fx('congress-meeting-detail.sample.json');
      return { kind: 'ok', status: 200, body, bytes: body.length, validators: {} };
    });
    const r = await congress.collect({ now: NOW, state: null, fetch: fetch as never });
    expect(calls.every((c) => !c.url.includes('congTESTkey789') && c.headers?.['X-Api-Key'] === 'congTESTkey789')).toBe(true);
    expect(redactSecrets('error congTESTkey789')).not.toContain('congTESTkey789');
    expect(calls.filter((c) => /committee-meeting\/119\/(house|senate)\//.test(c.url)).length).toBe(12); // capped
    // Every action in the fixture is older than the 30-day look-back, and the one meeting is a Commerce hearing.
    expect(r.events).toEqual([]);
    expect(r.itemsSeen).toBeGreaterThan(50);
    calls.length = 0;
    expect((await congress.collect({ now: NOW + 3_600_000, state: r.state, fetch: fetch as never })).notModified).toBe(true);
    expect(calls).toEqual([]);
    expect(congress.requiredEnv).toEqual([CONGRESS_KEY_ENV]);
  });

  it('indicators: two war-powers actions on a region trigger', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(CONGRESS_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(12);
    const recent = measureEvents(bills.map((b: { latestAction?: { actionDate?: string } }) => ({ ...b, latestAction: { ...b.latestAction, actionDate: '2026-11-10' } })) as never, nowIso, '2026-10-22T00:00:00Z');
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: CONGRESS_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(defs.find((d) => d.id === 'middle-east.congress-war-powers')!, recent, status, NOW).state).toBe('TRIGGERED');
  });
});
