// @vitest-environment node
/** Phase 18: radiation — usual levels, detection, clusters, the three network parsers and the meter. */
import { describe, expect, it } from 'vitest';
import { classify, clusterStations, packBaselines, unpackBaselines, updateBaseline, type FlaggedStation, type RadiationSnapshot } from '../../shared/domain/radiation.ts';
import { epaRadnet, evaluateReadings, parseBfs, parseRadnetCsv, parseStuk, radiationRecords, RADNET_STATIONS } from '../adapters/radiation.ts';
import { radiationMeter } from '../../shared/domain/meters/radiationMeter.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-21T23:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const H = 3_600_000;

describe('usual level and detection', () => {
  const base = { b: 0.1, n: 48, t: 0 };
  it('flags 2× usual and +0.1 µSv/h as elevated, 0.5 µSv/h and +0.3 as high', () => {
    expect(classify(0.15, base)).toBe('normal');
    expect(classify(0.19, base)).toBe('normal'); // under +0.1
    expect(classify(0.21, base)).toBe('elevated');
    expect(classify(0.45, base)).toBe('elevated');
    expect(classify(0.6, base)).toBe('high');
    expect(classify(0.3, { b: 0.1, n: 5, t: 0 })).toBe('no-baseline');
    expect(classify(1.2, undefined)).toBe('high'); // absolute, without a usual level
  });

  it('builds from normal readings only and never counts a reading twice', () => {
    let b = updateBaseline(undefined, { value: 0.1, at: iso(NOW) });
    for (let i = 1; i < 30; i++) b = updateBaseline(b, { value: 0.1, at: iso(NOW + i * H) });
    expect(b.n).toBe(30);
    const raised = updateBaseline(b, { value: 0.5, at: iso(NOW + 31 * H) });
    expect([raised.b, raised.n]).toEqual([b.b, b.n]); // a raised reading does not move it
    expect(updateBaseline(b, { value: 0.12, at: iso(NOW + 29 * H) })).toBe(b); // same reading again
    expect(unpackBaselines(packBaselines({ 'DEZ1318': b, '60.2229_25.1788': b }))).toEqual({ DEZ1318: b, '60.2229_25.1788': b });
  });

  it('groups raised stations within 100 km; an alert needs 3, a high one, or any RadNet monitor', () => {
    const s = (id: string, lat: number, lon: number, network: FlaggedStation['network'] = 'bfs', status: FlaggedStation['status'] = 'elevated'): FlaggedStation => ({ id, name: id, lat, lon, at: iso(NOW), value: 0.25, usual: 0.1, network, status });
    const c = clusterStations([s('a', 51, 13), s('b', 51.3, 13.3), s('c', 50.8, 13.9), s('far', 48, 9)]);
    expect(c.map((x) => [x.stations.length, x.alert])).toEqual([[3, true], [1, false]]);
    expect(clusterStations([s('x', 48, 9), s('y', 48.2, 9.1)])[0].alert).toBe(false);
    expect(clusterStations([s('h', 48, 9, 'bfs', 'high')])[0].alert).toBe(true);
    expect(clusterStations([s('r', 38.9, -77, 'radnet')])[0].alert).toBe(true);
  });

  it('records an alerting group at its most raised station, once per 6 hours', () => {
    const prev = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, { b: 0.1, n: 48, t: 0 }]));
    const readings = [['a', 51, 13, 0.31], ['b', 51.3, 13.3, 0.27], ['c', 50.8, 13.9, 0.24]].map(([id, lat, lon, value]) => ({ id: String(id), name: `Station ${id}`, lat: Number(lat), lon: Number(lon), at: iso(NOW), value: Number(value) }));
    const ev = evaluateReadings('bfs', readings, prev, iso(NOW));
    expect(ev.flagged.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    const recs = radiationRecords(clusterStations(ev.flagged), iso(NOW));
    expect(recs).toHaveLength(1);
    expect(recs[0].title).toBe('Radiation above usual — Germany (BfS): Station a and 2 nearby stations, 0.310 µSv/h (3.1× usual)');
    expect([recs[0].latitude, recs[0].locationPrecision, recs[0].countryCodes]).toEqual([51, 'exact', ['DE']]);
    expect(radiationRecords(clusterStations(ev.flagged), iso(NOW - H))[0].id).toBe(recs[0].id); // same 6-hour block (18:00–24:00)
  });
});

describe('network parsers', () => {
  it('reads BfS stations in operation with a fresh value', () => {
    const f = (id: string, status: number, value: number | null, at = iso(NOW - H)) => ({ geometry: { coordinates: [9.73, 48.27] }, properties: { id, name: 'Ehingen', site_status: status, end_measure: at, value } });
    const r = parseBfs([f('DEZ1318', 1, 0.112), f('OFF', 2, 0.1), f('NULL', 1, null), f('OLD', 1, 0.1, iso(NOW - 10 * H))], NOW);
    expect(r).toEqual([{ id: 'DEZ1318', name: 'Ehingen', lat: 48.27, lon: 9.73, at: iso(NOW - H), value: 0.112 }]);
  });

  it('reads STUK dose rates (not the secondary detector) by position', () => {
    const el = (param: string, value: string, at = iso(NOW - H)) => `<BsWfs:BsWfsElement gml:id="x"><BsWfs:Location><gml:Point><gml:pos>60.22290 25.17880 </gml:pos></gml:Point></BsWfs:Location><BsWfs:Time>${at}</BsWfs:Time><BsWfs:ParameterName>${param}</BsWfs:ParameterName><BsWfs:ParameterValue>${value}</BsWfs:ParameterValue></BsWfs:BsWfsElement>`;
    const r = parseStuk(el('DR_PT10M_avg', '0.115') + el('DRS1_PT10M_avg', '0.2') + el('DR_PT10M_avg', 'NaN'), NOW);
    expect(r).toEqual([{ id: '60.2229_25.1788', name: 'station at 60.22°N 25.18°E', lat: 60.2229, lon: 25.1788, at: iso(NOW - H), value: 0.115 }]);
  });

  it('reads RadNet CSV rows in µSv/h', () => {
    const csv = 'LOCATION_NAME,SAMPLE COLLECTION TIME,DOSE EQUIVALENT RATE (nSv/h),X,STATUS\nDC: WASHINGTON,11/21/2026 22:30:00,30.00,873.00,APPROVED\nDC: WASHINGTON,11/21/2026 23:30:00,,1,APPROVED\n';
    expect(parseRadnetCsv(csv)).toEqual([['2026-11-21T22:30:00.000Z', 0.03]]);
  });

  it('starts a RadNet monitor from its last two weeks and flags a spike', async () => {
    const rows = Array.from({ length: 14 * 24 }, (_, i) => {
      const t = new Date(NOW - (14 * 24 - i) * H);
      const p = (n: number) => String(n).padStart(2, '0');
      const value = i === 14 * 24 - 1 ? 250 : 30; // last hour: 0.25 µSv/h against 0.03 usual
      return `DC: WASHINGTON,${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:00:00,${value}.00,1,APPROVED`;
    });
    const body = `header\n${rows.join('\n')}\n`;
    const ok = (b: string): FetchResult => ({ kind: 'ok', status: 200, body: b, validators: {}, bytes: b.length });
    const res = await epaRadnet.collect({ now: NOW, state: null, fetch: async (url) => ok(url.includes(RADNET_STATIONS[0].path) ? body : 'header\n') });
    expect(res.state?.latest?.flagged.map((f) => [f.id, f.value, f.usual])).toEqual([['DC/WASHINGTON', 0.25, 0.03]]);
    expect(res.events[0].regionIds).toEqual(['united-states']);
    expect(res.events[0].locationPrecision).toBe('city');
    expect(res.state?.cursor).toBe(2);
  });
});

describe('radiation meter', () => {
  const nets: RadiationSnapshot['networks'] = [{ network: 'bfs', fetchedAt: iso(NOW), stations: 1500, withBaseline: 1490, median: 0.1 }];
  const st = (id: string, lat: number, status: FlaggedStation['status'] = 'elevated'): FlaggedStation => ({ id, name: id, lat, lon: 10, at: iso(NOW), value: status === 'high' ? 0.7 : 0.25, usual: 0.1, network: 'bfs', status });

  it('is quiet when all stations are usual, low for a lone raised station, elevated for a group', () => {
    const snap = (flagged: FlaggedStation[]): RadiationSnapshot => ({ networks: nets, flagged, clusters: clusterStations(flagged) });
    const input = (r: RadiationSnapshot) => ({ now: NOW, events: [], historyStart: null, sourceStatus: [], regionScores: [], scoreHistory: [], radiation: r });
    expect(radiationMeter(input(snap([]))).label).toBe('QUIET');
    expect(radiationMeter(input(snap([st('a', 50)]))).value).toBe(0.5);
    const group = radiationMeter(input(snap([st('a', 50), st('b', 50.3), st('c', 50.6)])));
    expect([group.value, group.label]).toEqual([3, 'GUARDED']);
    expect(radiationMeter(input(snap([st('h', 50, 'high')]))).label).toBe('HIGH'); // high 4 + alert 3
    const building = radiationMeter(input({ networks: [{ ...nets[0], withBaseline: 10 }], flagged: [], clusters: [] }));
    expect(building.label).toBe('BUILDING BASELINE');
  });
});
