import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadTerritoryExecutionSnapshot, loadTerritoryProgressPage } from './execution.server';

type Row = Record<string, unknown>;

function fakeSupabase(seed: Record<string, Row[]>): SupabaseClient {
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let range: [number, number] | null = null;
    let wantsCount = false;
    const builder: Record<string, unknown> = {};

    builder.select = (_fields: string, options?: { count?: string }) => {
      wantsCount = options?.count === 'exact';
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.is = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.not = (column: string, operator: string, value: unknown) => {
      if (operator === 'is' && value === null) filters.push((row) => row[column] != null);
      return builder;
    };
    builder.gte = (column: string, value: number) => {
      filters.push((row) => Number(row[column]) >= value);
      return builder;
    };
    builder.lte = (column: string, value: number) => {
      filters.push((row) => Number(row[column]) <= value);
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return builder;
    };
    builder.order = () => builder;
    builder.range = (from: number, to: number) => {
      range = [from, to];
      return builder;
    };

    const execute = async () => {
      const matching = (seed[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      const selected = range ? matching.slice(range[0], range[1] + 1) : matching;
      return { data: selected, error: null, count: wantsCount ? matching.length : null };
    };
    builder.maybeSingle = async () => {
      const result = await execute();
      return { data: result.data[0] ?? null, error: null };
    };
    builder.then = (
      resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown,
      reject?: (reason: unknown) => unknown
    ) => execute().then(resolve, reject);
    return builder;
  }

  return { from } as unknown as SupabaseClient;
}

const TERRITORY = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Triangle',
  market_id: 1,
  boundary: [[0, 0], [2, 0], [0, 2]],
  min_lat: 0,
  max_lat: 2,
  min_lng: 0,
  max_lng: 2,
  color: '#2563eb',
  owner_user_id: '00000000-0000-4000-8000-000000000002',
  archived_at: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

function lead(overrides: Row = {}): Row {
  return {
    id: 'lead-inside',
    market_id: 1,
    first_name: 'Inside',
    last_name: 'Lead',
    latitude: 0.5,
    longitude: 0.5,
    status: 'new',
    priority: 'medium',
    estimated_roof_value: null,
    address_street: '1 Main St',
    address_city: 'Phoenix',
    is_dnc: false,
    hail_date: null,
    hail_size_inches: null,
    last_knock_at: null,
    last_disposition: null,
    knock_count: 0,
    do_not_knock: false,
    last_call_at: null,
    last_call_disposition: null,
    call_count: 0,
    follow_up_date: null,
    is_flagged_duplicate: false,
    lead_appointments: [],
    ...overrides,
  };
}

describe('territory execution server loading', () => {
  it('applies market, duplicate, coordinate, and exact polygon membership on the server', async () => {
    const supabase = fakeSupabase({
      territories: [TERRITORY],
      admin_users: [{
        id: TERRITORY.owner_user_id,
        name: 'Taylor',
        role: 'setter',
        market_id: 1,
      }],
      leads: [
        lead({ lead_appointments: [{ outcome: 'scheduled' }] }),
        lead({ id: 'bbox-only', latitude: 1.5, longitude: 1.5 }),
        lead({ id: 'duplicate', is_flagged_duplicate: true }),
        lead({ id: 'other-market', market_id: 2 }),
        lead({ id: 'missing-coords', latitude: null }),
      ],
    });

    const result = await loadTerritoryExecutionSnapshot(
      supabase,
      TERRITORY.id,
      'setter',
      { today: '2026-08-02', now: '2026-08-02T12:00:00Z' }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.leads.map((row) => row.id)).toEqual(['lead-inside']);
    expect(result.snapshot.leads[0]).toMatchObject({
      first_name: 'Inside',
      address_street: '1 Main St',
      progress_state: 'appointment',
    });
    expect(result.snapshot.territory.owner_name).toBe('Taylor');
    expect(result.snapshot.summary).toMatchObject({
      total_leads: 1,
      coverage_percent: 100,
      state: 'complete',
    });
  });

  it('loads progress independently of map filters and paginates territory summaries', async () => {
    const supabase = fakeSupabase({
      territories: [TERRITORY],
      admin_users: [],
      leads: [lead()],
    });
    const result = await loadTerritoryProgressPage(supabase, {
      role: 'admin',
      marketId: 1,
      page: 1,
      limit: 25,
      clock: { today: '2026-08-02', now: '2026-08-02T12:00:00Z' },
    });
    expect(result).toMatchObject({
      ok: true,
      progress: {
        total: 1,
        page: 1,
        limit: 25,
        total_pages: 1,
        summaries: [{ total_leads: 1, progress: { unworked: 1 } }],
      },
    });
  });
});
