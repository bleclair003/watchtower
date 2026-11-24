/**
 * Disputed and breakaway areas (v0.71.0), from Natural Earth (public domain). Lines follow control on
 * the ground; `note` says who administers and who claims each area. Shown as context, not a position.
 */
export interface DisputedProps {
  id: string;
  name: string;
  /** e.g. "Admin. by India; Claimed by Pakistan". */
  note: string | null;
  /** Natural Earth's TYPE, e.g. "Disputed", "Breakaway", "Indeterminate". */
  kind: string;
  sovereign: string | null;
}

export interface DisputedDataset {
  type: 'FeatureCollection';
  source: { name: string; url: string; licence: string };
  retrievedAt: string;
  features: { type: 'Feature'; geometry: { type: 'MultiPolygon'; coordinates: [number, number][][][] }; properties: DisputedProps }[];
}
