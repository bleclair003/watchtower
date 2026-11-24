// @vitest-environment node
/** v0.73.0: AIS listening that survives a dropped stream, and sanctioned ships lingering near undersea lines. Ships and lines are invented. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCables, type NearCableEntry } from '../../shared/domain/cableWatch.ts';
import type { SanctionedShipSighting } from '../../shared/domain/sanctionedShips.ts';
import type { UnderseaLine } from '../../shared/domain/undersea.ts';
import { AIS_KEY_ENV, aisTiming, cableEvents, listenWithRetry, makeAisSanctionedAdapter, MAX_FAILED_WINDOWS, type AisSanctionedState, type Listener } from '../adapters/aisSanctioned.ts';
import { validateEvent } from '../lib/validate.ts';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const line: UnderseaLine = { id: 'osm:way/9', k: 'power', n: 'Test Link', op: 'Test Grid', kv: 330, sub: null, g: [[[24, 59.6], [25, 59.6]]] };
const ship = (p: Partial<SanctionedShipSighting> = {}): SanctionedShipSighting => ({
  mmsi: '273000001', imo: '9000001', listedName: 'TEST TANKER', aisName: null, lists: ['ofac'], programs: ['RUSSIA-EO14024'], matchedBy: 'imo',
  la: 59.61, lo: 24.5, sog: 2.1, cog: 90, destination: null, area: 'gulf-of-finland', seenAt: new Date(NOW).toISOString(), ...p,
});

describe('sanctioned ships near undersea lines', () => {
  it('flags a slow ship within 2 km of a line, with a valid exactly located record', () => {
    const { flags, log } = checkCables([ship()], [line], [], {}, NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ reason: 'slow', km: 1.1 });
    expect(log['9000001']).toEqual([{ lineId: 'osm:way/9', at: new Date(NOW).toISOString(), km: 1.1 }]);
    const [ev] = cableEvents(flags, new Date(NOW).toISOString());
    expect(ev.title).toBe('Sanctioned vessel near power cable (100 kv+): TEST TANKER 1.1 km from Test Link, 2.1 kn — Gulf of Finland · OFAC');
    expect(ev.metadata).toMatchObject({ subtype: 'cable-proximity', reason: 'slow', lineId: 'osm:way/9' });
    expect(validateEvent(ev, NOW)).toBeNull();
  });

  it('ignores fast ships passing once, ships far from lines, and ships near a port', () => {
    expect(checkCables([ship({ sog: 11 })], [line], [], {}, NOW).flags).toEqual([]);
    expect(checkCables([ship({ la: 59.7 })], [line], [], {}, NOW).flags).toEqual([]);
    expect(checkCables([ship()], [line], [{ la: 59.62, lo: 24.55 }], {}, NOW).flags).toEqual([]);
  });

  it('flags a ship seen near the same line again 30+ minutes later, and forgets entries after 6 hours', () => {
    const earlier: Record<string, NearCableEntry[]> = { '9000001': [{ lineId: 'osm:way/9', at: new Date(NOW - 45 * 60_000).toISOString(), km: 1.5 }] };
    const r = checkCables([ship({ sog: 9 })], [line], [], earlier, NOW);
    expect(r.flags[0]).toMatchObject({ reason: 'repeat', firstAt: new Date(NOW - 45 * 60_000).toISOString() });
    const tooSoon = { '9000001': [{ lineId: 'osm:way/9', at: new Date(NOW - 10 * 60_000).toISOString(), km: 1.5 }] };
    expect(checkCables([ship({ sog: 9 })], [line], [], tooSoon, NOW).flags).toEqual([]);
    const old = { '9000001': [{ lineId: 'osm:way/9', at: new Date(NOW - 7 * 3_600_000).toISOString(), km: 1.5 }] };
    expect(checkCables([], [line], [], old, NOW).log).toEqual({});
  });

  it('makes one record per ship, line and day', () => {
    const { flags } = checkCables([ship(), ship({ seenAt: new Date(NOW + 60_000).toISOString() })], [line], [], {}, NOW);
    expect(cableEvents(flags, new Date(NOW).toISOString())).toHaveLength(1);
  });
});

describe('AIS listening', () => {
  beforeEach(() => {
    process.env[AIS_KEY_ENV] = 'test-key';
    aisTiming.retryPauseMs = 0;
  });
  afterEach(() => {
    delete process.env[AIS_KEY_ENV];
  });

  it('connects a second time, with a full window, when the first connection fails early', async () => {
    let calls = 0;
    const asked: number[] = [];
    let t = 0;
    const listener: Listener = async (_k, seconds) => {
      asked.push(seconds);
      calls++;
      if (calls === 1) {
        t += 5_000;
        throw new Error('aisstream.io connection failed');
      }
      return { msgs: [], messages: 12 };
    };
    const r = await listenWithRetry(listener, 'k', 25, () => t, async () => {});
    expect(asked).toEqual([25, 25]);
    expect(r.note).toMatch(/^second connection after: aisstream\.io connection failed/);
    // An error message from aisstream itself (a bad key, for example) is not retried.
    await expect(listenWithRetry(async () => { throw new Error('aisstream.io: Api Key Is Not Valid'); }, 'k', 25, () => 0, async () => {})).rejects.toThrow(/Api Key/);
    // A first connection that failed late (it used up its connect time) is not followed by a second.
    let slow = 0;
    let tries = 0;
    await expect(
      listenWithRetry(async () => { tries++; slow += 50_000; throw new Error('aisstream.io did not open the connection within 40 s'); }, 'k', 25, () => slow, async () => {}),
    ).rejects.toThrow(/did not open/);
    expect(tries).toBe(1);
  });

  it('tolerates two failed listens in a row and fails the source on the third', async () => {
    const failing = makeAisSanctionedAdapter(async () => {
      throw new Error('aisstream.io connection failed');
    });
    const ctx = (state: AisSanctionedState | null) => ({
      now: NOW,
      state,
      fetch: async () => ({ kind: 'not-modified' as const, status: 304 as const }),
      peerState: async <T,>() => ({ vessels: [{ list: 'ofac', id: '1', name: 'TEST TANKER', imo: '9000001', mmsi: null, programs: [] }] }) as T,
    });
    const start: AisSanctionedState = { known: {}, sightings: [], latest: null };
    const r1 = await failing.collect(ctx(start));
    expect(r1).toMatchObject({ notModified: true, state: { failedWindows: 1 } });
    expect(r1.note).toMatch(/listen failed \(1 of 3 tolerated in a row\)/);
    const r2 = await failing.collect(ctx(r1.state));
    expect(r2.state.failedWindows).toBe(2);
    await expect(failing.collect(ctx(r2.state))).rejects.toThrow(/3 listens in a row failed/);
    expect(MAX_FAILED_WINDOWS).toBe(3);
  });
});
