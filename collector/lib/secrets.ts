/**
 * API keys for free-key sources.
 *
 * Keys come only from environment variables (GitHub Actions secrets in production, a local
 * shell for testing), never from files in the repository. Every key that is read is
 * registered for redaction, so it cannot leak through an error message, a log line or a
 * stored `lastError` — even if a library echoes the request URL.
 */
const registered = new Set<string>();

/** Reads a key from the environment, registering it for redaction. Returns null when unset. */
export function readSecret(name: string): string | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  if (v.length >= 6) registered.add(v);
  return v;
}

/** For tests: register a value without reading the environment. */
export function registerSecret(value: string): void {
  if (value.length >= 6) registered.add(value);
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const s of registered) out = out.split(s).join('[redacted]');
  return out;
}
