import { describe, expect, it } from 'vitest';
import { permissionsForRole } from './permissions';
import { sessionFromUserRecord, type JWTPayload } from './jwt';

const TOKEN: JWTPayload = {
  sub: 'user-1',
  email: 'old@example.com',
  name: 'Old Name',
  role: 'admin',
  tv: 4,
  iat: 1,
  exp: 2,
};

describe('trusted application session', () => {
  it('uses current account fields and does not trust a stale admin role in the token', () => {
    const result = sessionFromUserRecord(TOKEN, {
      email: 'setter@example.com',
      name: 'Current Name',
      role: 'setter',
      market_id: 8,
      token_version: 4,
    });

    expect(result).toEqual({
      status: 'authenticated',
      admin: {
        ...TOKEN,
        email: 'setter@example.com',
        name: 'Current Name',
        role: 'setter',
        marketId: 8,
      },
    });
  });

  it('rejects a deleted or revoked account', () => {
    expect(sessionFromUserRecord(TOKEN, null)).toEqual({
      status: 'unauthenticated',
      reason: 'deleted',
    });
    expect(
      sessionFromUserRecord(TOKEN, { role: 'admin', token_version: 5 })
    ).toEqual({ status: 'unauthenticated', reason: 'revoked' });
  });

  it('does not turn malformed account data into an admin session', () => {
    expect(
      sessionFromUserRecord(TOKEN, { role: 'owner', token_version: 4 })
    ).toEqual({ status: 'unavailable' });
  });

  it('derives broad UI capabilities from one least-privilege policy', () => {
    const setter = permissionsForRole('setter');
    expect(setter.canAddLeads).toBe(true);
    expect(setter.canExecuteTerritories).toBe(true);
    expect(setter.canManageUsers).toBe(false);
    expect(setter.canViewAnalytics).toBe(false);

    const closer = permissionsForRole('closer');
    expect(closer.canAddLeads).toBe(true);
    expect(closer.canExecuteTerritories).toBe(false);

    const admin = permissionsForRole('admin');
    expect(admin.canManageUsers).toBe(true);
    expect(admin.canManageMarkets).toBe(true);
    expect(admin.canViewTeamData).toBe(true);
  });
});
