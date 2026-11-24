import { collection, deleteDoc, doc, FirestoreError, getDocs, limit, query, setDoc } from 'firebase/firestore';
import { COLLECTIONS } from '@shared/domain/snapshot';
import { fromStored, toStored, validateWatchArea, type WatchArea } from '@shared/domain/watchAreas';
import { getFirebase } from './firebaseClient';

/**
 * Browser access to watch areas (`watchAreas/{id}`; live / emulator only, dynamically imported). Rules
 * require each save to bump `version` by exactly one, so a stale copy cannot overwrite newer work.
 */
export async function listWatchAreas(): Promise<WatchArea[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.watchAreas), limit(100)));
  return snap.docs.map((d) => fromStored({ ...d.data(), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveWatchArea(a: WatchArea): Promise<void> {
  const problems = validateWatchArea(a);
  if (problems.length) throw new Error(problems.join(' '));
  const { db } = getFirebase();
  try {
    await setDoc(doc(db, COLLECTIONS.watchAreas, a.id), toStored(a));
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied')
      throw new Error('The database refused the save: the area was changed elsewhere (reload and try again), or you cannot edit areas.');
    throw err;
  }
}

export async function deleteWatchArea(id: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, COLLECTIONS.watchAreas, id));
}
