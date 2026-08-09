import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  dbMock,
  marketFilterMock,
  progressMock,
  snapshotMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  dbMock: vi.fn(() => ({ client: true })),
  marketFilterMock: vi.fn(),
  progressMock: vi.fn(),
  snapshotMock: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({ getAuthenticatedAdmin: authMock }));
vi.mock('@/lib/supabase/server', () => ({ db: dbMock }));
vi.mock('@/lib/leads/market-context', () => ({ marketFilterFor: marketFilterMock }));
vi.mock('@/lib/territories/execution.server', () => ({
  loadTerritoryProgressPage: progressMock,
  loadTerritoryExecutionSnapshot: snapshotMock,
}));

import { GET as getProgress } from '@/app/api/admin/territories/progress/route';
import { GET as getExecution } from '@/app/api/admin/territories/[territoryId]/execution/route';

const USER = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'setter@example.com',
  name: 'Setter',
  role: 'setter' as const,
  marketId: 2,
  iat: 0,
  exp: 0,
};
const TERRITORY_ID = '00000000-0000-4000-8000-000000000010';

beforeEach(() => {
  authMock.mockReset();
  dbMock.mockClear();
  marketFilterMock.mockReset();
  progressMock.mockReset();
  snapshotMock.mockReset();
});

describe('territory execution route boundaries', () => {
  it('requires authentication and denies closers before database work', async () => {
    authMock.mockResolvedValueOnce(null);
    const unauthenticated = await getProgress(
      new NextRequest('http://localhost/api/admin/territories/progress?date=2026-08-02')
    );
    expect(unauthenticated.status).toBe(401);

    authMock.mockResolvedValueOnce({ ...USER, role: 'closer' });
    const forbidden = await getProgress(
      new NextRequest('http://localhost/api/admin/territories/progress?date=2026-08-02')
    );
    expect(forbidden.status).toBe(403);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it('requires the caller local date and a valid territory id', async () => {
    authMock.mockResolvedValue(USER);
    const missingDate = await getProgress(
      new NextRequest('http://localhost/api/admin/territories/progress')
    );
    expect(missingDate.status).toBe(400);

    const invalidId = await getExecution(
      new NextRequest('http://localhost/api/admin/territories/nope/execution?date=2026-08-02'),
      { params: Promise.resolve({ territoryId: 'nope' }) }
    );
    expect(invalidId.status).toBe(400);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('loads unfiltered paginated summaries using the normal market default', async () => {
    authMock.mockResolvedValue(USER);
    marketFilterMock.mockResolvedValue(2);
    progressMock.mockResolvedValue({
      ok: true,
      progress: { summaries: [], total: 0, page: 2, limit: 100, total_pages: 0 },
    });

    const response = await getProgress(
      new NextRequest(
        'http://localhost/api/admin/territories/progress?date=2026-08-02&page=2&limit=500&market_id=2'
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, page: 2, limit: 100 });
    expect(marketFilterMock).toHaveBeenCalledWith(USER.marketId, '2');
    expect(progressMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'setter', marketId: 2, page: 2, limit: 100 })
    );
  });

  it('loads any active territory for a setter without treating owner as an ACL', async () => {
    authMock.mockResolvedValue(USER);
    snapshotMock.mockResolvedValue({
      ok: true,
      snapshot: {
        territory: { id: TERRITORY_ID },
        summary: { territory_id: TERRITORY_ID },
        leads: [{ id: 'lead-a', first_name: 'A', address_street: '1 Main St' }],
      },
    });

    const response = await getExecution(
      new NextRequest(
        `http://localhost/api/admin/territories/${TERRITORY_ID}/execution?date=2026-08-02`
      ),
      { params: Promise.resolve({ territoryId: TERRITORY_ID }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      snapshot: {
        territory: { id: TERRITORY_ID },
        leads: [{ first_name: 'A', address_street: '1 Main St' }],
      },
    });
    expect(snapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      TERRITORY_ID,
      'setter',
      expect.objectContaining({ today: '2026-08-02' })
    );
  });
});

describe('territory execution server contract', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/lib/territories/execution.server.ts'),
    'utf8'
  );

  it('derives exact membership from saved geometry and mandatory lead boundaries', () => {
    expect(source).toContain('pointInPolygon([lead.latitude, lead.longitude], territory.boundary)');
    expect(source).toContain(".eq('market_id', marketId)");
    expect(source).toContain(".eq('is_flagged_duplicate', false)");
    expect(source).toContain('canViewLead(role, row.status)');
    expect(source).toContain(".is('archived_at', null)");
  });

  it('paginates database lead reads instead of inheriting the map cap', () => {
    expect(source).toContain('.range(offset, offset + DATABASE_PAGE_SIZE - 1)');
    expect(source).toContain('if (rows.length < DATABASE_PAGE_SIZE) break');
  });

  it('does not accept or process caller location on either server route', () => {
    const progressRoute = readFileSync(
      join(process.cwd(), 'src/app/api/admin/territories/progress/route.ts'),
      'utf8'
    );
    const executionRoute = readFileSync(
      join(process.cwd(), 'src/app/api/admin/territories/[territoryId]/execution/route.ts'),
      'utf8'
    );
    expect(progressRoute).not.toMatch(/searchParams\.get\(['"](?:lat|lng|latitude|longitude)['"]\)/);
    expect(executionRoute).not.toMatch(/searchParams\.get\(['"](?:lat|lng|latitude|longitude)['"]\)/);
  });
});
