/**
 * People who can use WATCHTOWER (v0.60.0).
 *
 * The owner is the account carrying the `owner` custom claim (granted out-of-band with
 * `npm run grant-owner` or the "Grant owner" workflow). Everyone else who signs in with Google gets a
 * `members/{uid}` document, written by themselves on first sign-in with role `pending`. Only the owner
 * can change a role (Users page); Firestore security rules enforce both halves and every permission
 * below, so the app's own checks are a convenience, not the protection.
 *
 * Roles:
 *  - viewer   sees everything; keeps their own watchlist (which highlights but never alerts)
 *  - editor   viewer + edits incident dossiers, acknowledges and dismisses alerts; their watchlist alerts
 *  - owner    editor + manages alert rules and people
 *  - pending  signed in, waiting for the owner; no access
 *  - blocked  access removed by the owner; no access (kept so they do not reappear as a request)
 */
export type MemberRole = 'pending' | 'viewer' | 'editor' | 'blocked';
export type Role = MemberRole | 'owner';

/** Roles the owner can assign on the Users page. */
export const ASSIGNABLE_ROLES: readonly MemberRole[] = ['viewer', 'editor', 'blocked'];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
  pending: 'Waiting for approval',
  blocked: 'Access removed',
};

export const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including alert rules and people.',
  editor: 'Sees everything, edits incident dossiers, acknowledges and dismisses alerts. Watchlist items can alert.',
  viewer: 'Sees everything and keeps a personal watchlist (highlights only, no alerts). Cannot change shared data.',
  pending: 'Signed in, but cannot see anything until the owner approves.',
  blocked: 'Cannot see anything.',
};

export type Permission = 'view' | 'editIncidents' | 'triageAlerts' | 'manageRules' | 'manageUsers' | 'watchlistAlerts';

const GRANTS: Record<Role, readonly Permission[]> = {
  owner: ['view', 'editIncidents', 'triageAlerts', 'manageRules', 'manageUsers', 'watchlistAlerts'],
  editor: ['view', 'editIncidents', 'triageAlerts', 'watchlistAlerts'],
  viewer: ['view'],
  pending: [],
  blocked: [],
};

export const can = (role: Role | null | undefined, p: Permission): boolean => !!role && GRANTS[role].includes(p);

/** Stored at `members/{uid}`. Email and name are visible only to that person and the owner. */
export interface Member {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: MemberRole;
  /** True only when written by the owner account itself (the rules check it against the token). */
  ownerAccount: boolean;
  createdAt: string;
  lastSeenAt: string;
  /** When the owner last changed the role. */
  roleSetAt?: string;
}

/** Effective role: the owner claim wins; otherwise the member document's role; no document = pending. */
export function effectiveRole(ownerClaim: boolean, member: Pick<Member, 'role'> | null | undefined): Role {
  if (ownerClaim) return 'owner';
  const r = member?.role;
  return r === 'viewer' || r === 'editor' || r === 'blocked' ? r : 'pending';
}

/**
 * Watchlists that may raise alerts (and post to Discord): the owner's and editors'. A viewer's watchlist
 * only highlights in their own view, so a viewer can never push notifications to everyone.
 *
 * Until the owner has signed in once since v0.60.0 (no member document has ownerAccount), a watchlist
 * whose uid has no member document is taken to be the owner's: before v0.60.0 only the owner could
 * keep one, and since then nobody without a member document can write one.
 */
export function watchlistsThatAlert<T extends { uid: string }>(watchlists: T[], members: unknown[]): T[] {
  const byUid = new Map<string, Partial<Member>>();
  for (const m of members as Partial<Member>[]) if (typeof m?.uid === 'string') byUid.set(m.uid, m);
  const ownerKnown = [...byUid.values()].some((m) => m.ownerAccount === true);
  return watchlists.filter((w) => {
    const m = byUid.get(w.uid);
    if (!m) return !ownerKnown;
    return m.ownerAccount === true || m.role === 'editor';
  });
}
