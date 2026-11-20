import { createHash } from 'node:crypto';

/**
 * Stable content hash used as the Firestore document id for events, which
 * makes ingestion idempotent: the same source item always maps to the same id.
 */
export function contentHash(...parts: (string | number | null | undefined)[]): string {
  const normalized = parts.map((p) => String(p ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).join('\u001f');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
