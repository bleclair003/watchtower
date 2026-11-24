/**
 * Coverage probe for aisstream.io in the areas where it has receivers. Listens for N seconds
 * and prints, per area: ships, position reports, identity (static) messages, ships by type,
 * warship candidates and Russian-flagged ships. Prints counts only, never the key.
 *
 *   AISSTREAM_API_KEY=... node collector/ais-probe.ts [seconds]
 *
 * Runs in GitHub Actions (workflow "AIS probe") so the key stays a repository secret.
 */
import { readSecret, redactSecrets } from './lib/secrets.ts';

const seconds = Math.min(150, Math.max(5, Number(process.argv[2] ?? 120)));
const key = readSecret('AISSTREAM_API_KEY');
if (!key) {
  console.error('AISSTREAM_API_KEY is not set');
  process.exit(1);
}

type Box = [[number, number], [number, number]];
const AREAS: [string, Box][] = [
  ['Gulf of Finland', [[59.0, 22.0], [60.8, 30.5]]],
  ['Baltic Sea (rest)', [[53.5, 9.5], [66.0, 30.5]]],
  ['North Sea + Channel', [[49.0, -5.5], [61.0, 9.5]]],
  ['Eastern Mediterranean', [[31.0, 28.0], [37.0, 36.5]]],
  // v0.75.0 coverage check for tanker and cargo tracking in the other watch-region seas.
  ['Black Sea', [[40.5, 27.5], [46.8, 41.8]]],
  ['Gulf and Hormuz', [[23.5, 48.0], [30.5, 58.0]]],
  ['Red Sea and Gulf of Aden', [[11.0, 32.0], [30.0, 45.5]]],
  ['Korea', [[33.0, 124.0], [39.0, 131.0]]],
  ['Taiwan Strait', [[22.0, 117.0], [26.5, 121.5]]],
  ['South China Sea', [[2.0, 105.0], [22.0, 121.0]]],
];
const areaOf = (lat: number, lon: number) => AREAS.find(([, [[s, w], [n, e]]]) => lat >= s && lat <= n && lon >= w && lon <= e)?.[0] ?? null;

/** AIS ship type 35 = military operations, 55 = law enforcement. Names like "USS …" are a second hint. */
const WARSHIP_NAME = /^(USS|USNS|HMS|HMCS|HMAS|HDMS|FGS|HNLMS|ORP|KNM|HSWMS|FNS|EML|LNS|BNS|ESPS|ITS|TCG|HS|FS|WARSHIP|NATO|NAVY)\b/i;

interface Stat {
  ships: Set<number>;
  positions: number;
  statics: number;
  moving: Set<number>;
  slow: Set<number>;
  typed: Map<number, number>;
  military: Set<number>;
  warshipNames: Set<string>;
  russian: Set<number>;
}
const stats = new Map<string, Stat>(AREAS.map(([n]) => [n, { ships: new Set(), positions: 0, statics: 0, moving: new Set(), slow: new Set(), typed: new Map(), military: new Set(), warshipNames: new Set(), russian: new Set() }]));
let total = 0;
let confirmed = false;

const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
ws.binaryType = 'arraybuffer';
// AIS_PROBE_FILTER=1 subscribes like the collector (position and identity messages only) to compare.
const filtered = process.env.AIS_PROBE_FILTER === '1';
const t0 = Date.now();
let openedMs: number | null = null;
let confirmMs: number | null = null;
let firstMsgMs: number | null = null;
ws.onopen = () => {
  openedMs = Date.now() - t0;
  ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: AREAS.map(([, b]) => b), ...(filtered ? { FilterMessageTypes: ['PositionReport', 'ShipStaticData'] } : {}) }));
};
ws.onmessage = (ev) => {
  const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
  let msg: { MessageType?: string; MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number }; Message?: Record<string, { Sog?: number; Type?: number }> };
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.MessageType === 'SubscriptionConfirmation') {
    confirmed = true;
    confirmMs ??= Date.now() - t0;
    return;
  }
  firstMsgMs ??= Date.now() - t0;
  total++;
  const m = msg.MetaData;
  if (!m?.MMSI || typeof m.latitude !== 'number' || typeof m.longitude !== 'number') return;
  const area = areaOf(m.latitude, m.longitude);
  if (!area) return;
  const s = stats.get(area)!;
  s.ships.add(m.MMSI);
  if (String(m.MMSI).startsWith('273')) s.russian.add(m.MMSI); // MID 273 = Russia
  const name = (m.ShipName ?? '').trim();
  if (WARSHIP_NAME.test(name)) s.warshipNames.add(name);
  const t = msg.MessageType ?? '';
  const body = msg.Message?.[t];
  if (t === 'PositionReport' || t === 'StandardClassBPositionReport' || t === 'ExtendedClassBPositionReport') {
    s.positions++;
    const sog = body?.Sog;
    if (typeof sog === 'number' && sog < 102.3) (sog >= 1 ? s.moving : s.slow).add(m.MMSI);
  }
  if (t === 'ShipStaticData' || t === 'StaticDataReport') {
    s.statics++;
    const type = body?.Type;
    if (typeof type === 'number') {
      s.typed.set(m.MMSI, type);
      if (type === 35 || type === 55) s.military.add(m.MMSI);
    }
  }
};
ws.onerror = () => console.error('WebSocket error');
ws.onclose = (ev) => console.log(`closed: code ${ev.code} ${redactSecrets(ev.reason ?? '')}`);

setTimeout(() => {
  ws.close();
  console.log(`Listened ${seconds} s · ${total} messages · subscription confirmed: ${confirmed} · filter: ${filtered} · opened ${openedMs} ms · confirmed at ${confirmMs} ms · first message ${firstMsgMs} ms`);
  for (const [name] of AREAS) {
    const s = stats.get(name)!;
    const typeShare = s.ships.size ? Math.round((s.typed.size / s.ships.size) * 100) : 0;
    const tankers = [...s.typed.values()].filter((t) => t >= 80 && t <= 89).length;
    const cargo = [...s.typed.values()].filter((t) => t >= 70 && t <= 79).length;
    console.log(
      `  ${name.padEnd(24)} tankers ${tankers} · cargo ${cargo} · ${String(s.ships.size).padStart(5)} ships · ${String(s.positions).padStart(5)} positions · ${String(s.moving.size).padStart(4)} moving · ${String(s.slow.size).padStart(4)} slow/stopped · ` +
        `type known ${typeShare}% · military/law type ${s.military.size} · Russian-flag ${s.russian.size} · warship-like names: ${[...s.warshipNames].slice(0, 8).join(', ') || 'none'}`,
    );
  }
  setTimeout(() => process.exit(0), 500);
}, seconds * 1000);
