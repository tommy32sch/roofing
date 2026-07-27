import type { JWTPayload } from './jwt';

/**
 * Who is allowed to end an impersonation and take the admin session back.
 *
 * The saved admin token lives in a cookie (`admin_original_token`) so that
 * "Return to Admin" has something to return to. Treating possession of that
 * cookie as authorization is the trap: cookies outlive the session that set
 * them, so whoever uses the browser next — including a real employee signing in
 * with their own password — inherits a working admin token and a button that
 * spends it.
 *
 * So the decision is made from the LIVE session, not from the cookie: the
 * request must already be an impersonation, and the saved token must belong to
 * the admin who started that impersonation and still be an admin today.
 */

export type RestoreRefusal =
  | 'not_authenticated'
  | 'not_impersonating'
  | 'no_saved_session'
  | 'token_invalid'
  | 'token_mismatch'
  | 'no_longer_admin'
  | 'session_revoked';

export type RestoreDecision =
  | { allowed: true; adminId: string }
  | { allowed: false; reason: RestoreRefusal };

/** The stored admin_users row for the account being restored to. */
export interface RestoreTargetUser {
  role: 'admin' | 'setter' | 'closer';
  token_version?: number | null;
}

export function canRestoreImpersonation(input: {
  /** The session making the request, already signature- and revocation-checked. */
  current: JWTPayload | null;
  /** Claims of the saved token, or null if it was missing or failed verification. */
  original: JWTPayload | null;
  /** Whether a saved token cookie was present at all. */
  hasSavedToken: boolean;
  /** The saved token's user as they exist NOW, or null if deleted. */
  originalUser: RestoreTargetUser | null;
}): RestoreDecision {
  const { current, original, hasSavedToken, originalUser } = input;

  if (!current) return { allowed: false, reason: 'not_authenticated' };

  // The live session has to carry the impersonation claim. This is the check
  // that makes a stray cookie worthless: a normal login has no claim, so a
  // legitimate user can never restore into someone else's account.
  if (!current.impersonatedBy) return { allowed: false, reason: 'not_impersonating' };

  if (!hasSavedToken) return { allowed: false, reason: 'no_saved_session' };
  if (!original) return { allowed: false, reason: 'token_invalid' };

  // The saved token must be the one belonging to the admin who started THIS
  // impersonation — not merely some valid admin token that happens to be here.
  if (original.sub !== current.impersonatedBy) return { allowed: false, reason: 'token_mismatch' };

  if (!originalUser) return { allowed: false, reason: 'no_longer_admin' };
  if (originalUser.role !== 'admin') return { allowed: false, reason: 'no_longer_admin' };

  // The saved token predates the swap, so it has to clear revocation the same
  // way any live request would — a demotion or "log out everywhere" in the
  // meantime must not be undone by restoring.
  if ((originalUser.token_version ?? 0) !== (original.tv ?? 0)) {
    return { allowed: false, reason: 'session_revoked' };
  }

  return { allowed: true, adminId: original.sub };
}

/** HTTP status for a refusal. */
export function restoreRefusalStatus(reason: RestoreRefusal): number {
  return reason === 'not_authenticated' ? 401 : 403;
}
