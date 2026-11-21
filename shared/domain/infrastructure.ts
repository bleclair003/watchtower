/**
 * Phase 15 item 2: critical infrastructure in the watch-region countries, and records near or
 * naming it. The static file public/data/infrastructure.json is built by
 * scripts/build-infrastructure.ts from:
 *  - WRI Global Power Plant Database v1.3.0 (CC BY 4.0; data to 2021): plants of 500 MW or more,
 *    and every nuclear plant
 *  - Wikidata (CC0): nuclear power plants, oil refineries, dams and ports with an English
 *    Wikipedia article (a notability bar), to add sites built after 2021 and other kinds
 */

export const INFRA_TYPES = ['nuclear', 'power', 'refinery', 'dam', 'port'] as const;
export type InfraType = (typeof INFRA_TYPES)[number];
export const INFRA_LABEL: Record<InfraType, string> = { nuclear: 'Nuclear power plant', power: 'Power plant (500 MW+)', refinery: 'Oil refinery', dam: 'Dam', port: 'Port' };

/** Location matches within this distance (km): a wider ring for nuclear plants. */
export const INFRA_RADIUS_KM: Record<InfraType, number> = { nuclear: 10, power: 5, refinery: 5, dam: 5, port: 5 };

/** Compact record from public/data/infrastructure.json. */
export interface InfraSite {
  /** `gppd:<id>` or `wd:<Q-id>` */
  id: string;
  /** Names it is known by (first = display name). */
  n: string[];
  t: InfraType;
  la: number;
  lo: number;
  /** Country, ISO alpha-2 (Crimea follows the internationally recognised border). */
  c: string;
  /** Primary fuel (power plants). */
  f?: string;
  /** Capacity in MW (power plants). */
  mw?: number;
  /** English Wikipedia title, if known. */
  w?: string | null;
  /** Source: 'wri' or 'wikidata' (or both). */
  s: string[];
}

export interface InfraDataset {
  sources: { name: string; url: string; licence: string; dataCurrency: string }[];
  retrievedAt: string;
  count: number;
  sites: InfraSite[];
}

export interface InfraMatch {
  title: string;
  url: string;
  at: string;
  how: 'near' | 'named';
  /** Distance in km for location matches. */
  km?: number;
  /** The record is a strike/attack headline or a fire detection. */
  kind: 'fire' | 'strike' | 'military' | 'mention';
}

export interface FlaggedSite {
  id: string;
  name: string;
  type: InfraType;
  country: string;
  lat: number;
  lon: number;
  regionIds: string[];
  near: number;
  named: number;
  latestAt: string;
  matches: InfraMatch[];
}

export interface InfrastructureSnapshot {
  computedAt: string;
  windowHours: number;
  sitesChecked: number;
  flagged: FlaggedSite[];
  simulated?: boolean;
}
