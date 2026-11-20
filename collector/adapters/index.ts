import type { SourceAdapter } from './types.ts';
import { stateTravelAdvisories } from './stateTravelAdvisories.ts';
import { cisaAdvisories } from './cisaAdvisories.ts';
import { cisaKev } from './cisaKev.ts';

/** Active adapters. Adding a source = write an adapter + register it here. */
export const ADAPTERS: SourceAdapter<never>[] = [
  stateTravelAdvisories as SourceAdapter<never>,
  cisaAdvisories as SourceAdapter<never>,
  cisaKev as SourceAdapter<never>,
];
