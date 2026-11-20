/**
 * localStorage wrapper. Storage can be unavailable (private mode, blocked
 * site data) — every access is guarded and the app must work without it.
 * Phase 2 moves operator settings to Firestore `userSettings`.
 */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — settings simply won't persist this session */
  }
}
