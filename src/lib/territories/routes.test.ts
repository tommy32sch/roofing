import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, dbMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  dbMock: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  getAuthenticatedAdmin: authMock,
}));

vi.mock('@/lib/supabase/server', () => ({
  db: dbMock,
}));

import { GET, POST } from '@/app/api/admin/territories/route';
import { PATCH } from '@/app/api/admin/territories/[territoryId]/route';

type FakeRow = Record<string, unknown>;
type FakeTables = Record<string, FakeRow[]>;

function fakeSupabase(seed: FakeTables) {
  const tables = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  ) as FakeTables;

  function from(table: string) {
    const filters: ((row: FakeRow) => boolean)[] = [];
    let action: 'select' | 'insert' | 'update' = 'select';
    let values: FakeRow = {};

    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.order = chain;
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.neq = (column: string, value: unknown) => {
      filters.push((row) => row[column] !== value);
      return builder;
    };
    builder.is = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.lt = (column: string, value: number) => {
      filters.push((row) => Number(row[column]) < value);
      return builder;
    };
    builder.gt = (column: string, value: number) => {
      filters.push((row) => Number(row[column]) > value);
      return builder;
    };
    builder.in = (column: string, valuesToMatch: unknown[]) => {
      filters.push((row) => valuesToMatch.includes(row[column]));
      return builder;
    };
    builder.insert = (nextValues: FakeRow) => {
      action = 'insert';
      values = nextValues;
      return builder;
    };
    builder.update = (nextValues: FakeRow) => {
      action = 'update';
      values = nextValues;
      return builder;
    };

    const execute = async () => {
      const rows = tables[table] ?? (tables[table] = []);
      const matching = rows.filter((row) => filters.every((filter) => filter(row)));
      if (action === 'insert') {
        const now = '2026-07-27T12:00:00.000Z';
        const inserted = {
          id: '00000000-0000-4000-8000-000000000099',
          archived_at: null,
          created_at: now,
          updated_at: now,
          ...values,
        };
        rows.push(inserted);
        return { data: [inserted], error: null };
      }
      if (action === 'update') {
        for (const row of matching) Object.assign(row, values);
      }
      return { data: matching, error: null };
    };

    builder.maybeSingle = async () => {
      const result = await execute();
      return { data: result.data[0] ?? null, error: null };
    };
    builder.single = async () => {
      const result = await execute();
      return { data: result.data[0] ?? null, error: result.data[0] ? null : { message: 'Not found' } };
    };
    builder.then = (
      resolve: (value: { data: FakeRow[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => execute().then(resolve, reject);

    return builder;
  }

  return { client: { from }, tables };
}

const ADMIN = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin' as const,
  iat: 0,
  exp: 0,
};

const ACTIVE_TERRITORY = {
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Existing route',
  market_id: 1,
  boundary: [[0, 0], [2, 0], [2, 2], [0, 2]],
  min_lat: 0,
  max_lat: 2,
  min_lng: 0,
  max_lng: 2,
  color: '#2563eb',
  owner_user_id: null,
  archived_at: null,
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z',
};

beforeEach(() => {
  authMock.mockReset();
  dbMock.mockReset();
});

describe('territory route access and early validation', () => {
  it('requires authentication to list territories', async () => {
    authMock.mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/api/admin/territories'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('allows only admins to create territories', async () => {
    authMock.mockResolvedValue({ ...ADMIN, role: 'setter' });
    const response = await POST(
      new NextRequest('http://localhost/api/admin/territories', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('does not expose archived territory history to non-admin roles', async () => {
    authMock.mockResolvedValue({ ...ADMIN, role: 'setter' });
    const response = await GET(
      new NextRequest('http://localhost/api/admin/territories?include_archived=true')
    );
    expect(response.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects invalid geometry before touching the database', async () => {
    authMock.mockResolvedValue(ADMIN);
    const response = await POST(
      new NextRequest('http://localhost/api/admin/territories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'North route',
          market_id: 1,
          boundary: [[0, 0], [1, 1]],
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects colors outside the shared palette before touching the database', async () => {
    authMock.mockResolvedValue(ADMIN);
    const response = await POST(
      new NextRequest('http://localhost/api/admin/territories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'North route',
          market_id: 1,
          boundary: [[0, 0], [1, 0], [1, 1]],
          color: '#ff0000',
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid territory color' });
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('rejects an owner whose home market differs from the territory market', async () => {
    const ownerId = '00000000-0000-4000-8000-000000000020';
    const fake = fakeSupabase({
      markets: [{ id: 1, is_active: true }],
      admin_users: [{ id: ownerId, name: 'Other office', role: 'setter', market_id: 2 }],
      territories: [],
    });
    authMock.mockResolvedValue(ADMIN);
    dbMock.mockReturnValue(fake.client);

    const response = await POST(
      new NextRequest('http://localhost/api/admin/territories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'North route',
          market_id: 1,
          boundary: [[0, 0], [1, 0], [1, 1]],
          owner_user_id: ownerId,
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Territory owner belongs to a different market',
    });
    expect(fake.tables.territories).toHaveLength(0);
  });

  it('excludes archived rows from the default GET response', async () => {
    const fake = fakeSupabase({
      admin_users: [{ id: ADMIN.sub, market_id: null }],
      territories: [
        ACTIVE_TERRITORY,
        {
          ...ACTIVE_TERRITORY,
          id: '00000000-0000-4000-8000-000000000011',
          name: 'Archived route',
          archived_at: '2026-07-27T00:00:00.000Z',
        },
      ],
    });
    authMock.mockResolvedValue(ADMIN);
    dbMock.mockReturnValue(fake.client);

    const response = await GET(
      new NextRequest('http://localhost/api/admin/territories?market_id=all')
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.territories.map((territory: { name: string }) => territory.name)).toEqual([
      'Existing route',
    ]);
  });

  it('returns 409 for overlap and inserts only after explicit override', async () => {
    const fake = fakeSupabase({
      markets: [{ id: 1, is_active: true }],
      admin_users: [],
      territories: [ACTIVE_TERRITORY],
    });
    authMock.mockResolvedValue(ADMIN);
    dbMock.mockReturnValue(fake.client);
    const body = {
      name: 'Overlapping route',
      market_id: 1,
      boundary: [[1, 1], [3, 1], [3, 3], [1, 3]],
    };

    const blocked = await POST(
      new NextRequest('http://localhost/api/admin/territories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      conflicts: [{ id: ACTIVE_TERRITORY.id, name: ACTIVE_TERRITORY.name }],
    });
    expect(fake.tables.territories).toHaveLength(1);

    const allowed = await POST(
      new NextRequest('http://localhost/api/admin/territories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, allow_overlap: true }),
      })
    );
    expect(allowed.status).toBe(201);
    expect(await allowed.json()).toMatchObject({
      success: true,
      territory: { name: 'Overlapping route', market_id: 1 },
    });
    expect(fake.tables.territories).toHaveLength(2);
  });

  it('allows only admins to patch territories', async () => {
    authMock.mockResolvedValue({ ...ADMIN, role: 'closer' });
    const response = await PATCH(
      new NextRequest('http://localhost/api/admin/territories/00000000-0000-4000-8000-000000000002', {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      }),
      { params: Promise.resolve({ territoryId: '00000000-0000-4000-8000-000000000002' }) }
    );
    expect(response.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('blocks restoring an archived territory that now overlaps an active one', async () => {
    const archivedId = '00000000-0000-4000-8000-000000000012';
    const fake = fakeSupabase({
      admin_users: [],
      territories: [
        ACTIVE_TERRITORY,
        {
          ...ACTIVE_TERRITORY,
          id: archivedId,
          name: 'Old route',
          boundary: [[1, 1], [3, 1], [3, 3], [1, 3]],
          min_lat: 1,
          max_lat: 3,
          min_lng: 1,
          max_lng: 3,
          archived_at: '2026-07-27T00:00:00.000Z',
        },
      ],
    });
    authMock.mockResolvedValue(ADMIN);
    dbMock.mockReturnValue(fake.client);

    const response = await PATCH(
      new NextRequest(`http://localhost/api/admin/territories/${archivedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      }),
      { params: Promise.resolve({ territoryId: archivedId }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      conflicts: [{ id: ACTIVE_TERRITORY.id }],
    });
    expect(fake.tables.territories.find((row) => row.id === archivedId)?.archived_at).not.toBeNull();
  });
});
