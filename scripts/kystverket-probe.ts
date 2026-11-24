// One-off: checks that Kystverket's open AIS stream (NLOD 2.0) is reachable and what it delivers.
// Prints counts only.
import net from 'node:net';

const seconds = Math.min(Math.max(Number(process.argv[2]) || 30, 5), 120);
const t0 = Date.now();
const s = net.connect(5631, '153.44.253.27');
let buf = '';
let lines = 0;
let bytes = 0;
let firstByteMs: number | null = null;
const types: Record<number, number> = {};
const talkers: Record<string, number> = {};
let tagBlocks = 0;
s.setTimeout(20_000);
s.on('connect', () => console.log(`connected after ${Date.now() - t0} ms`));
s.on('timeout', () => { console.log('socket idle timeout'); s.destroy(); });
s.on('data', (d) => {
  firstByteMs ??= Date.now() - t0;
  bytes += d.length;
  buf += d.toString('latin1');
  const parts = buf.split(/\r?\n/);
  buf = parts.pop() ?? '';
  for (const l of parts) {
    lines++;
    if (l.charCodeAt(0) === 92) tagBlocks++;
    const m = l.match(/!([A-Z]{2})VD[MO],(\d),(\d),[^,]*,[^,]*,([^,]*),/);
    if (!m) continue;
    talkers[m[1]] = (talkers[m[1]] ?? 0) + 1;
    if (m[3] !== '1') continue;
    const c = m[4].charCodeAt(0) - 48;
    const t = c > 40 ? c - 8 : c;
    types[t] = (types[t] ?? 0) + 1;
  }
});
s.on('error', (e) => console.log(`error: ${e.message}`));
setTimeout(() => {
  console.log(JSON.stringify({ seconds, firstByteMs, lines, bytes, tagBlocks, talkers, types }));
  s.destroy();
  process.exit(0);
}, seconds * 1000);
