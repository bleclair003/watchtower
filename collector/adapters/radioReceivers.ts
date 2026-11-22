import { parseKiwiList, type RadioReceiversSnapshot } from '../../shared/domain/radio.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

/**
 * Public shortwave receivers (Phase 28): the KiwiSDR public list, from the rx.linkfanel.net mirror of
 * kiwisdr.com/public (the official page is behind a click-through). Fetched once a day; makes no records,
 * only the list the radio links use. No receiver is ever contacted.
 */
export const RADIO_RECEIVERS_SOURCE_ID = 'kiwisdr-receivers';
const LIST_URL = 'http://rx.linkfanel.net/kiwisdr_com.js';
export const RADIO_RECEIVERS_EVERY_MS = 24 * 3_600_000;

export interface RadioReceiversState {
  latest: RadioReceiversSnapshot;
}

export const radioReceivers: SourceAdapter<RadioReceiversState> = {
  sourceId: RADIO_RECEIVERS_SOURCE_ID,
  async collect(ctx: AdapterContext<RadioReceiversState>): Promise<AdapterResult<RadioReceiversState>> {
    if (ctx.state?.latest && ctx.now - Date.parse(ctx.state.latest.fetchedAt) < RADIO_RECEIVERS_EVERY_MS) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const res = await ctx.fetch(LIST_URL, undefined, { Accept: 'application/javascript, text/plain' }, { maxBytes: 4 * 1024 * 1024 });
    if (res.kind !== 'ok') return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state! };
    const { receivers, listTime } = parseKiwiList(res.body);
    if (receivers.length < 50) throw new Error(`receiver list: only ${receivers.length} usable receivers (expected hundreds)`);
    return {
      events: [],
      rejected: [],
      itemsSeen: receivers.length,
      notModified: false,
      state: { latest: { fetchedAt: new Date(ctx.now).toISOString(), listTime, receivers } },
    };
  },
};
