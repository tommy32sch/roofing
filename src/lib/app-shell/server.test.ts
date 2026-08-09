import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveAdminSession: vi.fn(),
  db: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  resolveAdminSession: mocks.resolveAdminSession,
}));

vi.mock('@/lib/supabase/server', () => ({
  db: mocks.db,
}));

import { loadAppShell } from './server';

const ADMIN = {
  sub: 'user-1',
  email: 'rep@example.com',
  name: 'Rep One',
  role: 'setter' as const,
  marketId: 2,
  tv: 1,
  iat: 1,
  exp: 2,
};

function databaseResults({
  settings = { data: { company_name: 'Peak Roofing' }, error: null },
  markets = { data: [{ id: 2, name: 'Minnesota' }], error: null },
}: {
  settings?: { data: { company_name: string } | null; error: unknown };
  markets?: { data: { id: number; name: string }[] | null; error: unknown };
} = {}) {
  return {
    from(table: string) {
      if (table === 'app_settings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve(settings) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ order: () => Promise.resolve(markets) }),
          }),
        }),
      };
    },
  };
}

describe('server application shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query workspace data for an invalid session', async () => {
    mocks.resolveAdminSession.mockResolvedValue({
      status: 'unauthenticated',
      reason: 'invalid',
    });

    await expect(loadAppShell()).resolves.toEqual({ status: 'unauthenticated' });
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it('returns one trusted bootstrap with live identity and permissions', async () => {
    mocks.resolveAdminSession.mockResolvedValue({ status: 'authenticated', admin: ADMIN });
    mocks.db.mockReturnValue(databaseResults());

    const result = await loadAppShell();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready shell');
    expect(result.data.user).toMatchObject({
      id: 'user-1',
      role: 'setter',
      homeMarketId: 2,
    });
    expect(result.data.company.name).toBe('Peak Roofing');
    expect(result.data.markets).toEqual([{ id: 2, name: 'Minnesota' }]);
    expect(result.data.permissions.canManageUsers).toBe(false);
    expect(result.data.permissions.canExecuteTerritories).toBe(true);
    expect(result.data.issues).toEqual([]);
  });

  it('labels a market failure instead of presenting it as a real empty setup', async () => {
    mocks.resolveAdminSession.mockResolvedValue({ status: 'authenticated', admin: ADMIN });
    mocks.db.mockReturnValue(
      databaseResults({
        markets: { data: null, error: { message: 'offline' } },
      })
    );

    const result = await loadAppShell();

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a degraded shell');
    expect(result.data.markets).toEqual([]);
    expect(result.data.issues).toEqual([
      {
        code: 'markets_unavailable',
        message: 'Office filters are temporarily unavailable.',
      },
    ]);
  });

  it('keeps a database outage distinct from an invalid login', async () => {
    mocks.resolveAdminSession.mockResolvedValue({ status: 'authenticated', admin: ADMIN });
    mocks.db.mockImplementation(() => {
      throw new Error('database offline');
    });

    await expect(loadAppShell()).resolves.toEqual({ status: 'unavailable' });
  });
});
