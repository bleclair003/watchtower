// @vitest-environment node
/** v0.76.0: Fintraffic Digitraffic AIS, merged with the aisstream window. Vessels are invented, in Digitraffic's layout. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aisTime, DIGITRAFFIC_LOCATIONS, DIGITRAFFIC_VESSELS, parseDigitraffic, resetDigitrafficCache } from '../lib/digitraffic.ts';
import { AIS_KEY_ENV, aisTiming, makeAisSanctionedAdapter, type AisSanctionedState } from '../adapters/aisSanctioned.ts';
import { makeAisTrafficAdapter } from '../adapters/aisTraffic.ts';
import type { FetchResult } from '../lib/http.ts';

const NOW = Date.parse('2026-11-24T02:00:00Z');
const ok = (o: unknown): FetchResult => {
  const body = JSON.stringify(o);
  return { kind: 'ok', status: 200, body, validators: {}, bytes: body.length };
};
const locations = {
  type: 'FeatureCollection',
  dataUpdatedTime: '2026-11-24T02:00:00Z',
  features: [
    { mmsi: 273000001, type: 'Feature', geometry: { type: 'Point', coordinates: [26.2, 59.9] }, properties: { mmsi: 273000001, sog: 2.1, cog: 260.4, timestampExternal: NOW - 5 * 60_000 } },
    { mmsi: 230000002, type: 'Feature', geometry: { type: 'Point', coordinates: [22.1, 60.1] }, properties: { mmsi: 230000002, sog: 12, cog: 90, timestampExternal: NOW - 2 * 60_000 } },
    // Last heard a day ago: left out.
    { mmsi: 230000003, type: 'Feature', geometry: { type: 'Point', coordinates: [24, 59.5] }, properties: { mmsi: 230000003, sog: 0, cog: 0, timestampExternal: NOW - 24 * 3_600_000 } },
  ],
};
const vessels = [
  { mmsi: 273000001, name: 'TEST TANKER', imo: 9000001, shipType: 84, destination: 'PRIMORSK' },
  { mmsi: 230000002, name: 'TEST FERRY', imo: 0, shipType: 60, destination: 'TURKU' },
  { mmsi: 230000003, name: 'TEST OLD', imo: 9000003, shipType: 70, destination: '' },
];
const fetchOk = async (u: string) => (u === DIGITRAFFIC_LOCATIONS ? ok(locations) : u === DIGITRAFFIC_VESSELS ? ok(vessels) : ok({}));

beforeEach(() => {
  process.env[AIS_KEY_ENV] = 'test-key';
  aisTiming.retryPauseMs = 0;
  resetDigitrafficCache();
});
afterEach(() => {
  delete process.env[AIS_KEY_ENV];
});

describe('Digitraffic', () => {
  it('turns recent positions and their vessels into AIS messages', () => {
    const r = parseDigitraffic(JSON.stringify(locations), JSON.stringify(vessels), NOW);
    expect(r).toMatchObject({ positions: 2, vessels: 2 });
    const tanker = r.msgs.find((m) => m.MessageType === 'ShipStaticData' && m.MetaData.MMSI === 273000001)!;
    expect(tanker.Message.ShipStaticData).toEqual({ ImoNumber: 9000001, Name: 'TEST TANKER', Destination: 'PRIMORSK', Type: 84 });
    expect(r.msgs.find((m) => m.MetaData.MMSI === 230000002 && m.MessageType === 'ShipStaticData')!.Message.ShipStaticData!.ImoNumber).toBeUndefined();
    expect(r.msgs.some((m) => m.MetaData.MMSI === 230000003)).toBe(false);
    expect(aisTime(Date.parse('2026-11-24T01:55:00Z'))).toBe('2026-11-24 01:55:00.000000000 +0000 UTC');
    expect(() => parseDigitraffic('{}', '[]', NOW)).toThrow(/unexpected response layout/);
  });

  it('keeps the tanker and cargo layer going when aisstream fails but Fintraffic answers', async () => {
    const adapter = makeAisTrafficAdapter(async () => {
      throw new Error('aisstream.io did not confirm the subscription within 8 s');
    });
    const r = await adapter.collect({ now: NOW, state: null, fetch: fetchOk });
    expect(r.notModified).toBe(false);
    expect(r.state.latest!.ships.map((s) => [s.mmsi, s.kind, s.name, s.imo, s.area])).toEqual([['273000001', 'tanker', 'TEST TANKER', '9000001', 'gulf-of-finland']]);
    expect(r.state.latest!.fintraffic).toBe(2);
    expect(r.note).toMatch(/aisstream listen failed: .* · Fintraffic 2 positions$/);
  });

  it('matches a sanctioned tanker by the IMO from the Fintraffic vessel database', async () => {
    const adapter = makeAisSanctionedAdapter(async () => {
      throw new Error('aisstream.io connection failed');
    });
    const state: AisSanctionedState = { known: {}, sightings: [], latest: null };
    const r = await adapter.collect({
      now: NOW,
      state,
      fetch: fetchOk,
      peerState: async <T,>() => ({ vessels: [{ list: 'ofac', id: '1', name: 'LISTED TANKER', imo: '9000001', mmsi: null, programs: ['RUSSIA'] }] }) as T,
    });
    expect(r.state.sightings).toHaveLength(1);
    expect(r.state.sightings[0]).toMatchObject({ imo: '9000001', matchedBy: 'imo', sog: 2.1, area: 'gulf-of-finland' });
    expect(r.state.failedWindows).toBe(1); // aisstream counted, but Fintraffic kept the source working
    expect(r.events.some((e) => e.metadata?.subtype === 'sanctioned-vessel-sighting')).toBe(true);
  });
});
