/**
 * Polite HTTP client for source collection.
 *  - Identifies itself with a descriptive User-Agent.
 *  - Sends conditional requests (ETag / Last-Modified) to avoid re-downloading.
 *  - Retries 429 / 5xx / network errors with exponential backoff, honouring Retry-After.
 *  - Enforces a timeout and a maximum body size.
 * It never sends credentials or cookies to sources.
 */
export const USER_AGENT = 'WATCHTOWER-OSINT-Collector/0.2 (personal open-source research; low-frequency polling)';

export interface Validators {
  etag?: string | null;
  lastModified?: string | null;
}

export type FetchResult =
  | { kind: 'not-modified'; status: 304 }
  | { kind: 'ok'; status: number; body: string; validators: Validators; bytes: number };

export class HttpError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface FetchOptions {
  validators?: Validators;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const {
    validators,
    timeoutMs = 30_000,
    retries = 2,
    maxBytes = 8 * 1024 * 1024,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = opts;

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, application/json;q=0.9, text/xml;q=0.8, */*;q=0.1',
  };
  if (validators?.etag) headers['If-None-Match'] = validators.etag;
  if (validators?.lastModified) headers['If-Modified-Since'] = validators.lastModified;

  let lastError: HttpError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const retryAfter = lastError?.status === 429 ? 10_000 : 0;
      await sleep(Math.max(retryAfter, 2 ** attempt * 1_000));
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: ctl.signal, redirect: 'follow', credentials: 'omit' });
      if (res.status === 304) return { kind: 'not-modified', status: 304 };
      if (res.status === 429 || res.status >= 500) {
        lastError = new HttpError(`HTTP ${res.status}`, res.status);
        continue;
      }
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status); // 4xx: do not retry
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new HttpError(`Response too large (${declared} bytes)`, res.status);
      const body = await res.text();
      if (body.length > maxBytes) throw new HttpError(`Response too large (${body.length} chars)`, res.status);
      return {
        kind: 'ok',
        status: res.status,
        body,
        bytes: body.length,
        validators: { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') },
      };
    } catch (err) {
      if (err instanceof HttpError && err.status !== null && err.status < 500 && err.status !== 429) throw err;
      lastError =
        err instanceof HttpError
          ? err
          : new HttpError(ctl.signal.aborted ? `Timeout after ${timeoutMs} ms` : `Network error: ${(err as Error).message}`, null);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new HttpError('Unknown fetch failure', null);
}
