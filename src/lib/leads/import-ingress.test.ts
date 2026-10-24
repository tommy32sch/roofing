import { readFileSync } from 'fs';
import { join } from 'path';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUPLICATE_CONTEXT_MAX_ROWS, assignImportDuplicates } from './dedupe';

const { authMock, rateLimitMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({
  getAuthenticatedAdmin: authMock,
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkConfiguredRateLimit: rateLimitMock,
}));

import { POST as importLeads } from '@/app/api/admin/import/route';

const ADMIN = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'setter@example.com',
  name: 'Setter',
  role: 'setter' as const,
  iat: 0,
  exp: 0,
};

beforeEach(() => {
  authMock.mockReset();
  rateLimitMock.mockReset();
  authMock.mockResolvedValue(ADMIN);
  rateLimitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 600_000,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('admin import resource limits', () => {
  it('rejects an exhausted account before reading the multipart body', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
    rateLimitMock.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 90_000,
    });
    const formData = vi.fn();

    const response = await importLeads({ formData } as unknown as NextRequest);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('90');
    expect(await response.json()).toEqual({
      success: false,
      error: 'Import limit reached. Try again later.',
    });
    expect(rateLimitMock).toHaveBeenCalledWith(ADMIN.sub, 'lead-import', 5, '10 m');
    expect(formData).not.toHaveBeenCalled();
  });

  it('does not spend import capacity for unauthenticated requests', async () => {
    authMock.mockResolvedValue(null);

    const response = await importLeads({ formData: vi.fn() } as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});

/** A stand-in for supabase.rpc(...) returning the lookup as one JSON value. */
function jsonRpc(result: { data: unknown; error: unknown }) {
  return vi.fn().mockResolvedValue(result);
}

describe('indexed import duplicate lookup', () => {
  it('uses the database-normalized context and keeps existing rows first', async () => {
    const rpc = jsonRpc({
      data: [
        {
          record_order: 2,
          id: 'new:0',
          apn: null,
          address_street: '1039 North 35th Street',
          address_city: 'Phoenix',
          address_zip: '85008',
          address_dedupe_key: '1039 n 35th st',
        },
        {
          record_order: 1,
          id: '00000000-0000-4000-8000-000000000010',
          apn: null,
          address_street: '1039 N 35th St',
          address_city: 'Phoenix',
          address_zip: '85008',
          address_dedupe_key: '1039 n 35th st',
        },
      ],
      error: null,
    });

    const assigned = await assignImportDuplicates(
      { rpc } as unknown as SupabaseClient,
      [{
        id: 'new:0',
        address_street: '1039 North 35th Street',
        address_city: 'Phoenix',
        address_zip: '85008',
      }]
    );

    expect(rpc).toHaveBeenCalledWith('find_lead_duplicate_context_json', {
      p_leads: [{
        id: 'new:0',
        apn: null,
        address_street: '1039 North 35th Street',
        address_city: 'Phoenix',
        address_zip: '85008',
      }],
    });
    expect(assigned.get('new:0')).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('fails closed when the indexed lookup fails or omits an input row', async () => {
    const failedRpc = jsonRpc({ data: null, error: { message: 'db failed' } });
    const incompleteRpc = jsonRpc({ data: [], error: null });
    const notAnArray = jsonRpc({ data: { rows: [] }, error: null });
    const records = [{ id: 'new:0', address_street: '1 Main St' }];

    await expect(assignImportDuplicates(
      { rpc: failedRpc } as unknown as SupabaseClient,
      records
    )).rejects.toThrow('Failed to load duplicate candidates');
    await expect(assignImportDuplicates(
      { rpc: incompleteRpc } as unknown as SupabaseClient,
      records
    )).rejects.toThrow('Duplicate lookup returned incomplete context');
    await expect(assignImportDuplicates(
      { rpc: notAnArray } as unknown as SupabaseClient,
      records
    )).rejects.toThrow('Failed to load duplicate candidates');
  });

  // Regression: a 1,084-row file plus 614 existing candidates came back cut
  // to 1,000 rows and the whole import failed as "incomplete context". The
  // context now arrives as one JSON value from one call, whatever its size.
  it('checks a file whose context is larger than one API page, in one call', async () => {
    const existing = Array.from({ length: 614 }, (_, i) => ({
      record_order: i + 1,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      apn: null,
      address_street: `${i} Existing St`,
      address_city: 'Peoria',
      address_zip: '85345',
      address_dedupe_key: `${i} existing st`,
    }));
    const incoming = Array.from({ length: 1084 }, (_, i) => ({
      record_order: 614 + i + 1,
      id: `new:${i}`,
      apn: null,
      // The first incoming row repeats an existing house.
      address_street: i === 0 ? '0 Existing St' : `${i} Incoming Ave`,
      address_city: 'Peoria',
      address_zip: '85345',
      address_dedupe_key: i === 0 ? '0 existing st' : `${i} incoming ave`,
    }));
    const rpc = jsonRpc({ data: [...existing, ...incoming], error: null });
    const assigned = await assignImportDuplicates(
      { rpc } as unknown as SupabaseClient,
      incoming.map(({ id, address_street, address_city, address_zip }) => ({
        id, address_street, address_city, address_zip,
      }))
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(incoming.every((row) => assigned.has(row.id))).toBe(true);
    expect(assigned.get('new:0')).toBe(existing[0].id);
    expect(assigned.get('new:1')).toBeNull();
  });

  it('refuses a context too large to check safely', async () => {
    const rows = Array.from({ length: DUPLICATE_CONTEXT_MAX_ROWS + 1 }, (_, i) => ({
      record_order: i + 1, id: `x:${i}`,
    }));
    await expect(assignImportDuplicates(
      { rpc: jsonRpc({ data: rows, error: null }) } as unknown as SupabaseClient,
      [{ id: 'x:0', address_street: '1 Main St' }]
    )).rejects.toThrow('Too many matching leads to check this file safely');
  });

  // Paging re-ran the lookup per page; a mid-read import could shift rows.
  it('reads the lookup through the single-snapshot JSON function only', () => {
    const dedupe = readFileSync(join(process.cwd(), 'src/lib/leads/dedupe.ts'), 'utf8');
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/036_duplicate_context_json.sql'),
      'utf8'
    );
    expect(dedupe).toContain("rpc('find_lead_duplicate_context_json'");
    expect(dedupe).not.toContain("rpc('find_lead_duplicate_context',");
    expect(dedupe).not.toMatch(/\.range\(/);
    expect(migration).toContain('FROM public.find_lead_duplicate_context(p_leads) AS context');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.find_lead_duplicate_context_json\(JSONB\) FROM anon/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.find_lead_duplicate_context_json\(JSONB\) TO service_role/);
  });

  it('keeps the generated key and lookup private in the canonical schema', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/029_indexed_lead_dedupe.sql'),
      'utf8'
    );
    const adminRoute = readFileSync(
      join(process.cwd(), 'src/app/api/admin/import/route.ts'),
      'utf8'
    );
    const emailRoute = readFileSync(
      join(process.cwd(), 'src/app/api/webhooks/email/route.ts'),
      'utf8'
    );
    const inboundRoute = readFileSync(
      join(process.cwd(), 'src/app/api/webhooks/inbound/route.ts'),
      'utf8'
    );
    const recheckRoute = readFileSync(
      join(process.cwd(), 'src/app/api/admin/leads/recheck-duplicates/route.ts'),
      'utf8'
    );

    expect(migration).toContain('GENERATED ALWAYS AS');
    expect(migration).toContain('idx_leads_dedupe_street_original');
    expect(migration).toContain('idx_leads_dedupe_apn_original');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.find_lead_duplicate_context');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.find_lead_duplicate_context(JSONB) FROM authenticated'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.find_lead_duplicate_context(JSONB) TO service_role'
    );
    expect(adminRoute).toContain('assignImportDuplicates(supabase, leadsWithIds)');
    expect(emailRoute).toContain('assignImportDuplicates(supabase, lookupRecords)');
    expect(inboundRoute).toContain('assignImportDuplicates(supabase, lookupRecords)');
    expect(recheckRoute).toContain(
      "address_city, address_zip, address_dedupe_key, is_flagged_duplicate"
    );
    expect(adminRoute).not.toContain(".from('leads')\n        .select('id, apn");
    expect(emailRoute).not.toContain(".from('leads')\n            .select('address_street')");
  });
});
