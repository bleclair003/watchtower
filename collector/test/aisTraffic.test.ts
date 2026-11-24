// @vitest-environment node
/** v0.75.0: tanker and cargo traffic from the AIS window. Ships and MMSIs are invented. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kindOfType, trackPoints, flagOf, TRAFFIC_MAX_SHIPS } from '../../shared/domain/shipTraffic.ts';
import { AIS_KEY_ENV, aisTiming, type AisMessage } from '../adapters/aisSanctioned.ts';
import { makeAisTrafficAdapter, updateTraffic, KNOWN_MAX, type TrafficState } from '../adapters/aisTraffic.ts';

const T0 = Date.parse('2026-11-24T10:00:00Z');
const time = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '.000000000 +0000 UTC');
const statics = (mmsi: number, type: number, name = `SHIP ${mmsi}`, extra: Record<string, unknown> = {}): AisMessage => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, latitude: 59.5, longitude: 24.5, time_utc: time(T0) },
  Message: { ShipStaticData: { Type: type, Name: name, ImoNumber: 9000000 + (mmsi % 1000), Destination: 'TESTPORT', ...extra } },
});
const pos = (mmsi: number, lat: number, lon: number, at: number, sog = 11, cog = 90): AisMessage => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, latitude: lat, longitude: lon, time_utc: time(at) },
  Message: { PositionReport: { Sog: sog, Cog: cog } },
});

describe('tanker and cargo traffic', () => {
  it('classifies AIS types and flags', () => {
    expect([kindOfType(84), kindOfType(70), kindOfType(30), kindOfType(null)]).toEqual(['tanker', 'cargo', null, null]);
    expect(flagOf('273123456')).toBe('RU');
    expect(flagOf('999000000')).toBeNull();
  });

  it('remembers types between windows and draws a 24-hour track with a point per run', () => {
    let s = updateTraffic(null, [statics(273000001, 84), pos(273000001, 59.9, 26.0, T0), pos(230000002, 60, 25, T0)], T0, 25);
    expect(s.latest!.ships.map((x) => [x.mmsi, x.kind, x.name, x.imo, x.destination, x.area])).toEqual([['273000001', 'tanker', 'SHIP 273000001', '9000001', 'TESTPORT', 'gulf-of-finland']]);
    // Next run: only a position (no identity message), 30 minutes later: still known.
    s = updateTraffic(s, [pos(273000001, 59.95, 26.4, T0 + 30 * 60_000)], T0 + 30 * 60_000, 25);
    const ship = s.latest!.ships[0];
    expect(ship.la).toBe(59.95);
    expect(trackPoints(ship).map(([lo, la]) => [lo, la])).toEqual([[26, 59.9], [26.4, 59.95]]);
    expect(trackPoints(ship)[0][2]).toBe(new Date(T0).toISOString());
    // 25 hours later the old point is gone.
    s = updateTraffic(s, [pos(273000001, 60, 27, T0 + 25 * 3_600_000)], T0 + 25 * 3_600_000, 25);
    expect(s.latest!.ships[0].track).toEqual([]);
  });

  it('ignores other ship types, forgets a ship re-typed as something else, and skips positions outside the areas', () => {
    let s = updateTraffic(null, [statics(1, 60), statics(230000003, 70), pos(230000003, 10, 10, T0)], T0, 25);
    expect(s.latest!.ships).toEqual([]);
    expect(Object.keys(s.known)).toEqual(['230000003']);
    s = updateTraffic(s, [statics(230000003, 52)], T0 + 60_000, 25);
    expect(s.known).toEqual({});
  });

  it('puts watch-region seas and tankers first, caps the map, and keeps tracks only for shown ships', () => {
    const msgs: AisMessage[] = [];
    for (let i = 0; i < TRAFFIC_MAX_SHIPS + 50; i++) {
      const mmsi = 244000000 + i;
      msgs.push(statics(mmsi, 70), pos(mmsi, 54, 3, T0)); // North Sea cargo
    }
    msgs.push(statics(273000009, 80), pos(273000009, 44, 32, T0)); // Black Sea tanker
    const s = updateTraffic(null, msgs, T0, 25);
    expect(s.latest!.ships).toHaveLength(TRAFFIC_MAX_SHIPS);
    expect(s.latest!.totalSeen).toBe(TRAFFIC_MAX_SHIPS + 51);
    expect(s.latest!.ships[0]).toMatchObject({ mmsi: '273000009', area: 'black-sea' });
    expect(Object.keys(s.tracks)).toHaveLength(TRAFFIC_MAX_SHIPS);
    expect(KNOWN_MAX).toBeGreaterThan(TRAFFIC_MAX_SHIPS);
  });
});

describe('traffic adapter', () => {
  beforeEach(() => {
    process.env[AIS_KEY_ENV] = 'test-key';
    aisTiming.retryPauseMs = 0;
  });
  afterEach(() => {
    delete process.env[AIS_KEY_ENV];
  });
  const ctx = (state: TrafficState | null) => ({ now: T0, state, fetch: async () => ({ kind: 'not-modified' as const, status: 304 as const }) });

  it('makes no records, notes what it shows, and tolerates two failed listens', async () => {
    const ok = makeAisTrafficAdapter(async () => ({ msgs: [statics(273000001, 84), pos(273000001, 59.9, 26, T0)], messages: 2 }));
    const r = await ok.collect(ctx(null));
    expect(r.events).toEqual([]);
    expect(r.note).toMatch(/^1 tankers and cargo ships on the map, 1 types known$/);
    const failing = makeAisTrafficAdapter(async () => {
      throw new Error('aisstream.io connection failed');
    });
    const f1 = await failing.collect(ctx(r.state));
    expect(f1).toMatchObject({ notModified: true, state: { failedWindows: 1, latest: r.state.latest } });
    // From the first run on, two failures in a row are tolerated; the third fails the source.
    const first = await failing.collect(ctx(null));
    expect(first).toMatchObject({ notModified: true, state: { failedWindows: 1, latest: null } });
    const second = await failing.collect(ctx(first.state));
    await expect(failing.collect(ctx(second.state))).rejects.toThrow(/3 listens in a row failed/);
  });
});
