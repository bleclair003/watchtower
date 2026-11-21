import { doc, FirestoreError, getDoc, setDoc } from 'firebase/firestore';
import { COLLECTIONS } from '@shared/domain/snapshot';
import { validateWatchlist, type Watchlist } from '@shared/domain/watchlist';
import { getFirebase } from './firebaseClient';

/**
 * Browser access to the signed-in user's watchlist (`watchlists/{uid}`; live / emulator only,
 * dynamically imported). Rules require each save to bump `version` by exactly one, so a save
 * from a stale copy (another tab or device) is rejected instead of overwriting newer work.
 */
export class WatchlistConflictError extends Error {
  constructor() {
    super('Your watchlist was changed elsewhere (another tab or device). Reload the page, then re-apply your change.');
    this.name = 'WatchlistConflictError';
  }
}

export async function loadWatchlist(uid: string): Promise<Watchlist | null> {
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, COLLECTIONS.watchlists, uid));
  return snap.exists() ? (snap.data() as Watchlist) : null;
}

/** Saves `next` (its version must be the stored version + 1, or 1 for a new list). */
export async function saveWatchlist(uid: string, next: Watchlist): Promise<void> {
  const problems = validateWatchlist(next);
  if (problems.length) throw new Error(`Watchlist not saved: ${problems.join('; ')}`);
  const { db } = getFirebase();
  try {
    await setDoc(doc(db, COLLECTIONS.watchlists, uid), next);
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied') throw new WatchlistConflictError();
    throw err;
  }
}
