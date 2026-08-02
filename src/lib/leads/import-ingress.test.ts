import { readFileSync } from 'fs';
import { join } from 'path';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignImportDuplicates } from './dedupe';

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

describe('indexed import duplicate lookup', () => {
  it('uses the database-normalized context and keeps existing rows first', async () => {
    const rpc = vi.fn().mockResolvedValue({
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

    expect(rpc).toHaveBeenCalledWith('find_lead_duplicate_context', {
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
    const failedRpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'db failed' } });
    const incompleteRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const records = [{ id: 'new:0', address_street: '1 Main St' }];

    await expect(assignImportDuplicates(
      { rpc: failedRpc } as unknown as SupabaseClient,
      records
    )).rejects.toThrow('Failed to load duplicate candidates');
    await expect(assignImportDuplicates(
      { rpc: incompleteRpc } as unknown as SupabaseClient,
      records
    )).rejects.toThrow('Duplicate lookup returned incomplete context');
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
