import { readFileSync } from 'node:fs';
import type { InstallationDataset, WorldDataset } from '../../shared/domain/installations.ts';
import { buildBaseMatcher, dodBaseRef, worldBaseRef, type BaseRef } from '../../shared/domain/baseActivity.ts';

let cached: { refs: BaseRef[]; matcher: ReturnType<typeof buildBaseMatcher> } | null = null;

/** All installations the map shows (the app's static files), and a matcher over them; built once per process. */
export function loadBases(): { refs: BaseRef[]; matcher: ReturnType<typeof buildBaseMatcher> } {
  if (cached) return cached;
  const read = <T>(f: string) => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8')) as T;
  const refs = [...read<InstallationDataset>('installations-us.json').installations.map(dodBaseRef), ...read<WorldDataset>('installations-world.json').installations.map(worldBaseRef)];
  cached = { refs, matcher: buildBaseMatcher(refs) };
  return cached;
}
