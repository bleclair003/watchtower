import { existsSync, readFileSync } from 'node:fs';
import { loadInfrastructure } from './infrastructure.ts';

let cached: { la: number; lo: number }[] | null = null;

/**
 * Ports for the AIS checks (v0.77.0): the watch-region ports in infrastructure.json plus ports and harbours
 * in Finland, Sweden, Denmark, Germany and Norway (public/data/ports-extra.json, Wikidata). Ships near any
 * of them are not taken for ships going dark or lingering over cables.
 */
export function loadPorts(): { la: number; lo: number }[] {
  if (cached) return cached;
  const out = loadInfrastructure().filter((s) => s.t === 'port').map((s) => ({ la: s.la, lo: s.lo }));
  const extra = new URL('../../public/data/ports-extra.json', import.meta.url);
  if (existsSync(extra)) {
    const d = JSON.parse(readFileSync(extra, 'utf8')) as { ports: { la: number; lo: number }[] };
    out.push(...d.ports.map((p) => ({ la: p.la, lo: p.lo })));
  }
  cached = out;
  return out;
}
