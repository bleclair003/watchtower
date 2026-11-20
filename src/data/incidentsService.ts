import { collection, deleteDoc, doc, FirestoreError, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { COLLECTIONS } from '@shared/domain/snapshot';
import type { Incident } from '@shared/domain/incidents/types';
import { validateIncident } from '@shared/domain/incidents/logic';
import { getFirebase } from './firebaseClient';

/**
 * Browser access to incident dossiers (live / emulator only; dynamically
 * imported). Security rules require each update to bump `version` by exactly
 * one, so a save from a stale copy is rejected instead of overwriting newer work.
 */
export class DossierConflictError extends Error {
  constructor() {
    super('This dossier was changed elsewhere (another tab or device). Reload it, then re-apply your edits.');
    this.name = 'DossierConflictError';
  }
}

export async function listIncidents(): Promise<Incident[]> {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, COLLECTIONS.incidents), orderBy('updatedAt', 'desc'), limit(100)));
  return snap.docs.map((d) => d.data() as Incident);
}

export async function getIncident(id: string): Promise<Incident | null> {
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, COLLECTIONS.incidents, id));
  return snap.exists() ? (snap.data() as Incident) : null;
}

/**
 * Saves `next` as the successor of the stored version `baseVersion`.
 * New dossiers are saved with baseVersion 0 (stored as version 1).
 * Returns the incident as stored.
 */
export async function saveIncident(next: Incident, baseVersion: number): Promise<Incident> {
  const stored: Incident = { ...next, version: baseVersion + 1, updatedAt: new Date().toISOString() };
  const problems = validateIncident(stored);
  if (problems.length) throw new Error(problems.join('; '));
  const { db } = getFirebase();
  try {
    await setDoc(doc(db, COLLECTIONS.incidents, stored.id), stored);
  } catch (err) {
    if (err instanceof FirestoreError && err.code === 'permission-denied' && baseVersion > 0) throw new DossierConflictError();
    throw err;
  }
  return stored;
}

export async function deleteIncident(id: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, COLLECTIONS.incidents, id));
}
