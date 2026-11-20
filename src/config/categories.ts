import type { EventCategory, Credibility, SourceClass, SourceHealth } from '@shared/domain/types';

/**
 * Presentation metadata for event categories.
 *
 * Categories are distinguished primarily by SHAPE (so they remain legible
 * for colour-blind operators and in monochrome). Red and amber are reserved
 * for severity and system status, so they are never used as category colours.
 *
 * `path` is an SVG path in a 24×24 box. It is rendered both as an inline SVG
 * (legend, feed) and rasterized into a map icon via Path2D, so the two always
 * match.
 */
export interface CategoryStyle {
  id: EventCategory;
  label: string;
  code: string;
  path: string;
}

export const CATEGORY_STYLES: Record<EventCategory, CategoryStyle> = {
  military: { id: 'military', label: 'Military', code: 'MIL', path: 'M12 3 L21 20 L3 20 Z' },
  diplomatic: {
    id: 'diplomatic',
    label: 'Diplomatic',
    code: 'DIP',
    path: 'M4 12 A8 8 0 1 0 20 12 A8 8 0 1 0 4 12 Z',
  },
  aviation: { id: 'aviation', label: 'Aviation', code: 'AVN', path: 'M12 2 L22 12 L12 22 L2 12 Z' },
  maritime: { id: 'maritime', label: 'Maritime', code: 'MAR', path: 'M3 4 L21 4 L12 21 Z' },
  cyber: { id: 'cyber', label: 'Cyber', code: 'CYB', path: 'M4 4 H20 V20 H4 Z' },
  unrest: {
    id: 'unrest',
    label: 'Civil unrest',
    code: 'UNR',
    path: 'M9 3 H15 V9 H21 V15 H15 V21 H9 V15 H3 V9 H9 Z',
  },
  disaster: {
    id: 'disaster',
    label: 'Disaster / humanitarian',
    code: 'HAZ',
    path: 'M12 2 L20.66 7 L20.66 17 L12 22 L3.34 17 L3.34 7 Z',
  },
  economic: {
    id: 'economic',
    label: 'Economic',
    code: 'ECO',
    path: 'M12 2 L22 9.5 L18 21 L6 21 L2 9.5 Z',
  },
  official: { id: 'official', label: 'Other official', code: 'OFF', path: 'M3 7 H21 V17 H3 Z' },
  general: {
    id: 'general',
    label: 'General news',
    code: 'GEN',
    path: 'M5 3 L12 10 L19 3 L21 5 L14 12 L21 19 L19 21 L12 14 L5 21 L3 19 L10 12 L3 5 Z',
  },
};

export const CREDIBILITY_LABELS: Record<Credibility, { label: string; code: string; tone: Tone }> = {
  official: { label: 'Official statement', code: 'OFFICIAL', tone: 'info' },
  corroborated: { label: 'Independently corroborated', code: 'CORROB', tone: 'ok' },
  'single-source': { label: 'Single-source reporting', code: 'SINGLE', tone: 'muted' },
  unverified: { label: 'Unverified claim', code: 'UNVERIF', tone: 'warn' },
  experimental: { label: 'Speculative / experimental', code: 'EXPER', tone: 'muted' },
};

export const SOURCE_CLASS_LABELS: Record<SourceClass, string> = {
  official: 'Official',
  media: 'Media',
  aggregator: 'Aggregator',
  scientific: 'Scientific',
};

export type Tone = 'ok' | 'info' | 'warn' | 'crit' | 'muted' | 'inactive';

export const HEALTH_TONE: Record<SourceHealth, Tone> = {
  ONLINE: 'ok',
  DEGRADED: 'warn',
  STALE: 'warn',
  OFFLINE: 'crit',
  NOT_CONFIGURED: 'inactive',
};
