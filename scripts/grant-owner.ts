/**
 * Grants (or revokes) the WATCHTOWER `owner` custom claim for a Firebase Auth user.
 *
 *   npm run grant-owner -- you@example.com            # grant
 *   npm run grant-owner -- you@example.com --revoke   # revoke
 *
 * The user must have signed in to WATCHTOWER once so the account exists.
 *
 * Environment:
 *   WATCHTOWER_PROJECT_ID          Firebase project id (required)
 *   FIREBASE_AUTH_EMULATOR_HOST    e.g. 127.0.0.1:9099 to target the Auth emulator
 * Credentials: Application Default Credentials (gcloud auth application-default
 * login, or GOOGLE_APPLICATION_CREDENTIALS) — never stored in this repository.
 */
import { parseArgs } from 'node:util';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { revoke: { type: 'boolean', default: false } } });
  const email = positionals[0]?.trim();
  const projectId = process.env.WATCHTOWER_PROJECT_ID?.trim();
  if (!email || !projectId) {
    console.error('Usage: WATCHTOWER_PROJECT_ID=<id> npm run grant-owner -- <email> [--revoke]');
    return 1;
  }
  const emulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  process.env.GOOGLE_CLOUD_PROJECT ??= projectId;
  initializeApp(emulator ? { projectId } : { projectId, credential: applicationDefault() });
  const auth = getAuth();

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    console.error(`No Firebase Auth user with that email in project ${projectId}. Sign in to WATCHTOWER once first.`);
    return 1;
  }
  const claims = { ...(user.customClaims ?? {}) };
  if (values.revoke) delete claims.owner;
  else claims.owner = true;
  await auth.setCustomUserClaims(user.uid, claims);
  // Run logs are public: no uid or email here.
  console.log(`${values.revoke ? 'Revoked' : 'Granted'} owner claim${emulator ? ' (emulator)' : ''}.`);
  console.log('The user must click RECHECK ACCESS (or sign out and in) for the change to take effect.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('FATAL:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
