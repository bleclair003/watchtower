import { XMLParser } from 'fast-xml-parser';

/** Normalized view of one RSS <item> or Atom <entry>. All fields are raw, untrusted strings. */
export interface FeedItem {
  title: string;
  link: string;
  description: string;
  published: string;
  guid: string;
  categories: { domain: string; value: string }[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  // Never expand DTD entities from untrusted documents (billion-laughs / XXE hardening).
  processEntities: false,
  htmlEntities: false,
  isArray: (name) => ['item', 'entry', 'category', 'link'].includes(name),
  trimValues: true,
});

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  return '';
}

/**
 * Text of an Atom `type="xhtml"` element: the parser turns the inline XHTML into nested
 * objects, so collect every text node in document order (depth-limited).
 */
function deepText(v: unknown, depth = 0): string {
  if (v == null || depth > 8) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => deepText(x, depth + 1)).join(' ');
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !k.startsWith('@'))
      .map(([, x]) => deepText(x, depth + 1))
      .join(' ');
  }
  return '';
}

/** Basic XML entity decoding (processEntities is off for safety). */
function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedParseError';
  }
}

export function parseFeed(xml: string): FeedItem[] {
  if (/<!ENTITY/i.test(xml)) throw new FeedParseError('Feed declares XML entities; refused');
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new FeedParseError(`XML parse failed: ${(err as Error).message}`);
  }

  const rss = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  if (rss) {
    const items = (rss.item as Record<string, unknown>[] | undefined) ?? [];
    return items.map((it) => ({
      title: xmlDecode(text(it.title)),
      link: xmlDecode(text((it.link as unknown[] | undefined)?.[0])),
      description: xmlDecode(text(it.description)),
      published: text(it.pubDate) || text(it['dc:date']),
      guid: xmlDecode(text(it.guid)),
      categories: ((it.category as unknown[] | undefined) ?? []).map((c) => ({
        domain: typeof c === 'object' && c ? String((c as Record<string, unknown>)['@domain'] ?? '') : '',
        value: xmlDecode(text(c)),
      })),
    }));
  }

  const atom = doc.feed as Record<string, unknown> | undefined;
  if (atom) {
    const entries = (atom.entry as Record<string, unknown>[] | undefined) ?? [];
    return entries.map((e) => {
      const links = (e.link as Record<string, unknown>[] | undefined) ?? [];
      const alt = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
      return {
        title: xmlDecode(text(e.title)),
        link: String(alt?.['@href'] ?? ''),
        description: xmlDecode(text(e.summary) || text(e.content) || deepText(e.summary) || deepText(e.content)).replace(/\s+/g, ' ').trim(),
        published: text(e.published) || text(e.updated),
        guid: text(e.id),
        categories: ((e.category as Record<string, unknown>[] | undefined) ?? []).map((c) => ({
          domain: String(c['@scheme'] ?? ''),
          value: String(c['@term'] ?? ''),
        })),
      };
    });
  }

  throw new FeedParseError('Document is neither RSS 2.0 nor Atom');
}
