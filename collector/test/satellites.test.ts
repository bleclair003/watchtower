import { describe, expect, it } from 'vitest';
import { orbitShape, parseGpCsv, satGroupUrl } from '../../shared/domain/satellites.ts';
import { satellites, type SatellitesState } from '../adapters/satellites.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const H = 3_600_000;
const HEAD = 'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';
const row = (name: string, id: number, n = 15.5) => `${name},2026-001A,2026-11-24T03:58:32.279232,${n},.0005414,98.1126,95.2765,246.5791,113.4899,0,U,${id},999,8188,.41331E-3,.45328E-3,0`;
const csv = (...rows: string[]) => [HEAD, ...rows].join('\r\n') + '\r\n';

describe('satellite elements', () => {
  it('parses GP CSV and drops rows with bad numbers', () => {
    const els = parseGpCsv(csv(row('INVENTED SAT 1', 900001), 'BROKEN,2026-002A,2026-11-24T00:00:00,abc,.1,1,1,1,1,0,U,900002,1,1,0,0,0', row('INVENTED SAT 3', 900003, 0)));
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ OBJECT_NAME: 'INVENTED SAT 1', NORAD_CAT_ID: 900001, MEAN_MOTION: 15.5, BSTAR: 0.00041331, CLASSIFICATION_TYPE: 'U' });
    expect(() => parseGpCsv('A,B\n1,2')).toThrow(/unexpected columns/);
  });

  it('works out the orbit shape', () => {
    const leo = orbitShape({ MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005 });
    expect(leo.periodMin).toBeCloseTo(92.9, 0);
    expect(leo.perigeeKm).toBeGreaterThan(380);
    expect(leo.apogeeKm).toBeLessThan(450);
    const geo = orbitShape({ MEAN_MOTION: 1.0027, ECCENTRICITY: 0 });
    expect(Math.round(geo.perigeeKm / 100)).toBe(358);
  });
});

describe('CelesTrak adapter', () => {
  it('reads both groups, then waits 12 hours; after a failure it waits too and keeps the elements', async () => {
    const urls: string[] = [];
    const ok = async (url: string) => {
      urls.push(url);
      const body = url.includes('military') ? csv(row('INVENTED MIL', 900010)) : csv(row('INVENTED IMG 1', 900020), row('INVENTED IMG 2', 900021));
      return { kind: 'ok' as const, status: 200, body, validators: { etag: `"${url.length}"` }, bytes: body.length };
    };
    const first = await satellites.collect({ now: NOW, state: null, fetch: ok });
    expect(urls).toEqual([satGroupUrl('military'), satGroupUrl('resource')]);
    expect(first.events).toEqual([]);
    expect(first.state.latest?.groups.map((g) => [g.id, g.count])).toEqual([['military', 1], ['resource', 2]]);
    expect(first.note).toBe('military 1, resource 2');

    const soon = await satellites.collect({ now: NOW + 6 * H, state: first.state, fetch: ok });
    expect(urls).toHaveLength(2);
    expect(soon.notModified).toBe(true);

    let calls = 0;
    const refused = async () => {
      calls++;
      throw new Error('HTTP 403 from celestrak.org');
    };
    const failed = await satellites.collect({ now: NOW + 13 * H, state: first.state, fetch: refused });
    expect(calls).toBe(1);
    expect(failed.note).toMatch(/read failed \(HTTP 403.*next try in 12 h/);
    expect((failed.state as SatellitesState).latest).toEqual(first.state.latest);
    // Within 12 hours of the failure: no request at all.
    const after = await satellites.collect({ now: NOW + 20 * H, state: failed.state, fetch: refused });
    expect(calls).toBe(1);
    expect(after.note).toMatch(/last read failed/);
  });
});
