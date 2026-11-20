import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig, useFirebaseEmulators } from '../config/firebase';

/**
 * Lazily-initialized Firebase client. This module is only ever loaded via
 * dynamic import, so demo mode never downloads the Firebase SDK.
 */
let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

export function getFirebase() {
  if (cached) return cached;
  if (!firebaseConfig) throw new Error('Firebase is not configured');
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (useFirebaseEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  cached = { app, auth, db };
  return cached;
}
