import { readFileSync } from 'node:fs';
import { computeMeters } from '../shared/domain/meters/index.ts';
const S = process.argv[2];
const snap = JSON.parse(readFileSync(`${S}/snapshot-real.json`, 'utf8'));
const events = JSON.parse(readFileSync(`${S}/events-real.json`, 'utf8'));
const now = Date.parse(snap.generatedAt);
const historyStart = Math.min(...events.map((e: { collectedAt: string }) => Date.parse(e.collectedAt)));
const t = performance.now();
const m = computeMeters({ now, events, historyStart, sourceStatus: snap.sourceStatus, regionScores: snap.regionScores ?? [], scoreHistory: snap.scoreHistory ?? [], aircraft: snap.aircraft, fleet: snap.fleet, chokepoints: snap.chokepoints, sanctionedShips: snap.sanctionedShips, displacement: snap.displacement });
console.log('ms', Math.round(performance.now() - t), 'meters', m.meters.length, 'bytes', JSON.stringify(m).length, 'historyDays', m.historyDays);
const only = process.argv[3];
for (const x of m.meters) if (!only || x.id.startsWith(only)) {
  console.log(`${x.id.padEnd(30)} ${String(x.label).padEnd(24)} ${x.reading.slice(0, 160)}`);
  if (only) { for (const c of x.components) console.log('    ', c.active ? '*' : ' ', c.label, '=', c.value); for (const e of x.evidence) console.log('     ev', e.why, '|', e.title.slice(0, 90)); }
}
if (!only) { for (const c of m.counters) console.log('CNT', c.label, c.lastAt, c.title?.slice(0, 60)); for (const c of m.calendar) console.log('CAL', c.at, c.title.slice(0, 80)); }
