import { useCallback, useEffect, useMemo, useState } from 'react';
import { ASSIGNABLE_ROLES, ROLE_HELP, ROLE_LABEL, effectiveRole, type Member, type MemberRole, type Role } from '@shared/domain/members';
import { useData } from '../state/DataContext';
import { useAuth } from '../state/AuthContext';
import { useNow } from '../hooks/useNow';
import { formatAge, formatUtc } from '../lib/time';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';

type Service = typeof import('../data/membersService');

const ROLE_TONE: Record<Role, 'ok' | 'info' | 'warn' | 'crit' | 'inactive'> = {
  owner: 'ok',
  editor: 'info',
  viewer: 'ok',
  pending: 'warn',
  blocked: 'crit',
};
const ORDER: Record<Role, number> = { pending: 0, owner: 1, editor: 2, viewer: 3, blocked: 4 };
const ROLES_SHOWN: Role[] = ['owner', 'editor', 'viewer', 'pending', 'blocked'];

/** Owner-only: who has signed in, and what each person may do (v0.60.0). */
export default function UsersPage() {
  const { mode } = useData();
  const live = mode !== 'demo';
  const { can, user } = useAuth();
  const allowed = can('manageUsers');
  const now = useNow(60_000).getTime();
  const [svc, setSvc] = useState<Service | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'WATCHTOWER // USERS';
    if (live && allowed) import('../data/membersService').then(setSvc, (e: unknown) => setError(String(e)));
  }, [live, allowed]);

  const load = useCallback(async () => {
    if (!svc) return;
    try {
      setMembers(await svc.listMembers());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [svc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(uid: string, fn: () => Promise<void>) {
    setBusy(uid);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const rows = useMemo(
    () =>
      (members ?? [])
        .map((m) => ({ m, role: effectiveRole(m.ownerAccount, m) }))
        .sort((a, b) => ORDER[a.role] - ORDER[b.role] || b.m.lastSeenAt.localeCompare(a.m.lastSeenAt)),
    [members],
  );
  const waiting = rows.filter((r) => r.role === 'pending').length;

  if (!allowed) {
    return (
      <div className="h-full overflow-y-auto p-1.5">
        <Panel title="People & access" designator="U1">
          <p className="p-3 text-xs text-wt-fg-muted">Only the owner manages people.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel
        title="People & access"
        designator="U1"
        actions={
          live && (
            <button onClick={() => void load()} className="text-2xs text-wt-fg hover:underline">
              [REFRESH]
            </button>
          )
        }
      >
        <div className="space-y-1.5 border-b border-wt-line px-2 py-1.5 text-2xs text-wt-fg-muted">
          <p>
            <span className="text-wt-fg">To add someone:</span> send them this site's address. They sign in with Google and appear here
            as <span className="text-wt-warn">waiting for approval</span>; choose what they may do. They see nothing until you do.
          </p>
          <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[170px_1fr]">
            {ROLES_SHOWN.map((r) => (
              <div key={r} className="contents">
                <dt>
                  <Tag tone={ROLE_TONE[r]}>{ROLE_LABEL[r]}</Tag>
                </dt>
                <dd>{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="text-wt-fg-dim">
            Emails and names here are visible only to you and to each person for their own account. The database rules enforce every role, not
            just this page.
          </p>
        </div>

        {!live ? (
          <p className="p-3 text-xs text-wt-fg-muted">Demo mode: there are no accounts. Sign-in and roles work on the live site.</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="px-2 py-1.5 text-2xs text-wt-crit">
                {error}
              </p>
            )}
            {members === null ? (
              <p className="p-3 text-xs text-wt-fg-muted">LOADING…</p>
            ) : (
              <>
                {waiting > 0 && (
                  <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-warn">
                    {waiting} {waiting === 1 ? 'person is' : 'people are'} waiting for approval.
                  </p>
                )}
                <ul className="divide-y divide-wt-line">
                  {rows.map(({ m, role }) => {
                    const self = m.uid === user?.uid;
                    return (
                      <li key={m.uid} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs">
                        <Tag tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Tag>
                        <span className="min-w-0 break-all">
                          {m.displayName ?? '(no name)'} <span className="text-wt-fg-muted">{m.email ?? '(no email)'}</span>
                          {self && <span className="text-wt-fg-dim"> (you)</span>}
                        </span>
                        <span className="text-2xs text-wt-fg-dim" title={`First sign-in ${formatUtc(m.createdAt)}`}>
                          seen {formatAge(m.lastSeenAt, now)} ago
                        </span>
                        {!m.ownerAccount && (
                          <span className="ml-auto flex flex-wrap gap-2 text-2xs">
                            {ASSIGNABLE_ROLES.filter((r) => r !== m.role).map((r: MemberRole) => (
                              <button
                                key={r}
                                disabled={busy === m.uid}
                                onClick={() => void act(m.uid, () => svc!.setMemberRole(m.uid, r))}
                                className={`hover:underline disabled:opacity-40 ${r === 'blocked' ? 'text-wt-fg-muted hover:text-wt-crit' : 'text-wt-fg'}`}
                              >
                                [{r === 'blocked' ? 'REMOVE ACCESS' : `MAKE ${r.toUpperCase()}`}]
                              </button>
                            ))}
                            {confirmRemove === m.uid ? (
                              <>
                                <button
                                  className="text-wt-crit hover:underline"
                                  onClick={() => void act(m.uid, () => svc!.deleteMember(m.uid)).then(() => setConfirmRemove(null))}
                                >
                                  [CONFIRM: FORGET]
                                </button>
                                <button className="text-wt-fg-muted" onClick={() => setConfirmRemove(null)}>
                                  [KEEP]
                                </button>
                              </>
                            ) : (
                              <button
                                className="text-wt-fg-dim hover:text-wt-crit"
                                title="Deletes this entry. If they sign in again they reappear as waiting for approval. To keep someone out, remove access instead."
                                onClick={() => setConfirmRemove(m.uid)}
                              >
                                [FORGET]
                              </button>
                            )}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {rows.length === 0 && <p className="p-3 text-xs text-wt-fg-muted">Nobody has signed in yet.</p>}
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
