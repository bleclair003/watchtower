// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { stateTravelAdvisories, parseAdvisoryTitle, type StateAdvisoryState } from '../adapters/stateTravelAdvisories.ts';
import { cisaAdvisories, cisaSubtype } from '../adapters/cisaAdvisories.ts';
import { cisaKev } from '../adapters/cisaKev.ts';
import { validateEvent } from '../lib/validate.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-20T12:00:00Z');
const okFetch = (body: string) => vi.fn(async (): Promise<FetchResult> => ({ kind: 'ok', status: 200, body, bytes: body.length, validators: { etag: '"v1"' } }));

describe('State Dept travel advisories adapter', () => {
  const xml = fixture('state-advisories.sample.xml');

  it('parses advisory titles', () => {
    expect(parseAdvisoryTitle('Yemen - Level 4: Do Not Travel')).toEqual({ name: 'Yemen', level: 4, label: 'Do Not Travel' });
    expect(parseAdvisoryTitle('Mexico Travel Advisory - Level 2: Exercise Increased Caution')?.name).toBe('Mexico');
    expect(parseAdvisoryTitle('Something else')).toBeNull();
  });

  it('first run: baselines all advisories but imports only recent ones', async () => {
    const r = await stateTravelAdvisories.collect({ now: NOW, state: null, fetch: okFetch(xml) });
    expect(r.itemsSeen).toBe(8);
    expect(Object.keys(r.state.advisories)).toHaveLength(8);
    // Only the 23 Oct 2026 advisories fall inside the 30-day first-run window.
    expect(r.events.map((e) => e.countryCodes[0]).sort()).toEqual(['IL', 'IR', 'YE']);
    const yemen = r.events.find((e) => e.countryCodes[0] === 'YE')!;
    expect(yemen).toMatchObject({
      title: 'Yemen — Level 4: Do Not Travel',
      regionIds: ['red-sea'],
      locationPrecision: 'country',
      credibility: 'official',
      dataOrigin: 'live',
      publishedAt: '2026-10-23T00:00:00.000Z',
      metadata: { advisoryLevel: 4, change: 'initial', fipsTag: 'YM' },
    });
    expect(yemen.latitude).toBeUndefined();
    expect(yemen.summary).toMatch(/^Do not travel/);
    for (const e of r.events) expect(validateEvent(e, NOW)).toBeNull();
  });

  it('unchanged feed on a later run produces no events', async () => {
    const first = await stateTravelAdvisories.collect({ now: NOW, state: null, fetch: okFetch(xml) });
    const second = await stateTravelAdvisories.collect({ now: NOW + 3_600_000, state: first.state, fetch: okFetch(xml) });
    expect(second.events).toEqual([]);
  });

  it('detects raised, lowered and reissued advisories against the stored baseline', async () => {
    const first = await stateTravelAdvisories.collect({ now: NOW, state: null, fetch: okFetch(xml) });
    const changed = xml
      .replace('Vietnam - Level 1: Exercise Normal Precautions', 'Vietnam - Level 2: Exercise Increased Caution')
      .replace(/(<title>Vietnam[\s\S]*?<pubDate>)[^<]+/, '$1Fri, 20 Nov 2026')
      .replace('Israel - Level 3: Reconsider Travel', 'Israel - Level 2: Exercise Increased Caution')
      .replace(/(<title>Israel[\s\S]*?<pubDate>)[^<]+/, '$1Fri, 20 Nov 2026')
      .replace(/(<title>Iran[\s\S]*?<pubDate>)[^<]+/, '$1Fri, 20 Nov 2026');
    const r = await stateTravelAdvisories.collect({ now: NOW, state: first.state, fetch: okFetch(changed) });
    const byCc = Object.fromEntries(r.events.map((e) => [e.countryCodes[0], e]));
    expect(Object.keys(byCc).sort()).toEqual(['IL', 'IR', 'VN']);
    expect(byCc.VN.title).toBe('Vietnam — Level 2: Exercise Increased Caution — RAISED from Level 1');
    expect(byCc.VN.metadata).toMatchObject({ change: 'raised', previousLevel: 1, advisoryLevel: 2 });
    expect(byCc.IL.metadata).toMatchObject({ change: 'lowered', previousLevel: 3 });
    expect(byCc.IR.title).toMatch(/reissued, level unchanged$/);
    // Reissue of the same advisory is a different event from the original publication.
    expect(byCc.IR.id).not.toBe(first.events.find((e) => e.countryCodes[0] === 'IR')!.id);
  });

  it('maps Gaza (tagged IS) to PS and leaves French West Indies unmapped', async () => {
    const r = await stateTravelAdvisories.collect({ now: NOW, state: null, fetch: okFetch(xml) });
    const vals = Object.values(r.state.advisories);
    expect(vals.find((a) => a.name === 'Gaza')?.iso).toBe('PS');
    expect(vals.find((a) => a.name === 'French West Indies')?.iso).toBeNull();
  });

  it('passes validators and handles 304 without touching state', async () => {
    const state = { validators: { etag: '"v1"' }, advisories: {}, baselineAt: 'x' } satisfies StateAdvisoryState;
    const fetch = vi.fn(async (): Promise<FetchResult> => ({ kind: 'not-modified', status: 304 }));
    const r = await stateTravelAdvisories.collect({ now: NOW, state, fetch });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('travel.state.gov'), { etag: '"v1"' });
    expect(r).toMatchObject({ notModified: true, events: [], state });
  });
});

describe('CISA advisories adapter', () => {
  it('classifies by URL and labels routine ICS advisories', async () => {
    expect(cisaSubtype('https://www.cisa.gov/news-events/ics-advisories/icsa-26-323-02')).toBe('ics-advisory');
    expect(cisaSubtype('https://www.cisa.gov/news-events/alerts/2026/11/18/x')).toBe('alert');
    expect(cisaSubtype('https://www.cisa.gov/news-events/cybersecurity-advisories/aa26-100a')).toBe('joint-advisory');

    const r = await cisaAdvisories.collect({ now: NOW, state: null, fetch: okFetch(fixture('cisa-advisories.sample.xml')) });
    expect(r.events).toHaveLength(5);
    const ics = r.events[0];
    expect(ics.title).toBe('ICS advisory: Elecbrakes EB2, VM1, ELBC2000');
    expect(ics.metadata).toMatchObject({ subtype: 'ics-advisory', routine: true });
    expect(ics.summary).toMatch(/^Successful exploitation/);
    expect(ics.publishedAt).toBe('2026-11-19T12:00:00.000Z');
    const alert = r.events.find((e) => e.metadata?.subtype === 'alert')!;
    expect(alert.title).not.toMatch(/^Alert:/);
    for (const e of r.events) expect(validateEvent(e, NOW)).toBeNull();
  });

  it('respects the lookback window', async () => {
    const r = await cisaAdvisories.collect({ now: Date.parse('2027-06-01T00:00:00Z'), state: null, fetch: okFetch(fixture('cisa-advisories.sample.xml')) });
    expect(r.events).toHaveLength(0);
    expect(r.itemsSeen).toBe(5);
  });
});

describe('CISA KEV adapter', () => {
  it('imports recent additions only, flags ransomware use, rejects malformed entries', async () => {
    const doc = JSON.parse(fixture('kev.sample.json'));
    doc.vulnerabilities.push({ cveID: 'not-a-cve', dateAdded: '2026-11-18' });
    const r = await cisaKev.collect({ now: NOW, state: null, fetch: okFetch(JSON.stringify(doc)) });
    expect(r.itemsSeen).toBe(7);
    expect(r.events).toHaveLength(4); // the two 2021 entries are outside the window
    expect(r.rejected).toEqual([{ ref: 'not-a-cve', reason: 'invalid CVE id' }]);
    const e = r.events[0];
    expect(e.title).toMatch(/^KEV added: CVE-\d{4}-\d+ — /);
    expect(e.sourceUrl).toMatch(/^https:\/\/www\.cisa\.gov\/known-exploited-vulnerabilities-catalog\?search_api_fulltext=CVE-/);
    expect(r.state.catalogVersion).toBe(doc.catalogVersion);
    for (const ev of r.events) expect(validateEvent(ev, NOW)).toBeNull();
  });

  it('fails loudly on malformed JSON', async () => {
    await expect(cisaKev.collect({ now: NOW, state: null, fetch: okFetch('<html>maintenance</html>') })).rejects.toThrow(/KEV JSON parse failed/);
  });
});
