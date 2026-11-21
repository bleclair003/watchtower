// @vitest-environment node
/** Phase 17: FAA flight restrictions, airport status, notices for US flights abroad, and the airspace meter. */
import { describe, expect, it } from 'vitest';
import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import type { MeterInput } from '../../shared/domain/meters/input.ts';
import { isAirspaceHeadline, isNotableCondition, noticeKind, tfrActive, tfrTime, type AirportStatusSnapshot, type AirspaceNoticesSnapshot } from '../../shared/domain/faa.ts';
import { airportEventRecords, buildTfrSnapshot, faaAirspaceNotices, parseAirportEvents, parseNoticesPage, parseTfrDetail, tfrOutlines } from '../adapters/faa.ts';
import { airspaceMeter } from '../../shared/domain/meters/airspace.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-21T22:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, validators: {}, bytes: body.length });

describe('flight restrictions', () => {
  it('parses the detail page and UTC times', () => {
    const cell = (label: string, value: string) => `<TD><font face="Arial" size="2">${label} : </font></TD><TD><font face="Arial" size="2">${value}</font></TD>`;
    const html = [cell('Location', 'Middleburg, Virginia near ARMEL VOR/DME (AML)'), cell('Beginning Date and Time', 'November 21, 2026 at 1830 UTC'), cell('Ending Date and Time', 'November 22, 2026 at 2300 UTC'), cell('Reason for NOTAM', 'Temporary flight restrictions for VIP Movement'), cell('Altitude', 'From the surface up to and including 4999 feet AGL')].join('');
    expect(parseTfrDetail(html)).toEqual({ start: '2026-11-21T18:30:00.000Z', end: '2026-11-22T23:00:00.000Z', reason: 'Temporary flight restrictions for VIP Movement', altitude: 'From the surface up to and including 4999 feet AGL', location: 'Middleburg, Virginia near ARMEL VOR/DME (AML)' });
    expect(tfrTime('November 23, 2026 UTC')).toBe('2026-11-23T00:00:00.000Z');
    expect(tfrTime('November 23, 2026 at 0900 Local')).toBeNull();
    expect(parseTfrDetail('<p>nothing</p>').start).toBeNull();
  });

  it('is active inside its times, or always without times', () => {
    expect(tfrActive({ start: iso(NOW - 1000), end: iso(NOW + 1000) }, NOW)).toBe(true);
    expect(tfrActive({ start: iso(NOW + 1000), end: null }, NOW)).toBe(false);
    expect(tfrActive({ start: null, end: null }, NOW)).toBe(true);
  });

  it('builds outlines by NOTAM id and keeps VIP first', () => {
    const square = { type: 'Polygon', coordinates: [[[-77, 38], [-76, 38], [-76, 39], [-77, 39], [-77, 38]]] };
    const outlines = tfrOutlines([{ properties: { NOTAM_KEY: '6/9141-1-FDC-F' }, geometry: square }, { properties: { NOTAM_KEY: 'junk' }, geometry: square }]);
    expect([...outlines.keys()]).toEqual(['6/9141']);
    const snap = buildTfrSnapshot(
      [{ notam: '6/0001', type: 'SECURITY', title: 'A', state: 'FL' }, { notam: '6/9141', type: 'VIP', title: 'B', state: 'VA' }],
      { '6/9141': { start: iso(NOW), end: null, reason: 'VIP', altitude: null, location: 'Middleburg' } },
      outlines,
      iso(NOW),
    );
    expect(snap.items.map((t) => [t.notam, t.title, !!t.path])).toEqual([['6/9141', 'Middleburg', true], ['6/0001', 'A', false]]);
  });
});

describe('airport status', () => {
  const rows = [
    { airportId: 'EWR', airportLongName: 'Newark Liberty International', latitude: '40.6925', longitude: '-74.1687', groundStop: { impactingCondition: 'equipment / outage', startTime: '2026-11-21T21:30:00Z', endTime: '2026-11-21T23:00:00Z', advisoryUrl: 'https://www.fly.faa.gov/adv/x' } },
    { airportId: 'YYZ', airportLongName: 'Toronto Pearson International Airport', latitude: '43.678', longitude: '-79.63', groundStop: { impactingCondition: 'fog', startTime: '2026-11-21T22:20:00Z' } },
    { airportId: 'FLL', airportLongName: 'Fort Lauderdale', latitude: '26.07', longitude: '-80.15', departureDelay: { reason: 'WX:Thunderstorms', arrivalDeparture: { min: '45 minutes', max: '59 minutes' } } },
  ];

  it('flattens events and flags causes other than weather, volume or runway work', () => {
    const ev = parseAirportEvents(rows);
    expect(ev.map((e) => [e.code, e.kind, e.notable])).toEqual([['EWR', 'ground-stop', true], ['YYZ', 'ground-stop', false], ['FLL', 'departure-delay', false]]);
    expect(ev[2].delay).toBe('45 minutes–59 minutes');
    expect(isNotableCondition('TM Initiatives:MIT:WX')).toBe(false);
    expect(isNotableCondition('VOL:Volume')).toBe(false);
    expect(isNotableCondition('security')).toBe(true);
  });

  it('records only notable ground stops and delay programs, at the FAA airport position', () => {
    const recs = airportEventRecords(parseAirportEvents(rows), iso(NOW));
    expect(recs).toHaveLength(1);
    expect(recs[0].title).toBe('FAA ground stop — Newark Liberty International (EWR): equipment / outage');
    expect([recs[0].latitude, recs[0].longitude, recs[0].locationPrecision]).toEqual([40.6925, -74.1687, 'exact']);
    expect(recs[0].regionIds).toEqual(['united-states']);
  });
});

describe('notices for US flights abroad', () => {
  const page = (extra = '') => `<main><h2>Alphabetical List by Country</h2><h2>United States</h2><a href="/media/1">Routing</a>
    <h2>Iran&nbsp;</h2><a href="/doc/SFAR-117.pdf">Special Federal Aviation Regulation (SFAR) 117 — Prohibition Against Certain Flights in the Tehran FIR</a>
    <h2>Persian Gulf and Gulf of Oman</h2><a href="media/KICZ_A0016-20_Advisory.pdf">KICZ NOTAM A0016/20 — Security — Advisory for Overwater Airspace</a>${extra}
    <h2>Iraq</h2><a href="/doc/SFAR_77.pdf">SFAR 77 - Prohibition</a><h2>Syria</h2><a href="/doc/s.pdf">Syria Pointer</a><h2>Yemen</h2><a href="/doc/y.pdf">Sanaa Pointer</a>
    <h2>U.S. Department of Transportation</h2><a href="/x.pdf">Footer</a></main>`;

  it('parses sections and documents, skipping domestic and footer sections', () => {
    const s = parseNoticesPage(page());
    expect(s.map((x) => x.name)).toEqual(['Iran', 'Persian Gulf and Gulf of Oman', 'Iraq', 'Syria', 'Yemen']);
    expect(s[0].docs[0].url).toBe('https://www.faa.gov/doc/SFAR-117.pdf');
    expect(noticeKind(s[1].docs[0].title)).toBe('advisory');
  });

  it('treats documents present at the start as standing, and records ones that appear later', async () => {
    const first = await faaAirspaceNotices.collect({ now: NOW, state: null, fetch: async () => ok(page()) });
    expect(first.events).toHaveLength(0);
    const iran = first.state!.latest!.areas[0];
    expect([iran.code, iran.regionIds, iran.level, iran.docs[0].firstSeen]).toEqual(['IR', ['middle-east'], 'prohibition', null]);
    const later = await faaAirspaceNotices.collect({
      now: NOW + 4 * 3_600_000,
      state: first.state!,
      fetch: async () => ok(page('<a href="media/KICZ_A0060-26_Advisory.pdf">KICZ NOTAM A0060/26 — Advisory for Gulf airspace</a>')),
    });
    expect(later.events.map((e) => [e.title, e.regionIds])).toEqual([['FAA notice for US flights — Persian Gulf and Gulf of Oman: KICZ NOTAM A0060/26 — Advisory for Gulf airspace', ['middle-east']]]);
    // Within 3 hours the page is not read again.
    const soon = await faaAirspaceNotices.collect({ now: NOW + 3_600_000, state: first.state!, fetch: async () => ok('') });
    expect(soon.notModified).toBe(true);
  });
});

describe('airspace headlines', () => {
  it('matches closures, suspended flights and GPS jamming', () => {
    for (const t of ['Iran closes its airspace after strikes', 'Airlines suspend flights to Tel Aviv', 'GPS jamming disrupts Baltic flights', 'Flights cancelled as airspace closed over Qatar'])
      expect(isAirspaceHeadline(t), t).toBe(true);
    for (const t of ['New airport terminal opens in Dubai', 'Pilot shortage hits regional airlines']) expect(isAirspaceHeadline(t), t).toBe(false);
  });
});

let n = 0;
function ev(title: string, hoursAgo: number, p: Partial<IntelligenceEvent> = {}): IntelligenceEvent {
  const id = `a${++n}`;
  return {
    id, contentHash: id, dataOrigin: 'live', sourceId: 'bbc-world', sourceName: 'BBC', sourceClass: 'media', sourceUrl: `https://example.test/${id}`,
    title, category: 'general', regionIds: ['middle-east'], countryCodes: [], publishedAt: iso(NOW - hoursAgo * 3_600_000), occurredAt: null, collectedAt: iso(NOW - hoursAgo * 3_600_000),
    credibility: 'single-source', verificationStatus: 'unreviewed', locationPrecision: 'country', ...p,
  };
}
const input = (events: IntelligenceEvent[], extra: Partial<MeterInput> = {}): MeterInput => ({ now: NOW, events, historyStart: NOW - 2 * 86_400_000, sourceStatus: [], regionScores: [], scoreHistory: [], ...extra });

describe('airspace meter', () => {
  const notices: AirspaceNoticesSnapshot = {
    fetchedAt: iso(NOW), trackingSince: iso(NOW - 30 * 86_400_000),
    areas: [
      { name: 'Iran', code: 'IR', regionIds: ['middle-east'], level: 'prohibition', docs: [{ title: 'SFAR 117', url: 'u1', kind: 'regulation', firstSeen: null }] },
      { name: 'Persian Gulf and Gulf of Oman', code: null, regionIds: ['middle-east'], level: 'advisory', docs: [{ title: 'KICZ advisory', url: 'u2', kind: 'advisory', firstSeen: iso(NOW - 2 * 86_400_000) }] },
    ],
  };

  it('scores new FAA notices and airspace headlines abroad; standing bans are context only', () => {
    expect(airspaceMeter(input([], { airspaceNotices: { ...notices, areas: [notices.areas[0]] } }), 'middle-east').label).toBe('QUIET');
    const heads = ['Iran closes its airspace', 'Airlines suspend flights to Tehran'].map((t, i) => ev(t, 3, { sourceId: i ? 'aljazeera' : 'bbc-world', category: 'aviation' }));
    const m = airspaceMeter(input(heads, { airspaceNotices: notices }), 'middle-east');
    expect(m.value).toBe(5); // new notice 3 + two publishers 2
    expect(m.label).toBe('ELEVATED');
    expect(m.components[1].value).toBe('Iran (prohibition), Persian Gulf and Gulf of Oman (advisory)');
  });

  it('scores US ground stops not caused by weather, and many at once', () => {
    const base = { name: 'X', lat: 40, lon: -74, start: null, end: null, delay: null, url: null };
    const status: AirportStatusSnapshot = { fetchedAt: iso(NOW - 600_000), events: [{ ...base, code: 'EWR', kind: 'ground-stop', condition: 'equipment / outage', notable: true }, { ...base, code: 'JFK', kind: 'ground-stop', condition: 'fog', notable: false }] };
    const m = airspaceMeter(input([], { airportStatus: status }), 'united-states');
    expect(m.value).toBe(2);
    expect(m.label).toBe('GUARDED');
    const many = { ...status, events: Array.from({ length: 9 }, (_, i) => ({ ...base, code: `A${i}A`, kind: 'ground-stop' as const, condition: 'WX', notable: false })) };
    expect(airspaceMeter(input([], { airportStatus: many }), 'united-states').value).toBe(3);
    expect(airspaceMeter(input([], { airportStatus: { ...status, fetchedAt: iso(NOW - 5 * 3_600_000) } }), 'united-states').components[1].value).toBe('no recent reading');
  });
});
