import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { backendMode, useFirebaseEmulators } from '../config/firebase';

/**
 * Operator authentication.
 *
 * Demo mode needs no sign-in. Live/emulator mode requires Firebase Auth (Google
 * provider) AND the `owner` custom claim, which is granted out-of-band with
 * `npm run grant-owner` (Admin SDK) — so no UID or email is hard-coded in the
 * repository or the security rules.
 */
export interface OperatorUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type AuthStatus = 'not-required' | 'loading' | 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  user: OperatorUser | null;
  /** True when the ID token carries owner=true. null while unknown. */
  isOwner: boolean | null;
  error: string | null;
  signIn: () => Promise<void>;
  /** Emulator only: signs in (creating if needed) a local email/password test account. */
  signInEmulatorTestUser: ((email: string) => Promise<void>) | null;
  signOut: () => Promise<void>;
  /** Force-refreshes the ID token so a newly granted claim takes effect. */
  refreshClaims: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Fixed password for throwaway accounts in the LOCAL Auth emulator only (demo- project, never real). */
const EMULATOR_TEST_PASSWORD = 'emulator-only-test-password';

function describeAuthError(err: unknown): string {
  const code = (err as { code?: string }).code;
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled in the Firebase console (Authentication → Sign-in method).';
  if (code === 'auth/unauthorized-domain') return 'This domain is not authorized in Firebase Authentication → Settings → Authorized domains.';
  return err instanceof Error ? err.message : String(err);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const required = backendMode !== 'demo';
  const [status, setStatus] = useState<AuthStatus>(required ? 'loading' : 'not-required');
  const [user, setUser] = useState<OperatorUser | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(required ? null : true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!required) return;
    let unsub = () => {};
    let cancelled = false;
    (async () => {
      const [{ getFirebase }, { onAuthStateChanged, getRedirectResult }] = await Promise.all([
        import('../data/firebaseClient'),
        import('firebase/auth'),
      ]);
      if (cancelled) return;
      const { auth } = getFirebase();
      // Completes a redirect sign-in (if one is in flight) and surfaces its errors.
      getRedirectResult(auth).catch((err: unknown) => setError(describeAuthError(err)));
      unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          setUser(null);
          setIsOwner(null);
          setStatus('signed-out');
          return;
        }
        const token = await u.getIdTokenResult();
        setUser({ uid: u.uid, email: u.email, displayName: u.displayName });
        setIsOwner(token.claims.owner === true);
        setStatus('signed-in');
      });
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('signed-out');
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [required]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const [{ getFirebase }, { GoogleAuthProvider, signInWithPopup, signInWithRedirect }] = await Promise.all([
        import('../data/firebaseClient'),
        import('firebase/auth'),
      ]);
      const { auth } = getFirebase();
      const provider = new GoogleAuthProvider();
      // Emulator: redirect is reliable on localhost. Live: popup, falling back to redirect if blocked.
      if (useFirebaseEmulators) {
        await signInWithRedirect(auth, provider);
        return;
      }
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw err;
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setError(describeAuthError(err));
    }
  }, []);

  const signInEmulatorTestUser = useCallback(async (email: string) => {
    setError(null);
    const [{ getFirebase }, { signInWithEmailAndPassword, createUserWithEmailAndPassword }] = await Promise.all([
      import('../data/firebaseClient'),
      import('firebase/auth'),
    ]);
    const { auth } = getFirebase();
    try {
      await signInWithEmailAndPassword(auth, email, EMULATOR_TEST_PASSWORD);
    } catch {
      try {
        await createUserWithEmailAndPassword(auth, email, EMULATOR_TEST_PASSWORD);
      } catch (err) {
        setError(describeAuthError(err));
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    const [{ getFirebase }, { signOut: fbSignOut }] = await Promise.all([import('../data/firebaseClient'), import('firebase/auth')]);
    await fbSignOut(getFirebase().auth);
  }, []);

  const refreshClaims = useCallback(async () => {
    const { getFirebase } = await import('../data/firebaseClient');
    const u = getFirebase().auth.currentUser;
    if (!u) return;
    const token = await u.getIdTokenResult(true);
    setIsOwner(token.claims.owner === true);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      isOwner,
      error,
      signIn,
      signInEmulatorTestUser: useFirebaseEmulators ? signInEmulatorTestUser : null,
      signOut,
      refreshClaims,
    }),
    [status, user, isOwner, error, signIn, signInEmulatorTestUser, signOut, refreshClaims],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
