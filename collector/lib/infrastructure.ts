import { readFileSync } from 'node:fs';
import type { InfraDataset, InfraSite } from '../../shared/domain/infrastructure.ts';

let cached: InfraSite[] | null = null;

/** Critical infrastructure the map shows (the app's static file), read once per process. */
export function loadInfrastructure(): InfraSite[] {
  if (cached) return cached;
  const d = JSON.parse(readFileSync(new URL('../../public/data/infrastructure.json', import.meta.url), 'utf8')) as InfraDataset;
  cached = d.sites;
  return cached;
}
