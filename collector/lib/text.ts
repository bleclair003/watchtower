/**
 * Source content is UNTRUSTED. Everything that reaches Firestore passes
 * through these helpers: HTML is reduced to plain text, entities decoded,
 * control characters removed, and lengths capped.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** HTML → single-spaced plain text. Script/style contents are discarded. */
export function htmlToText(html: string): string {
  // Feeds sometimes double-encode HTML (&lt;p&gt;); decode first so tags can be stripped.
  let s = /&lt;\/?[a-z]/i.test(html) ? decodeEntities(html) : html;
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|li|h\d|div|tr)>|<br\s*\/?>/gi, '. ')
    // Inline formatting tags join words; block-level tags were turned into sentence breaks above.
    .replace(/<\/?(b|strong|em|i|u|span|a|sup|sub|font|abbr|code)(?=[\s/>])[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  return cleanText(s)
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/(\.\s*){2,}/g, '. ')
    .replace(/^\.\s*/, '');
}

/** C0/C1 controls, zero-width and bidi-override characters (used to disguise text). */
// oxlint-disable-next-line no-control-regex -- stripping control characters is the purpose
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]', 'g');

/** Removes control characters and collapses whitespace. */
export function cleanText(s: string): string {
  return s.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}

/** Truncates at a word boundary, appending an ellipsis. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/** Accept only absolute http(s) URLs; returns the normalized href or null. */
export function safeUrl(raw: unknown, base?: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export const LIMITS = { title: 300, summary: 600 } as const;
