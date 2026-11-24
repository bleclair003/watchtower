// @vitest-environment node
/**
 * Sanctioned vessels on AIS. Messages follow the aisstream.io format seen in the 2026-11-21
 * probe (MetaData with MMSI, ShipName, latitude, longitude, time_utc; Message.PositionReport /
 * Message.ShipStaticData). Vessel identities are synthetic; the watchlist logic is what is tested.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AIS_KEY_ENV, AIS_SOURCE_ID, buildWatchlist, makeAisSanctionedAdapter, matchWindow, parseAisTime, primeAisListening, sightingEvents, type AisMessage } from '../adapters/aisSanctioned.ts';
import type { SanctionedVessel } from '../../shared/domain/sanctions.ts';
import { validateEvent } from '../lib/validate.ts';
import { INDICATOR_CATALOG, validateCatalog } from '../../shared/domain/indicators/catalog.ts';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const nowIso = new Date(NOW).toISOString();
afterEach(() => delete process.env[AIS_KEY_ENV]);

const pos = (mmsi: number, lat: number, lon: number, sog = 11.2, t = '2026-11-21 09:59:30.1 +0000 UTC', name = 'SHIP'): AisMessage => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: mmsi, ShipName: name, latitude: lat, longitude: lon, time_utc: t },
  Message: { PositionReport: { Sog: sog, Cog: 87.5, Latitude: lat, Longitude: lon } },
});
const stat = (mmsi: number, imo: number, name = 'SHIP', dest = 'PRIMORSK'): AisMessage => ({
  MessageType: 'ShipStaticData',
  MetaData: { MMSI: mmsi, ShipName: name, latitude: 60.1, longitude: 26.0, time_utc: '2026-11-21 09:59:00.0 +0000 UTC' },
  Message: { ShipStaticData: { ImoNumber: imo, Name: name, Destination: dest } },
});
const vessels: SanctionedVessel[] = [
  { name: 'LISTED TANKER ONE', imo: '9100001', mmsi: '273000001', list: 'ofac', programs: ['RUSSIA-EO14024'] },
  { name: 'LISTED TANKER ONE', imo: '9100001', mmsi: null, list: 'uk', programs: ['The Russia (Sanctions) (EU Exit) Regulations 2019'] },
  { name: 'LISTED TANKER TWO', imo: '9100002', mmsi: null, list: 'uk', programs: ['The Russia (Sanctions) (EU Exit) Regulations 2019'] },
  { name: 'OFAC ONLY', imo: '9100003', mmsi: '636000003', list: 'ofac', programs: ['IRAN'] },
];
const wl = buildWatchlist(vessels);

describe('matching', () => {
  it('matches by IMO from identity messages, even under a new MMSI, and remembers it', () => {
    // LISTED TANKER TWO now uses MMSI 312000002 (re-flagged): only its IMO identifies it.
    const r = matchWindow([stat(312000002, 9100002, 'NEW NAME'), pos(312000002, 60.2, 26.5, 9.8)], wl, {}, nowIso);
    expect(r.sightings).toHaveLength(1);
    expect(r.sightings[0]).toMatchObject({ imo: '9100002', listedName: 'LISTED TANKER TWO', aisName: 'NEW NAME', matchedBy: 'imo', area: 'gulf-of-finland', lists: ['uk'], destination: 'PRIMORSK', sog: 9.8 });
    expect(r.known).toEqual({ '312000002': '9100002' });
    // Next window: position only; the remembered link still matches.
    const next = matchWindow([pos(312000002, 59.9, 24.0)], wl, r.known, nowIso);
    expect(next.sightings[0]).toMatchObject({ imo: '9100002', matchedBy: 'imo', area: 'gulf-of-finland' });
  });

  it('matches OFAC MMSIs on position reports, unless an identity message shows another ship', () => {
    const r = matchWindow([pos(273000001, 55.5, 15.0)], wl, {}, nowIso);
    expect(r.sightings[0]).toMatchObject({ matchedBy: 'mmsi', imo: '9100001', lists: ['ofac', 'uk'], area: 'baltic' });
    // MMSI 636000003 has been reassigned: the ship now using it reports IMO 9999999.
    const reassigned = matchWindow([stat(636000003, 9999999), pos(636000003, 54.0, 5.0)], wl, {}, nowIso);
    expect(reassigned.sightings).toEqual([]);
    // A remembered link is dropped when the MMSI later reports a different IMO.
    const dropped = matchWindow([stat(312000002, 9876543)], wl, { '312000002': '9100002' }, nowIso);
    expect(dropped.known).toEqual({});
  });

  it('ignores positions outside the ship areas and keeps the latest position per ship', () => {
    const r = matchWindow([pos(273000001, 40.0, 5.0)], wl, {}, nowIso);
    expect(r.sightings).toEqual([]);
    const two = matchWindow([pos(273000001, 55.0, 15.0, 10, '2026-11-21 09:59:00.0 +0000 UTC'), pos(273000001, 55.1, 15.2, 10, '2026-11-21 09:59:20.0 +0000 UTC')], wl, {}, nowIso);
    expect(two.sightings).toHaveLength(1);
    expect(two.sightings[0].la).toBe(55.1);
    expect(two.sightings[0].seenAt).toBe('2026-11-21T09:59:20.000Z');
  });

  it('parses AIS timestamps', () => {
    expect(parseAisTime('2026-11-21 09:04:07.126103054 +0000 UTC')).toBe('2026-11-21T09:04:07.000Z');
    expect(parseAisTime(undefined)).toBeNull();
  });
});

describe('records', () => {
  it('one per vessel, area and day, with the match basis stated', () => {
    const r = matchWindow([stat(312000002, 9100002, 'NEW NAME'), pos(312000002, 60.2, 26.5, 9.8), pos(273000001, 54.5, 4.0, 0.1)], wl, {}, nowIso);
    const events = sightingEvents(r.sightings, nowIso);
    expect(events).toHaveLength(2);
    for (const e of events) expect(validateEvent(e, NOW)).toBeNull();
    const finland = events.find((e) => e.metadata?.area === 'gulf-of-finland')!;
    expect(finland.title).toBe('Sanctioned vessel seen: LISTED TANKER TWO (IMO 9100002) — Gulf of Finland, 9.8 kn · UK');
    expect(finland.regionIds).toEqual(['eastern-europe']);
    expect(finland.summary).toMatch(/broadcasting as "NEW NAME"/);
    expect(finland.summary).toMatch(/not by itself a violation/);
    const northSea = events.find((e) => e.metadata?.area === 'north-sea')!;
    expect(northSea.title).toMatch(/North Sea and Channel, stopped · OFAC\/UK$/);
    expect(northSea.regionIds).toEqual([]);
    expect(northSea.summary).toMatch(/MMSI only/);
    // Same ship, same area, same day → same record id.
    expect(sightingEvents(matchWindow([pos(273000001, 54.6, 4.1)], wl, {}, nowIso).sightings, nowIso)[0].id).toBe(northSea.id);
  });
});

describe('adapter', () => {
  const peer = (id: string) =>
    Promise.resolve(
      id === 'ofac-sdn'
        ? { idsPacked: '1', vesselsJson: JSON.stringify(vessels.filter((v) => v.list === 'ofac')), publishedOn: null, lastFetchedAt: nowIso }
        : id === 'uk-sanctions'
          ? { idsPacked: '1', vesselsJson: JSON.stringify(vessels.filter((v) => v.list === 'uk')), publishedOn: null, lastFetchedAt: nowIso }
          : null,
    ) as never;

  it('uses the window primed at the start of the run, and keeps 48 h of sightings', async () => {
    process.env[AIS_KEY_ENV] = 'aisTESTkey123';
    let calls = 0;
    const listener = async () => {
      calls++;
      return { msgs: [stat(312000002, 9100002), pos(312000002, 60.2, 26.5)], messages: 1234 };
    };
    primeAisListening(listener);
    const adapter = makeAisSanctionedAdapter(async () => {
      throw new Error('should use the primed window');
    });
    const old = { mmsi: '1', imo: '9000000', listedName: 'OLD', aisName: null, lists: ['ofac' as const], programs: [], matchedBy: 'imo' as const, la: 55, lo: 15, sog: 1, cog: 1, destination: null, area: 'baltic', seenAt: '2026-11-18T00:00:00.000Z' };
    const r = await adapter.collect({ now: NOW, state: { known: {}, sightings: [old], latest: null }, fetch: async () => { throw new Error('no fetch'); }, peerState: peer });
    expect(calls).toBe(1);
    expect(r.itemsSeen).toBe(1234);
    expect(r.events).toHaveLength(1);
    expect(r.state.latest).toMatchObject({ messages: 1234, watchlistSize: 3 });
    expect(r.state.sightings.map((s) => s.imo)).toEqual(['9100002']); // the 3-day-old sighting is dropped
  });

  it('fails clearly without the sanctions lists, and is NOT CONFIGURED without a key', async () => {
    process.env[AIS_KEY_ENV] = 'aisTESTkey123';
    const adapter = makeAisSanctionedAdapter(async () => ({ msgs: [], messages: 0 }));
    await expect(adapter.collect({ now: NOW, state: null, fetch: async () => { throw new Error('no'); }, peerState: async () => null })).rejects.toThrow(/no sanctioned-vessel list/);
    expect(adapter.requiredEnv).toEqual([AIS_KEY_ENV]);
  });
});

describe('indicator', () => {
  it('is valid and experimental', () => {
    const defs = INDICATOR_CATALOG.filter((d) => d.requiredSourceIds.includes(AIS_SOURCE_ID));
    expect(validateCatalog(defs)).toEqual([]);
    expect(defs.map((d) => [d.id, d.experimental, d.weight])).toEqual([
      ['eastern-europe.sanctioned-vessels', true, 0],
      ['eastern-europe.cable-proximity', true, 0],
    ]);
  });
});
