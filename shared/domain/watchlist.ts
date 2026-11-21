import type { IntelligenceEvent } from './types.ts';
import { ALERT_SEVERITIES, type AlertSeverity } from './alerts/types.ts';

/**
 * Phase 13 item 18: the owner's own watchlist of people, units, bases or terms. Matching records
 * are highlighted in the app; items marked `alert` also raise alerts in the collector (one per new
 * matching record, through the normal alert store, cooldown and Discord delivery).
 *
 * Stored per user at `watchlists/{uid}` (one document; shape enforced by Firestore rules).
 */

export const WATCH_KINDS = ['person', 'unit', 'base', 'term'] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];
export const WATCH_KIND_LABEL: Record<WatchKind, string> = { person: 'Person', unit: 'Unit', base: 'Base', term: 'Term' };

export const WATCHLIST_LIMITS = { items: 100, termMin: 3, termMax: 80, aliases: 5, cooldownMinutes: 60 };

export interface WatchItem {
  /** Stable id: lower-case term with spaces as dashes (unique within the list). */
  id: string;
  term: string;
  kind: WatchKind;
  /** Other spellings ("Wagner" / "Africa Corps"). */
  aliases: string[];
  /** Raise an alert (and a Discord message, if configured) for each new matching record. */
  alert: boolean;
  severity: AlertSeverity;
  createdAt: string;
}

export interface Watchlist {
  items: WatchItem[];
  updatedAt: string;
  /** Bumped by 1 on every save (optimistic concurrency, enforced by the rules). */
  version: number;
}

export const watchItemId = (term: string) =>
  term
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const isString = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.length <= max;

/** Problems with a stored or edited watchlist (empty = valid). Mirrors the Firestore rules, plus deeper checks. */
export function validateWatchlist(w: unknown): string[] {
  const out: string[] = [];
  if (!w || typeof w !== 'object') return ['not an object'];
  const d = w as Partial<Watchlist>;
  if (!Array.isArray(d.items)) return ['items must be a list'];
  if (d.items.length > WATCHLIST_LIMITS.items) out.push(`at most ${WATCHLIST_LIMITS.items} items`);
  const ids = new Set<string>();
  d.items.forEach((it, i) => {
    const p = `item ${i + 1}`;
    if (!it || typeof it !== 'object') return out.push(`${p}: not an object`);
    if (!isString(it.term, WATCHLIST_LIMITS.termMin, WATCHLIST_LIMITS.termMax)) out.push(`${p}: term must be ${WATCHLIST_LIMITS.termMin}–${WATCHLIST_LIMITS.termMax} characters`);
    if (typeof it.id !== 'string' || !it.id || it.id !== watchItemId(String(it.term ?? ''))) out.push(`${p}: id does not match the term`);
    else if (ids.has(it.id)) out.push(`${p}: duplicate of an earlier item`);
    else ids.add(it.id);
    if (!WATCH_KINDS.includes(it.kind as WatchKind)) out.push(`${p}: unknown kind`);
    if (!Array.isArray(it.aliases) || it.aliases.length > WATCHLIST_LIMITS.aliases || !it.aliases.every((a) => isString(a, WATCHLIST_LIMITS.termMin, WATCHLIST_LIMITS.termMax)))
      out.push(`${p}: up to ${WATCHLIST_LIMITS.aliases} other spellings of ${WATCHLIST_LIMITS.termMin}–${WATCHLIST_LIMITS.termMax} characters`);
    if (typeof it.alert !== 'boolean') out.push(`${p}: alert must be true or false`);
    if (!ALERT_SEVERITIES.includes(it.severity as AlertSeverity)) out.push(`${p}: unknown severity`);
    if (typeof it.createdAt !== 'string') out.push(`${p}: missing createdAt`);
  });
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) out.push('version must be a positive whole number');
  if (typeof d.updatedAt !== 'string') out.push('missing updatedAt');
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface WatchHit {
  item: WatchItem;
  /** The spelling found in the record. */
  matched: string;
}

/**
 * Matcher for a watchlist: whole words, any case, in the title or summary. Short all-capital terms
 * ("IRGC", "PLA") match only in capitals, so "pla" inside other text never counts.
 */
export function compileWatchlist(items: WatchItem[]): (e: IntelligenceEvent) => WatchHit[] {
  const compiled = items.flatMap((item) =>
    [item.term, ...item.aliases].map((spelling) => {
      const s = spelling.trim();
      const acronym = s.length <= 5 && s === s.toUpperCase() && /\p{Lu}/u.test(s);
      const body = escape(s).replace(/\s+/g, '\\s+');
      return { item, spelling: s, re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, acronym ? 'u' : 'iu') };
    }),
  );
  return (e) => {
    const text = `${e.title} ${e.summary ?? ''}`;
    const hits = new Map<string, WatchHit>();
    for (const c of compiled) if (!hits.has(c.item.id) && c.re.test(text)) hits.set(c.item.id, { item: c.item, matched: c.spelling });
    return [...hits.values()];
  };
}

export const EMPTY_WATCHLIST: Watchlist = { items: [], updatedAt: new Date(0).toISOString(), version: 0 };
