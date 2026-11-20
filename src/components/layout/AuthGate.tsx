import { useState, type ReactNode } from 'react';
import { KeyRound, Radar, ShieldAlert } from 'lucide-react';
import { backendMode } from '../../config/firebase';
import { useAuth } from '../../state/AuthContext';

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-4">
      <div className="w-full max-w-md border border-wt-line-strong bg-wt-panel">
        <div className="flex items-center gap-2 border-b border-wt-line bg-wt-bg2 px-3 py-2">
          <Radar size={16} aria-hidden />
          <span className="glow font-display tracking-[0.3em]">WATCHTOWER</span>
          <span className="ml-auto text-2xs tracking-widest text-wt-fg-dim">
            {backendMode === 'emulator' ? 'LOCAL EMULATOR' : 'LIVE'}
          </span>
        </div>
        <div className="space-y-3 p-4 text-xs">{children}</div>
      </div>
    </div>
  );
}

/**
 * Blocks the application until the operator is signed in AND authorized.
 * In demo mode it renders children immediately.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, isOwner, error, signIn, signInEmulatorTestUser, signOut, refreshClaims } = useAuth();
  const [testEmail, setTestEmail] = useState('operator@watchtower.test');
  const [checking, setChecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);

  if (status === 'not-required') return <>{children}</>;

  if (status === 'loading') {
    return (
      <Frame>
        <p className="tracking-widest text-wt-fg-muted">ESTABLISHING AUTHENTICATION LINK…</p>
      </Frame>
    );
  }

  if (status === 'signed-out') {
    return (
      <Frame>
        <p className="flex items-center gap-2 tracking-widest">
          <KeyRound size={14} aria-hidden /> OPERATOR AUTHENTICATION REQUIRED
        </p>
        <p className="text-wt-fg-muted">Access is restricted to the authorized owner account.</p>
        <button
          onClick={() => void signIn()}
          className="w-full border border-wt-fg/60 py-2 tracking-widest hover:bg-wt-fg hover:text-wt-bg"
        >
          SIGN IN WITH GOOGLE
        </button>
        {signInEmulatorTestUser && (
          <form
            className="space-y-1.5 border-t border-wt-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void signInEmulatorTestUser(testEmail);
            }}
          >
            <p className="text-2xs tracking-widest text-wt-info">EMULATOR TEST ACCOUNT (LOCAL ONLY)</p>
            <div className="flex gap-1.5">
              <input
                aria-label="Emulator test email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="h-7 min-w-0 flex-1 border border-wt-line-strong bg-wt-bg px-2 text-xs focus:border-wt-info focus:outline-none"
              />
              <button type="submit" className="border border-wt-info/60 px-3 text-2xs tracking-widest text-wt-info hover:bg-wt-info hover:text-wt-bg">
                SIGN IN
              </button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="text-wt-crit">{error}</p>}
      </Frame>
    );
  }

  if (!isOwner) {
    return (
      <Frame>
        <p className="flex items-center gap-2 tracking-widest text-wt-warn">
          <ShieldAlert size={14} aria-hidden /> ACCOUNT NOT AUTHORIZED
        </p>
        <dl className="grid grid-cols-[70px_1fr] gap-y-1 text-2xs">
          <dt className="text-wt-fg-dim">ACCOUNT</dt>
          <dd className="break-all">{user?.email ?? '(no email)'}</dd>
          <dt className="text-wt-fg-dim">UID</dt>
          <dd className="break-all text-wt-fg-muted">{user?.uid}</dd>
        </dl>
        <p className="text-wt-fg-muted">
          This account does not carry the <code className="text-wt-fg">owner</code> claim. Grant it once with the
          <span className="text-wt-fg"> Grant owner</span> GitHub workflow, or locally:
        </p>
        <pre className="overflow-x-auto border border-wt-line bg-wt-bg p-2 text-2xs">
          {backendMode === 'emulator' ? 'npm run grant-owner:emulator' : 'npm run grant-owner'} -- {user?.email ?? '<email>'}
        </pre>
        <div className="flex gap-2">
          <button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              setRecheckMsg(null);
              await refreshClaims();
              setChecking(false);
              setRecheckMsg('Claim not present yet.');
            }}
            className="flex-1 border border-wt-fg/60 py-1.5 tracking-widest hover:bg-wt-fg hover:text-wt-bg disabled:opacity-50"
          >
            {checking ? 'CHECKING…' : 'RECHECK ACCESS'}
          </button>
          <button onClick={() => void signOut()} className="border border-wt-line-strong px-3 text-wt-fg-muted hover:text-wt-fg">
            SIGN OUT
          </button>
        </div>
        {recheckMsg && <p className="text-2xs text-wt-fg-dim">{recheckMsg}</p>}
      </Frame>
    );
  }

  return <>{children}</>;
}
