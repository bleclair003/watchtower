/**
 * Firebase web configuration.
 *
 * These values are NOT secrets — Firebase web config is designed to ship in
 * the browser bundle. Access control is enforced by Firestore security rules
 * and Firebase Authentication (see firestore.rules). Privileged credentials
 * (service-account keys, Discord webhooks) must only ever exist as GitHub
 * Actions secrets used by the collector, never here.
 *
 * The Firebase SDK is intentionally not installed until Phase 2, when the
 * Firestore repository is implemented.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function read(name: string): string {
  return (import.meta.env[name] as string | undefined)?.trim() ?? '';
}

export const firebaseConfig: FirebaseWebConfig | null = (() => {
  const cfg = {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
  };
  return Object.values(cfg).every(Boolean) ? cfg : null;
})();

export const isFirebaseConfigured = firebaseConfig !== null;
