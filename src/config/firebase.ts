/**
 * Firebase web configuration.
 *
 * These values are NOT secrets — Firebase web config is designed to ship in
 * the browser bundle. Access control is enforced by Firestore security rules
 * and Firebase Authentication (see firestore.rules). Privileged credentials
 * (service-account keys, Discord webhooks) must only ever exist as GitHub
 * Actions secrets used by the collector, never here.
 *
 * Modes:
 *  - demo:     no config → fixture data, no network database.
 *  - emulator: VITE_USE_FIREBASE_EMULATORS=true → local Auth + Firestore emulators.
 *  - live:     full web config present → real Firebase project.
 * VITE_FORCE_DEMO=true always selects demo mode.
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

export const useFirebaseEmulators = read('VITE_USE_FIREBASE_EMULATORS') === 'true';
const forceDemo = read('VITE_FORCE_DEMO') === 'true';

/** Emulator project ids must start with "demo-" so they can never touch real resources. */
export const EMULATOR_PROJECT_ID = 'demo-watchtower';

export const firebaseConfig: FirebaseWebConfig | null = (() => {
  if (forceDemo) return null;
  if (useFirebaseEmulators) {
    return { apiKey: 'emulator', authDomain: 'localhost', projectId: EMULATOR_PROJECT_ID, appId: 'emulator' };
  }
  const cfg = {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
  };
  return Object.values(cfg).every(Boolean) ? cfg : null;
})();

export const isFirebaseConfigured = firebaseConfig !== null;

export type BackendMode = 'demo' | 'emulator' | 'live';
export const backendMode: BackendMode = !firebaseConfig ? 'demo' : useFirebaseEmulators ? 'emulator' : 'live';
