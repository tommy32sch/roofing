import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, dbMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  dbMock: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({ getAuthenticatedAdmin: authMock }));
vi.mock('@/lib/supabase/server', () => ({ db: dbMock }));

import { GET } from './route';

type Row = Record<string, unknown> & { id: string };

function fakeDatabase(rows: Row[], cap = 1000, errorPage?: number) {
  let page = 0;
  return {
    from: vi.fn(() => {
      const filters: Array<(row: Row) => boolean> = [];
      let limit = Infinity;
      let orderColumn = '';
      let ascending = true;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      };
      builder.gt = (column: string, value: string) => {
        filters.push((row) => String(row[column]) > value);
        return builder;
      };
      builder.order = (column: string, options: { ascending: boolean }) => {
        orderColumn = column;
        ascending = options.ascending;
        return builder;
      };
      builder.limit = (size: number) => {
        limit = size;
        return builder;
      };
      const execute = async () => {
        page++;
        if (page === errorPage) {
          return { data: null, error: { message: 'Database unavailable' } };
        }
        const matching = rows.filter((row) => filters.every((filter) => filter(row)));
        if (orderColumn) {
          matching.sort((left, right) => {
            const a = String(left[orderColumn]);
            const b = String(right[orderColumn]);
            return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        return { data: matching.slice(0, Math.min(limit, cap)), error: null };
      };
      builder.then = (
        resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown,
        reject?: (reason: unknown) => unknown
      ) => execute().then(resolve, reject);
      return builder;
    }),
  };
}

function lead(index: number, overrides: Record<string, unknown> = {}): Row {
  return {
    id: String(index).padStart(8, '0'),
    market_id: 1,
    status: 'new',
    priority: 'high',
    assigned_setter_id: 'setter-1',
    assigned_closer_id: 'closer-1',
    is_flagged_duplicate: false,
    latitude: 33.4,
    longitude: -112.1,
    ...overrides,
  };
}

function request(params = '') {
  return new NextRequest(`https://example.com/api/admin/leads/geo${params}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ sub: 'admin-1', role: 'admin', marketId: 1 });
});

describe('map lead data', () => {
  it('returns all leads beyond the database row cap and the old 10,000 limit', async () => {
    const rows = Array.from({ length: 10005 }, (_, index) => lead(index));
    rows.push(lead(10005, { latitude: null, longitude: null }));
    rows.push(lead(10006, { longitude: null }));
    rows.push(lead(10007, { is_flagged_duplicate: true }));
    dbMock.mockReturnValue(fakeDatabase(rows.reverse()));

    const response = await GET(request('?market_id=all'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.leads).toHaveLength(10005);
    expect(new Set(body.leads.map((row: Row) => row.id)).size).toBe(10005);
    expect(body.missing_coords).toBe(2);
    expect(body.leads[0].id).toBe('00000000');
    expect(body.leads.at(-1).id).toBe('00010004');
  });

  it('continues after short pages and applies market, assignment, status, and priority to every page', async () => {
    authMock.mockResolvedValue({ sub: 'setter-1', role: 'setter', marketId: 1 });
    const rows = Array.from({ length: 125 }, (_, index) => lead(index));
    rows.push(lead(200, { market_id: 2 }));
    rows.push(lead(201, { assigned_setter_id: 'setter-2' }));
    rows.push(lead(202, { status: 'lost' }));
    rows.push(lead(203, { priority: 'low' }));
    rows.push(lead(204, { is_flagged_duplicate: true }));
    rows.push(lead(205, { latitude: null, longitude: null }));
    dbMock.mockReturnValue(fakeDatabase(rows, 50));

    const response = await GET(request('?status=new&priority=high'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.leads).toHaveLength(125);
    expect(body.leads.map((row: Row) => row.id)).toEqual(rows.slice(0, 125).map((row) => row.id));
    expect(body.missing_coords).toBe(1);
  });

  it('returns an error rather than a partial map when a later page fails', async () => {
    dbMock.mockReturnValue(fakeDatabase([lead(0), lead(1)], 1, 2));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Database unavailable' });
  });

  it('requires a signed-in account before reading leads', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(dbMock).not.toHaveBeenCalled();
  });
});
