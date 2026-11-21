import { readFileSync } from 'node:fs';
import { selectMarkets } from '../shared/domain/predictionMarkets.ts';
const ev = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sel = selectMarkets(ev, Date.now());
console.log('tracked', sel.length, 'bytes', JSON.stringify(sel).length);
for (const m of sel) console.log(m.regionIds.join(',').padEnd(26), `${Math.round(m.yes * 100)}%`.padStart(4), (m.change24h === null ? '  —' : `${m.change24h > 0 ? '+' : ''}${Math.round(m.change24h * 100)}`).padStart(4), '|', m.question.slice(0, 80));
const skipped = ev.filter((e: { title: string }) => !sel.some((m) => m.eventTitle === e.title)).map((e: { title: string }) => e.title);
console.log('not tracked:', skipped.slice(0, 25).join(' || '));
