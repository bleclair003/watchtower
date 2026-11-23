import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import { pickLocalStations, type LocalRadioSnapshot, type LocalStation } from '../../shared/domain/shortwave.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Local radio stations (Phase 29): Radio Browser's open directory, searched once a day per watch-region
 * country, most-played first; news and talk stations are kept ahead of the rest. Makes no records and
 * never contacts a station: the stations are only linked.
 */
export const LOCAL_RADIO_SOURCE_ID = 'radio-browser-stations';
export const LOCAL_RADIO_EVERY_MS = 24 * 3_600_000;
const FALLBACK_HOST = 'de1.api.radio-browser.info';
const SERVERS_URL = 'https://all.api.radio-browser.info/json/servers';

export interface LocalRadioState {
  latest: LocalRadioSnapshot;
}

export const LOCAL_RADIO_COUNTRIES = [...new Set(WATCH_REGIONS.flatMap((r) => r.countryCodes))];

/** The directory's own server list (it asks clients to pick from it); only its own hosts are accepted. */
async function pickHost(ctx: AdapterContext<LocalRadioState>): Promise<string> {
  try {
    const res = await ctx.fetch(SERVERS_URL, undefined, { Accept: 'application/json' }, { maxBytes: 64 * 1024 });
    if (res.kind === 'ok') {
      const list = JSON.parse(res.body) as { name?: unknown }[];
      const hosts = [...new Set(list.map((s) => s?.name).filter((n): n is string => typeof n === 'string' && /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(n)))].sort();
      if (hosts.length) return hosts[0];
    }
  } catch {
    // fall through to the default host
  }
  return FALLBACK_HOST;
}

export const localRadio: SourceAdapter<LocalRadioState> = {
  sourceId: LOCAL_RADIO_SOURCE_ID,
  async collect(ctx: AdapterContext<LocalRadioState>): Promise<AdapterResult<LocalRadioState>> {
    if (ctx.state?.latest && ctx.now - Date.parse(ctx.state.latest.fetchedAt) < LOCAL_RADIO_EVERY_MS) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const host = await pickHost(ctx);
    const previous = ctx.state?.latest.stations ?? [];
    const stations: LocalStation[] = [];
    let ok = 0;
    let seen = 0;
    for (const cc of LOCAL_RADIO_COUNTRIES) {
      const url = `https://${host}/json/stations/search?countrycode=${cc}&hidebroken=true&order=clickcount&reverse=true&limit=60`;
      const res = await ctx.fetch(url, undefined, { Accept: 'application/json' }, { maxBytes: 2 * 1024 * 1024 }).catch(() => null);
      if (res?.kind !== 'ok') {
        stations.push(...previous.filter((s) => s.cc === cc));
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(res.body);
      } catch {
        stations.push(...previous.filter((s) => s.cc === cc));
        continue;
      }
      ok++;
      if (Array.isArray(raw)) seen += raw.length;
      stations.push(...pickLocalStations(raw, cc));
    }
    if (ok === 0) throw new Error(`Radio Browser (${host}): no country search answered`);
    return {
      events: [],
      rejected: [],
      itemsSeen: seen,
      notModified: false,
      state: { latest: { fetchedAt: new Date(ctx.now).toISOString(), sourceUrl: `https://${host}/`, stations } },
    };
  },
};
