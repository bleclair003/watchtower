// @vitest-environment node
/**
 * UN Security Council. Fixtures are real responses captured 2026-11-21: the latest 30 meeting
 * records and 12 voting records from the UN Digital Library (MARC XML), and the UN press RSS.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FetchResult } from '../lib/http.ts';
import { UNSC_MEETINGS_URL, UNSC_SOURCE_ID, UNSC_VOTES_URL, UN_PRESS_URL, failedDraftEvents, meetingEvents, parseMeetings, parseVotes, unCountry, unSecurityCouncil, voteEvents } from '../adapters/unsc.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';
import { evaluateIndicator } from '../../shared/domain/indicators/evaluate.ts';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const nowIso = new Date(NOW).toISOString();
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, bytes: b.length, validators: {} });
const meetingsXml = fx('unsc-meetings.sample.xml');
const votesXml = fx('unsc-votes.sample.xml');
const pressXml = fx('un-press.sample.xml');

describe('meetings (real Digital Library records)', () => {
  const meetings = parseMeetings(meetingsXml);

  it('reads symbol, date, agenda, closed flag and countries', () => {
    expect(meetings).toHaveLength(30);
    const somalia = meetings.find((m) => m.symbol === 'S/PV.10274')!;
    expect(somalia).toMatchObject({ date: '2026-11-17', agenda: 'The situation in Somalia', closed: true, countries: ['SO'] });
    const iran = meetings.find((m) => m.symbol === 'S/PV.10253')!;
    expect(iran.countries).toEqual(['IR']); // "IRAN (ISLAMIC REPUBLIC OF)" in the subjects
    const ukraine = meetings.find((m) => m.symbol === 'S/PV.10237')!;
    expect(ukraine.countries).toEqual(expect.arrayContaining(['UA', 'RU']));
    expect(meetings.find((m) => m.symbol === 'S/PV.10251')!.countries).toEqual([]); // thematic: children and armed conflict
  });

  it('maps UN country names', () => {
    expect(unCountry('IRAN (ISLAMIC REPUBLIC OF)')).toBe('IR');
    expect(unCountry('SYRIAN ARAB REPUBLIC')).toBe('SY');
    expect(unCountry('RUSSIAN FEDERATION')).toBe('RU');
    expect(unCountry("DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA")).toBe('KP');
    expect(unCountry('TERRITORIES OCCUPIED BY ISRAEL')).toBe('PS');
    expect(unCountry('PEACEKEEPING OPERATIONS')).toBeNull();
  });

  it('records each meeting once, tagged to watch regions', () => {
    const events = meetingEvents(meetings, nowIso);
    for (const e of events) expect(validateEvent(e, NOW)).toBeNull();
    const ua = events.find((e) => e.metadata?.symbol === 'S/PV.10237')!;
    expect(ua.title).toBe('UN Security Council meeting (S/PV.10237): Maintenance of peace and security of Ukraine');
    expect(ua.regionIds).toEqual(['eastern-europe']);
    const closed = events.find((e) => e.metadata?.symbol === 'S/PV.10274')!;
    expect(closed.title).toMatch(/^UN Security Council closed meeting/);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });
});

describe('resolutions (real voting records)', () => {
  it('reads tallies and who voted against or abstained', () => {
    const votes = parseVotes(votesXml);
    const haiti = votes.find((v) => v.symbol === 'S/RES/2829(2026)')!;
    expect(haiti).toMatchObject({ yes: 12, no: 0, abstain: 3 });
    expect(haiti.against.map((a) => a.name)).toEqual(['CHINA', 'PAKISTAN', 'RUSSIAN FEDERATION']);
    expect(haiti.against.find((a) => a.name === 'CHINA')!.permanent).toBe(true);
    const events = voteEvents(votes, parseMeetings(meetingsXml), nowIso);
    const yemen = events.find((e) => e.metadata?.symbol === 'S/RES/2837(2026)')!;
    expect(yemen.title).toMatch(/^UN Security Council adopts resolution 2837\(2026\) \(15-0-0\): on renewal of sanctions against Yemen/);
    expect(yemen.countryCodes).toEqual(['YE']);
    const libya = events.find((e) => e.metadata?.symbol === 'S/RES/2835(2026)')!;
    expect(libya.summary).toMatch(/Greece abstained, Russian Federation abstained/);
    expect(libya.metadata?.divided).toBe(true);
  });
});

describe('failed drafts and vetoes (press releases)', () => {
  const item = (title: string, desc: string, date = 'Thu, 19 Nov 2026 16:02:00 -0500') =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>UN</title><item><title>${title}</title><link>https://press.un.org/en/2026/sc99999.doc.htm</link><description>${desc}</description><pubDate>${date}</pubDate></item></channel></rss>`;

  it('ignores ordinary press releases (real feed)', () => {
    expect(failedDraftEvents(pressXml, nowIso, NOW - 45 * 86_400_000)).toEqual([]);
  });

  it('records a failed draft and names the permanent member that voted against', () => {
    const [e] = failedDraftEvents(
      item('Security Council Fails to Adopt Resolution on Ceasefire in Gaza, Owing to Negative Vote by United States', 'The Security Council failed to adopt a draft resolution owing to the negative vote of the United States, a permanent member.'),
      nowIso,
      NOW - 45 * 86_400_000,
    );
    expect(e.title).toMatch(/^Security Council Fails to Adopt/);
    expect(e.metadata).toMatchObject({ subtype: 'unsc-failed-draft', veto: true, vetoBy: ['United States'] });
    expect(e.regionIds).toEqual(['middle-east']);
    expect(validateEvent(e, NOW)).toBeNull();
  });
});

describe('adapter and indicators', () => {
  it('reads three endpoints at most every 2 hours', async () => {
    const fetch = vi.fn(async (url: string) => ok(url === UNSC_MEETINGS_URL ? meetingsXml : url === UNSC_VOTES_URL ? votesXml : url === UN_PRESS_URL ? pressXml : ''));
    const r = await unSecurityCouncil.collect({ now: NOW, state: null, fetch });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(r.events.length).toBeGreaterThan(20);
    fetch.mockClear();
    const soon = await unSecurityCouncil.collect({ now: NOW + 3_600_000, state: r.state, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(soon.notModified).toBe(true);
  });

  it('indicators are valid; a failed draft triggers the region', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(UNSC_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.length).toBe(12);
    const events = failedDraftEvents(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>UN</title><item><title>Security Council Fails to Adopt Draft on Ukraine, as Russian Federation Casts Veto</title><link>https://press.un.org/en/2026/sc1.doc.htm</link><description>The Russian Federation cast a veto.</description><pubDate>Thu, 19 Nov 2026 16:02:00 -0500</pubDate></item></channel></rss>`,
      nowIso,
      NOW - 45 * 86_400_000,
    );
    const iso = (t: number) => new Date(t).toISOString();
    const status = [{ sourceId: UNSC_SOURCE_ID, health: 'ONLINE' as const, lastAttemptAt: iso(NOW), lastSuccessAt: iso(NOW), firstSuccessAt: iso(NOW - 864e5), lastNewItemAt: iso(NOW), consecutiveFailures: 0, parseErrors: 0, lastError: null }];
    expect(evaluateIndicator(defs.find((d) => d.id === 'eastern-europe.unsc-failed-draft')!, events, status, NOW).state).toBe('TRIGGERED');
  });
});
