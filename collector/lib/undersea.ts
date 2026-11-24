import { readFileSync } from 'node:fs';
import type { UnderseaDataset, UnderseaLine } from '../../shared/domain/undersea.ts';

let cached: UnderseaLine[] | null = null;

/** Undersea cables and pipelines the map shows (the app's static file), read once per process. */
export function loadUndersea(): UnderseaLine[] {
  if (cached) return cached;
  const d = JSON.parse(readFileSync(new URL('../../public/data/undersea.json', import.meta.url), 'utf8')) as UnderseaDataset;
  cached = d.lines;
  return cached;
}
