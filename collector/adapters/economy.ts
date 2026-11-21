import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import { contentHash } from '../lib/hash.ts';
import { readSecret } from '../lib/secrets.ts';
import { LIMITS, truncate } from '../lib/text.ts';
import { isoWeek } from './portwatch.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

const DAY = 86_400_000;
const shiftDay = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

// ------------------------------------------------------------- currencies ---

export const FX_SOURCE_ID = 'fx-rates';
export const FX_EVERY_HOURS = 6;
/** fawazahmed0/exchange-api (CC0): jsDelivr first, Cloudflare Pages as the documented fallback. */
export const fxUrls = (date: 'latest' | string) => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
  `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`,
];

/** Watch-region currencies (units per US dollar). KPW (official rate only) and EUR (Baltics) are left out. */
export const WATCH_CURRENCIES: Record<string, { name: string; countries: string[]; pegged?: boolean }> = {
  ils: { name: 'Israeli shekel', countries: ['IL', 'PS'] },
  lbp: { name: 'Lebanese pound', countries: ['LB'] },
  syp: { name: 'Syrian pound', countries: ['SY'] },
  jod: { name: 'Jordanian dinar', countries: ['JO'], pegged: true },
  iqd: { name: 'Iraqi dinar', countries: ['IQ'] },
  irr: { name: 'Iranian rial', countries: ['IR'] },
  sar: { name: 'Saudi riyal', countries: ['SA'], pegged: true },
  kwd: { name: 'Kuwaiti dinar', countries: ['KW'], pegged: true },
  bhd: { name: 'Bahraini dinar', countries: ['BH'], pegged: true },
  qar: { name: 'Qatari riyal', countries: ['QA'], pegged: true },
  aed: { name: 'UAE dirham', countries: ['AE'], pegged: true },
  omr: { name: 'Omani rial', countries: ['OM'], pegged: true },
  yer: { name: 'Yemeni rial', countries: ['YE'] },
  ern: { name: 'Eritrean nakfa', countries: ['ER'], pegged: true },
  djf: { name: 'Djiboutian franc', countries: ['DJ'], pegged: true },
  sos: { name: 'Somali shilling', countries: ['SO'] },
  uah: { name: 'Ukrainian hryvnia', countries: ['UA'] },
  rub: { name: 'Russian rouble', countries: ['RU'] },
  byn: { name: 'Belarusian rouble', countries: ['BY'] },
  mdl: { name: 'Moldovan leu', countries: ['MD'] },
  pln: { name: 'Polish zloty', countries: ['PL'] },
  ron: { name: 'Romanian leu', countries: ['RO'] },
  twd: { name: 'New Taiwan dollar', countries: ['TW'] },
  krw: { name: 'South Korean won', countries: ['KR'] },
  php: { name: 'Philippine peso', countries: ['PH'] },
  vnd: { name: 'Vietnamese dong', countries: ['VN'] },
  myr: { name: 'Malaysian ringgit', countries: ['MY'] },
  bnd: { name: 'Brunei dollar', countries: ['BN'], pegged: true },
};

/** Depreciation thresholds against the dollar: floating currencies, and pegs (where any real move strains the peg). */
export const FX_THRESHOLDS = { floating: { week: 0.05, month: 0.1 }, pegged: { week: 0.02, month: 0.02 } };

export interface FxMove {
  code: string;
  date: string;
  rate: number;
  week: number | null;
  month: number | null;
}

/** Change in units per dollar: positive = the currency lost value. */
export function fxMoves(now: Record<string, number>, weekAgo: Record<string, number>, monthAgo: Record<string, number>, date: string): FxMove[] {
  return Object.keys(WATCH_CURRENCIES).flatMap((code) => {
    const rate = now[code];
    if (!(rate > 0)) return [];
    const change = (then?: number) => (then && then > 0 ? rate / then - 1 : null);
    return [{ code, date, rate, week: change(weekAgo[code]), month: change(monthAgo[code]) }];
  });
}

export function fxEvents(moves: FxMove[], nowIso: string): IntelligenceEvent[] {
  return moves.flatMap((m) => {
    const c = WATCH_CURRENCIES[m.code];
    const t = c.pegged ? FX_THRESHOLDS.pegged : FX_THRESHOLDS.floating;
    const weekHit = m.week !== null && m.week >= t.week;
    const monthHit = m.month !== null && m.month >= t.month;
    if (!weekHit && !monthHit) return [];
    const [span, change] = weekHit ? ['7 days', m.week!] : ['30 days', m.month!];
    const id = contentHash(FX_SOURCE_ID, m.code, isoWeek(m.date));
    const at = `${m.date}T12:00:00.000Z`;
    return [{
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: FX_SOURCE_ID,
      sourceName: 'Exchange rates (fawazahmed0/exchange-api, CC0)',
      sourceClass: 'aggregator' as const,
      sourceUrl: `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${m.date}/v1/currencies/usd.json`,
      title: truncate(`Currency stress: ${c.name}${c.pegged ? ' (pegged)' : ''} lost ${(change * 100).toFixed(1)}% against the US dollar in ${span} (${m.date})`, LIMITS.title),
      summary: truncate(
        `${m.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${m.code.toUpperCase()} per dollar on ${m.date}; ${m.week !== null ? `${pct(m.week)} in 7 days` : '7-day change unknown'}, ${m.month !== null ? `${pct(m.month)} in 30 days` : '30-day change unknown'} (positive = the currency lost value). ` +
          `${c.pegged ? 'This currency is pegged, so any real move strains the peg. ' : ''}Daily reference rates from an open aggregator; for currencies with separate official and market rates (rial, Syrian and Lebanese pound) the rate type is not documented, so treat the level as indicative and the change as the signal.`,
        LIMITS.summary,
      ),
      category: 'economic' as const,
      regionIds: [...new Set(c.countries.flatMap(regionsForCountry))],
      countryCodes: c.countries,
      publishedAt: at,
      occurredAt: at,
      collectedAt: nowIso,
      credibility: 'single-source' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: 'country' as const,
      metadata: { subtype: 'currency-stress', currency: m.code.toUpperCase(), pegged: !!c.pegged, change7d: m.week, change30d: m.month },
    }];
  });
}

export interface FxState {
  lastFetchedAt: string;
}

async function fxFile(ctx: AdapterContext<FxState>, date: string): Promise<{ date: string; usd: Record<string, number> }> {
  let lastError: unknown = null;
  for (const url of fxUrls(date)) {
    try {
      const res = await ctx.fetch(url, undefined, { Accept: 'application/json' });
      if (res.kind !== 'ok') continue;
      const j = JSON.parse(res.body) as { date?: string; usd?: Record<string, number> };
      if (j.usd && j.date) return { date: j.date, usd: j.usd };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`exchange rates for ${date} unavailable${lastError instanceof Error ? ` (${lastError.message})` : ''}`);
}

/** Daily rates for watch-region currencies against the dollar, compared with 7 and 30 days earlier. */
export const fxRates: SourceAdapter<FxState> = {
  sourceId: FX_SOURCE_ID,
  async collect(ctx: AdapterContext<FxState>): Promise<AdapterResult<FxState>> {
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < FX_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const latest = await fxFile(ctx, 'latest');
    const week = await fxFile(ctx, shiftDay(latest.date, -7));
    const month = await fxFile(ctx, shiftDay(latest.date, -30));
    const moves = fxMoves(latest.usd, week.usd, month.usd, latest.date);
    return { events: fxEvents(moves, new Date(ctx.now).toISOString()), rejected: [], itemsSeen: moves.length, notModified: false, state: { lastFetchedAt: new Date(ctx.now).toISOString() } };
  },
};

// ------------------------------------------------------------------- oil ---

export const OIL_SOURCE_ID = 'oil-prices';
export const OIL_KEY_ENV = 'CONGRESS_API_KEY'; // an api.data.gov key; EIA accepts the same key
export const OIL_EVERY_HOURS = 6;
export const OIL_SERIES: Record<string, string> = { RBRTE: 'Brent', RWTC: 'WTI' };
export const OIL_THRESHOLDS = { week: 0.1, month: 0.2 };

/** Daily spot prices, newest first → change vs the last price on or before 7 and 30 days earlier. */
export function oilMoves(rows: { period: string; series: string; value: string | number }[]): { series: string; date: string; price: number; week: number | null; month: number | null }[] {
  const by = new Map<string, [string, number][]>();
  for (const r of rows) {
    const v = Number(r.value);
    if (!OIL_SERIES[r.series] || !Number.isFinite(v) || v <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(r.period)) continue;
    by.set(r.series, [...(by.get(r.series) ?? []), [r.period, v]]);
  }
  return [...by].map(([series, list]) => {
    const s = [...list].sort((a, b) => b[0].localeCompare(a[0]));
    const [date, price] = s[0];
    const before = (days: number) => s.find(([d]) => d <= shiftDay(date, -days))?.[1];
    const ch = (p?: number) => (p ? price / p - 1 : null);
    return { series, date, price, week: ch(before(7)), month: ch(before(30)) };
  });
}

export function oilEvents(moves: ReturnType<typeof oilMoves>, nowIso: string): IntelligenceEvent[] {
  return moves.flatMap((m) => {
    const weekHit = m.week !== null && Math.abs(m.week) >= OIL_THRESHOLDS.week;
    const monthHit = m.month !== null && Math.abs(m.month) >= OIL_THRESHOLDS.month;
    if (!weekHit && !monthHit) return [];
    const [span, change] = weekHit ? ['7 days', m.week!] : ['30 days', m.month!];
    const direction = change > 0 ? 'up' : 'down';
    const id = contentHash(OIL_SOURCE_ID, m.series, direction, isoWeek(m.date));
    const at = `${m.date}T20:00:00.000Z`;
    return [{
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: OIL_SOURCE_ID,
      sourceName: 'US Energy Information Administration — Spot prices',
      sourceClass: 'official' as const,
      sourceUrl: 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm',
      title: truncate(`Oil price: ${OIL_SERIES[m.series]} $${m.price.toFixed(2)} (${m.date}), ${direction} ${Math.abs(change * 100).toFixed(0)}% in ${span}`, LIMITS.title),
      summary: truncate(
        `${OIL_SERIES[m.series]} spot price $${m.price.toFixed(2)} a barrel on ${m.date}; ${m.week !== null ? `${pct(m.week)} in 7 days` : '7-day change unknown'}, ${m.month !== null ? `${pct(m.month)} in 30 days` : '30-day change unknown'}. EIA daily spot prices are published a few days late.`,
        LIMITS.summary,
      ),
      category: 'economic' as const,
      regionIds: [],
      countryCodes: [],
      publishedAt: at,
      occurredAt: at,
      collectedAt: nowIso,
      credibility: 'official' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: 'none' as const,
      metadata: { subtype: 'oil-price-move', series: m.series, direction, price: m.price, change7d: m.week, change30d: m.month },
    }];
  });
}

export interface OilState {
  lastFetchedAt: string;
}

/** Brent and WTI daily spot prices from the EIA API (api.data.gov key, sent in a header). */
export const oilPrices: SourceAdapter<OilState> = {
  sourceId: OIL_SOURCE_ID,
  requiredEnv: [OIL_KEY_ENV],
  async collect(ctx: AdapterContext<OilState>): Promise<AdapterResult<OilState>> {
    const key = readSecret(OIL_KEY_ENV);
    if (!key) throw new Error(`${OIL_KEY_ENV} is not set`);
    if (ctx.state && ctx.now - Date.parse(ctx.state.lastFetchedAt) < OIL_EVERY_HOURS * 3_600_000) {
      return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: ctx.state };
    }
    const start = new Date(ctx.now - 50 * DAY).toISOString().slice(0, 10);
    const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?frequency=daily&data[0]=value&facets[series][]=RBRTE&facets[series][]=RWTC&start=${start}&sort[0][column]=period&sort[0][direction]=desc&length=200`;
    const res = await ctx.fetch(url, undefined, { 'X-Api-Key': key, Accept: 'application/json' });
    if (res.kind !== 'ok') throw new Error('EIA: unexpected 304');
    const body = JSON.parse(res.body) as { response?: { data?: { period: string; series: string; value: string }[] }; error?: unknown };
    const rows = body.response?.data;
    if (!Array.isArray(rows)) throw new Error('EIA: unexpected response');
    return { events: oilEvents(oilMoves(rows), new Date(ctx.now).toISOString()), rejected: [], itemsSeen: rows.length, notModified: false, state: { lastFetchedAt: new Date(ctx.now).toISOString() } };
  },
};
