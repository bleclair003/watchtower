/**
 * One-off coverage probe for aisstream.io: listens for N seconds to the chokepoint boxes and
 * prints what arrives per box. Prints counts only, never the key.
 *
 *   AISSTREAM_API_KEY=... node collector/ais-probe.ts [seconds]
 *
 * Runs in GitHub Actions (workflow "AIS probe") so the key stays a repository secret.
 */
import { CHOKEPOINTS, chokepointAt } from '../shared/domain/chokepoints.ts';
import { readSecret, redactSecrets } from './lib/secrets.ts';

const seconds = Math.min(120, Math.max(5, Number(process.argv[2] ?? 60)));
const key = readSecret('AISSTREAM_API_KEY');
if (!key) {
  console.error('AISSTREAM_API_KEY is not set');
  process.exit(1);
}

interface Box {
  messages: number;
  types: Record<string, number>;
  ships: Set<number>;
  moving: Set<number>;
}
const boxes = new Map<string, Box>(CHOKEPOINTS.map((c) => [c.id, { messages: 0, types: {}, ships: new Set(), moving: new Set() }]));
let total = 0;
let raw = 0;
let confirmed: unknown = null;
const started = Date.now();
let firstAt: number | null = null;

const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
ws.binaryType = 'arraybuffer';
ws.onopen = () => {
  const global = process.env.PROBE_GLOBAL === '1';
  ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: global ? [[[-90, -180], [90, 180]]] : CHOKEPOINTS.map((c) => c.box) }));
  console.log(`subscribed (${global ? 'whole world' : 'chokepoint boxes'}); extensions: ${ws.extensions || 'none'}`);
};
ws.onmessage = (ev) => {
  const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
  if (raw++ < 3) console.log(`raw[${raw}] ${typeof ev.data} ${redactSecrets(text.slice(0, 300))}`);
  let msg: { MessageType?: string; MetaData?: { MMSI?: number; latitude?: number; longitude?: number }; Message?: Record<string, { Sog?: number }> };
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.MessageType === 'SubscriptionConfirmation' || 'SubscriptionConfirmation' in (msg.Message ?? {})) {
    confirmed = msg.Message?.SubscriptionConfirmation ?? true;
    return;
  }
  if ('error' in (msg as Record<string, unknown>)) {
    console.error('Service error:', redactSecrets(JSON.stringify(msg).slice(0, 200)));
    return;
  }
  total++;
  firstAt ??= Date.now();
  const m = msg.MetaData;
  if (!m || typeof m.latitude !== 'number' || typeof m.longitude !== 'number') return;
  const c = chokepointAt(m.latitude, m.longitude);
  if (!c) return;
  const b = boxes.get(c.id)!;
  b.messages++;
  const t = msg.MessageType ?? '?';
  b.types[t] = (b.types[t] ?? 0) + 1;
  if (m.MMSI) {
    b.ships.add(m.MMSI);
    const sog = msg.Message?.[t]?.Sog;
    if (typeof sog === 'number' && sog >= 1 && sog < 102.3) b.moving.add(m.MMSI);
  }
};
ws.onerror = () => console.error('WebSocket error');
ws.onclose = (ev) => console.log(`closed: code ${ev.code} ${redactSecrets(ev.reason ?? '')}`);

setTimeout(() => {
  ws.close();
  console.log(`Listened ${seconds} s · ${total} messages · subscription confirmed: ${confirmed ? JSON.stringify(confirmed) : 'no'} · first message after ${firstAt ? ((firstAt - started) / 1000).toFixed(1) : '-'} s`);
  for (const c of CHOKEPOINTS) {
    const b = boxes.get(c.id)!;
    console.log(`  ${c.name.padEnd(18)} ${String(b.messages).padStart(5)} msgs · ${String(b.ships.size).padStart(4)} ships · ${String(b.moving.size).padStart(4)} moving (≥1 kn) · ${JSON.stringify(b.types)}`);
  }
  setTimeout(() => process.exit(0), 500);
}, seconds * 1000);
