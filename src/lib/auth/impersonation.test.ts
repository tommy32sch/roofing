import { describe, it, expect } from 'vitest';
import { canRestoreImpersonation, restoreRefusalStatus } from './impersonation';
import type { JWTPayload } from './jwt';

const ADMIN_ID = 'admin-1';
const SETTER_ID = 'setter-1';

const session = (over: Partial<JWTPayload> = {}): JWTPayload => ({
  sub: SETTER_ID,
  email: 'setter@example.com',
  name: 'A Setter',
  role: 'setter',
  tv: 0,
  iat: 1,
  exp: 2,
  ...over,
});

const adminToken = (over: Partial<JWTPayload> = {}): JWTPayload => ({
  sub: ADMIN_ID,
  email: 'admin@example.com',
  name: 'An Admin',
  role: 'admin',
  tv: 0,
  iat: 1,
  exp: 2,
  ...over,
});

/** The happy path: an admin really is impersonating and wants back out. */
const validRestore = {
  current: session({ impersonatedBy: ADMIN_ID }),
  original: adminToken(),
  hasSavedToken: true,
  originalUser: { role: 'admin' as const, token_version: 0 },
};

describe('canRestoreImpersonation', () => {
  it('lets a genuine impersonation return to the admin who started it', () => {
    expect(canRestoreImpersonation(validRestore)).toEqual({ allowed: true, adminId: ADMIN_ID });
  });

  it('refuses an unauthenticated request', () => {
    expect(canRestoreImpersonation({ ...validRestore, current: null }))
      .toEqual({ allowed: false, reason: 'not_authenticated' });
  });

  /**
   * The reported bug, as a test.
   *
   * An admin impersonates, then logs out; the saved token cookie survives. A
   * real employee signs in with their own password on that browser. Their
   * session has no impersonation claim, so possession of the cookie must buy
   * them nothing — otherwise one request turns a setter into the admin.
   */
  it('refuses a legitimate login that merely inherited the saved cookie', () => {
    expect(canRestoreImpersonation({
      ...validRestore,
      current: session(), // signed in normally — no impersonatedBy
    })).toEqual({ allowed: false, reason: 'not_impersonating' });
  });

  it('refuses when the impersonating session has no saved token', () => {
    expect(canRestoreImpersonation({ ...validRestore, hasSavedToken: false, original: null }))
      .toEqual({ allowed: false, reason: 'no_saved_session' });
  });

  it('refuses a saved token that fails signature or expiry verification', () => {
    expect(canRestoreImpersonation({ ...validRestore, original: null }))
      .toEqual({ allowed: false, reason: 'token_invalid' });
  });

  // A valid admin token is not automatically THE admin token for this session.
  it('refuses a saved token belonging to a different admin', () => {
    expect(canRestoreImpersonation({
      ...validRestore,
      original: adminToken({ sub: 'some-other-admin' }),
    })).toEqual({ allowed: false, reason: 'token_mismatch' });
  });

  it('refuses when the original account has been deleted', () => {
    expect(canRestoreImpersonation({ ...validRestore, originalUser: null }))
      .toEqual({ allowed: false, reason: 'no_longer_admin' });
  });

  // Restoring must not undo a demotion that happened during the impersonation.
  it('refuses when the original account is no longer an admin', () => {
    expect(canRestoreImpersonation({
      ...validRestore,
      originalUser: { role: 'closer', token_version: 0 },
    })).toEqual({ allowed: false, reason: 'no_longer_admin' });
  });

  // "Log out everywhere" bumps token_version; a saved token predating that bump
  // is exactly the kind of stale credential revocation exists to kill.
  it('refuses a saved token whose session has been revoked', () => {
    expect(canRestoreImpersonation({
      ...validRestore,
      originalUser: { role: 'admin', token_version: 3 },
    })).toEqual({ allowed: false, reason: 'session_revoked' });
  });

  it('treats a missing token_version as 0 on both sides', () => {
    expect(canRestoreImpersonation({
      ...validRestore,
      original: adminToken({ tv: undefined }),
      originalUser: { role: 'admin', token_version: null },
    })).toEqual({ allowed: true, adminId: ADMIN_ID });
  });

  it('never allows a self-referential restore into the impersonated account', () => {
    // A forged claim pointing at the setter themselves must not let them keep
    // a session that claims to be an admin.
    const result = canRestoreImpersonation({
      current: session({ impersonatedBy: SETTER_ID }),
      original: adminToken({ sub: SETTER_ID, role: 'setter' }),
      hasSavedToken: true,
      originalUser: { role: 'setter', token_version: 0 },
    });
    expect(result).toEqual({ allowed: false, reason: 'no_longer_admin' });
  });
});

describe('restoreRefusalStatus', () => {
  it('separates "who are you" from "you may not"', () => {
    expect(restoreRefusalStatus('not_authenticated')).toBe(401);
    expect(restoreRefusalStatus('not_impersonating')).toBe(403);
    expect(restoreRefusalStatus('token_mismatch')).toBe(403);
    expect(restoreRefusalStatus('session_revoked')).toBe(403);
  });
});
