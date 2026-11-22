// @vitest-environment node
/**
 * Phase 25: NGA navigational warnings, aircraft emergencies, UCDP conflict events. All sample data is
 * invented for these tests (warning texts in the NGA style, a CSV in the UCDP layout).
 */
import { describe, expect, it } from 'vitest';
import { classifyWarning, parseIssueDate, parsePositions, readWarning, warningsFromBody } from '../../shared/domain/navWarnings.ts';
import { isNotableEmergency, parseEmergencies } from '../../shared/domain/aircraftEmergencies.ts';
import { latestCandidate, parseCsv, readCandidate } from '../../shared/domain/conflictEvents.ts';
import { isRoutineRecord } from '../../shared/domain/routine.ts';
import { ngaMsi, NGA_EVERY_MS } from '../adapters/ngaMsi.ts';
import { adsbEmergencies } from '../adapters/adsbEmergencies.ts';
import { ucdp } from '../adapters/ucdp.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-22T06:00:00Z');
const ok = (body: string): FetchResult => ({ kind: 'ok', status: 200, body, validators: {}, bytes: body.length });

describe('navigational warnings', () => {
  it('reads NGA dates and degree-minute positions', () => {
    expect(parseIssueDate('201530Z NOV 2026')).toBe('2026-11-20T15:30:00.000Z');
    expect(parseIssueDate('garbage')).toBeNull();
    expect(parsePositions('AREA BOUNDED BY 24-54.89N 052-21.66E, 25-10N 053-00E AND 01-30S 105-15W.')).toEqual([
      [24.9148, 52.361],
      [25.1667, 53],
      [-1.5, -105.25],
    ]);
  });

  it('classifies the notable kinds and leaves the rest as other', () => {
    expect(classifyWarning('MISSILE FIRING OPERATIONS IN AREA BOUNDED BY')).toBe('missile');
    expect(classifyWarning('HAZARDOUS OPERATIONS, ROCKET LAUNCHING, SPACE DEBRIS')).toBe('missile');
    expect(classifyWarning('GUNNERY EXERCISES WITHIN 5 MILES OF')).toBe('firing');
    expect(classifyWarning('NAVAL EXERCISE IN PROGRESS')).toBe('exercise');
    expect(classifyWarning('GPS INTERFERENCE REPORTED IN VICINITY OF')).toBe('gnss');
    expect(classifyWarning('ARMED ROBBERY: VESSEL BOARDED AT ANCHOR')).toBe('piracy');
    expect(classifyWarning('CABLE OPERATIONS BY CABLE SHIP')).toBe('cable');
    expect(classifyWarning('LIGHT UNLIT. LIGHTED BUOY MISSING.')).toBe('other');
  });

  it('accepts the documented wrapper and builds keys, centres and regions', () => {
    const raw = warningsFromBody({ 'broadcast-warn': [{ msgYear: 2026, msgNumber: 1234, navArea: 'P', text: 'SEA OF JAPAN. MISSILE FIRING IN AREA 40-00N 130-00E, 40-00N 133-00E, 38-00N 133-00E.', issueDate: '201530Z NOV 2026', status: 'A' }] });
    const w = readWarning(raw[0])!;
    expect(w.key).toBe('HYDROPAC 1234/26');
    expect(w.kind).toBe('missile');
    expect(w.lat).toBeCloseTo(39.333, 2); // centre at 132°E is outside the Korea box; one corner is inside
    expect(w.regionIds).toContain('korean-peninsula');
    expect(readWarning({ msgNumber: 'x', text: '' })).toBeNull();
  });

  it('records each notable warning once and reads only every 3 hours', async () => {
    const body = JSON.stringify({
      'broadcast-warn': [
        { msgYear: 2026, msgNumber: 1, navArea: '4', text: 'EASTERN MEDITERRANEAN. GUNNERY EXERCISES WITHIN 10 MILES OF 33-50N 033-20E.', issueDate: '210800Z NOV 2026' },
        { msgYear: 2026, msgNumber: 2, navArea: '4', text: 'LIGHT UNLIT AT 33-00N 034-00E.', issueDate: '210800Z NOV 2026' },
      ],
    });
    const seen: string[] = [];
    const fetch = async (url: string) => (seen.push(url), ok(body));
    const r1 = await ngaMsi.collect({ now: NOW, state: null, fetch });
    expect(r1.events.map((e) => e.title)).toEqual([expect.stringMatching(/^NAVAREA IV 1\/26: live firing or hazardous operations — EASTERN MEDITERRANEAN/)]);
    expect(r1.state.warnings).toHaveLength(1);
    expect(r1.state.activeTotal).toBe(2);
    const r2 = await ngaMsi.collect({ now: NOW + 60_000, state: r1.state, fetch });
    expect(r2.notModified).toBe(true);
    const r3 = await ngaMsi.collect({ now: NOW + NGA_EVERY_MS + 1, state: r1.state, fetch });
    expect(r3.events).toHaveLength(0);
    expect(seen).toHaveLength(2);
  });
});

describe('aircraft emergencies', () => {
  const ac = (p: Record<string, unknown>) => JSON.stringify({ ac: [{ hex: 'ABC123', flight: 'TEST12 ', t: 'B738', lat: 33.5, lon: 36.2, alt_baro: 30000, seen_pos: 3, ...p }] });

  it('parses positions and drops ground or stale reports', () => {
    expect(parseEmergencies(ac({ squawk: '7700' }), '7700')[0]).toMatchObject({ hex: 'abc123', cs: 'TEST12', sq: '7700', mil: false, regionIds: ['middle-east'] });
    expect(parseEmergencies(ac({ squawk: '7700', alt_baro: 'ground' }), '7700')).toHaveLength(0);
    expect(parseEmergencies(ac({ squawk: '7700', seen_pos: 900 }), '7700')).toHaveLength(0);
    expect(parseEmergencies(ac({ squawk: '7700', dbFlags: 1 }), '7700')[0].mil).toBe(true);
  });

  it('shows military, hijack codes and watch regions abroad; hides other civil emergencies as routine', async () => {
    expect(isNotableEmergency({ mil: false, sq: '7700', regionIds: [] })).toBe(false);
    expect(isNotableEmergency({ mil: false, sq: '7700', regionIds: ['united-states'] })).toBe(false);
    expect(isNotableEmergency({ mil: false, sq: '7500', regionIds: [] })).toBe(true);
    expect(isNotableEmergency({ mil: true, sq: '7700', regionIds: [] })).toBe(true);
    const fetch = async (url: string) => ok(url.endsWith('7700') ? ac({ squawk: '7700', lat: 51, lon: -30 }) : JSON.stringify({ ac: [] }));
    const r1 = await adsbEmergencies.collect({ now: NOW, state: null, fetch });
    expect(r1.events).toHaveLength(1);
    expect(isRoutineRecord(r1.events[0])).toBe(true);
    // Not recorded again within 12 hours.
    expect((await adsbEmergencies.collect({ now: NOW + 3_600_000, state: r1.state, fetch })).events).toHaveLength(0);
    expect((await adsbEmergencies.collect({ now: NOW + 13 * 3_600_000, state: r1.state, fetch })).events).toHaveLength(1);
  });
});

describe('UCDP conflict events', () => {
  const HEAD = 'id,relid,year,type_of_violence,side_a,side_b,source_headline,where_prec,latitude,longitude,country,date_start,best';
  const row = (id: number, ty: number, prec: number, la: number, lo: number, date: string, best: number) => `${id},X-${id},2026,${ty},"Side ""A""",Side B,"Invented headline, with comma",${prec},${la},${lo},Testland,${date} 00:00:00.000,${best}`;
  const CSV = [HEAD, row(1, 1, 1, 48.0, 37.8, '2026-10-03', 12), row(2, 3, 6, 48.5, 35.0, '2026-10-05', 2), row(3, 1, 1, -10, -60, '2026-10-06', 4), row(4, 2, 1, 48.1, 37.9, '2026-08-01', 50), row(5, 2, 1, 26.0, -100.3, '2026-10-07', 3)].join('\r\n');

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,"b ""c"", d"\r\n1,2\n')).toEqual([['a', 'b "c", d'], ['1', '2']]);
  });

  it('finds the newest monthly candidate file', () => {
    const html = '<a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_9.csv">x</a><a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_10.csv">y</a><a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_09.csv">z</a>';
    expect(latestCandidate(html)).toEqual({ release: '26.0.10', month: '2026-10', url: 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_10.csv' });
  });

  it('keeps the month in watch regions, maps only located events, and stores no headlines', () => {
    const r = readCandidate(CSV, '2026-10');
    expect(r.worldEvents).toBe(4); // the August revision is not this month
    expect(r.regions.find((t) => t.regionId === 'united-states')).toBeUndefined(); // Testland inside the US box is not the US
    expect(r.regions.find((t) => t.regionId === 'eastern-europe')).toMatchObject({ events: 2, deaths: 14, deathsByType: [12, 0, 2] });
    expect(r.events.map((e) => e.id)).toEqual([1]); // country-level (precision 6) and outside regions are not mapped
    expect(JSON.stringify(r)).not.toContain('headline');
    expect(r.events[0].a).toBe('Side "A"');
  });

  it('reads a new release once and writes one record per region', async () => {
    const page = '<a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_10.csv">csv</a>';
    const fetch = async (url: string) => ok(url.endsWith('.csv') ? CSV : page);
    const r1 = await ucdp.collect({ now: NOW, state: null, fetch });
    expect(r1.events.map((e) => e.title)).toEqual([expect.stringMatching(/^UCDP: 2 conflict events and 14 deaths \(best estimate\) in .*October 2026$/)]);
    expect(r1.events[0].summary).toContain('CC BY 4.0');
    const r2 = await ucdp.collect({ now: NOW + 13 * 3_600_000, state: r1.state, fetch });
    expect(r2.events).toHaveLength(0);
    expect(r2.notModified).toBe(true);
  });
});
