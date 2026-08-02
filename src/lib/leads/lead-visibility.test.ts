import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyLeadVisibilityFilter,
  authorizeLeadAccess,
  canDeleteLeadPhoto,
  canViewLead,
} from './lead-visibility';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';

describe('canViewLead', () => {
  it('lets an admin see any lead', () => {
    for (const s of ['new', 'contacted', 'appointment_set', 'sold', 'lost', null]) {
      expect(canViewLead('admin', s), String(s)).toBe(true);
    }
  });

  // Setters knock every door, so they see every lead. Deliberate: knowing who
  // owns a door is what stops two reps knocking it.
  it('lets a setter see any lead', () => {
    for (const s of ['new', 'contacted', 'sold', null]) {
      expect(canViewLead('setter', s), String(s)).toBe(true);
    }
  });

  it('lets a closer see a sold lead', () => {
    expect(canViewLead('closer', 'sold')).toBe(true);
  });

  // The restriction this exists for — matches the lead detail route.
  it('refuses a closer any lead that is not sold', () => {
    for (const s of ['new', 'contacted', 'appointment_set', 'inspected', 'proposal_sent', 'lost']) {
      expect(canViewLead('closer', s), s).toBe(false);
    }
  });

  /**
   * Fails closed. A missing status normally means the lead row could not be
   * read at all, and defaulting to "probably fine" is the wrong instinct in an
   * access check.
   */
  it('refuses a closer when the status is unknown', () => {
    expect(canViewLead('closer', null)).toBe(false);
    expect(canViewLead('closer', undefined)).toBe(false);
    expect(canViewLead('closer', '')).toBe(false);
  });
});

describe('applyLeadVisibilityFilter', () => {
  function queryProbe() {
    const filters: Array<[string, string]> = [];
    return {
      filters,
      query: {
        eq(column: string, value: string) {
          filters.push([column, value]);
          return this;
        },
      },
    };
  }

  it('does not narrow admin or setter queries', () => {
    for (const role of ['admin', 'setter'] as const) {
      const { query, filters } = queryProbe();
      expect(applyLeadVisibilityFilter(query, role)).toBe(query);
      expect(filters).toEqual([]);
    }
  });

  it('narrows closer queries on either a lead or embedded-lead status column', () => {
    const direct = queryProbe();
    applyLeadVisibilityFilter(direct.query, 'closer');
    expect(direct.filters).toEqual([['status', 'sold']]);

    const related = queryProbe();
    applyLeadVisibilityFilter(related.query, 'closer', 'leads.status');
    expect(related.filters).toEqual([['leads.status', 'sold']]);
  });
});

describe('canDeleteLeadPhoto', () => {
  it('allows an admin regardless of who uploaded the photo', () => {
    expect(canDeleteLeadPhoto('admin', OTHER_ID, OWNER_ID)).toBe(true);
    expect(canDeleteLeadPhoto('admin', OTHER_ID, null)).toBe(true);
  });

  it('allows a setter or closer to delete only their own upload', () => {
    expect(canDeleteLeadPhoto('setter', OWNER_ID, OWNER_ID)).toBe(true);
    expect(canDeleteLeadPhoto('closer', OWNER_ID, OWNER_ID)).toBe(true);
    expect(canDeleteLeadPhoto('setter', OTHER_ID, OWNER_ID)).toBe(false);
    expect(canDeleteLeadPhoto('closer', OTHER_ID, OWNER_ID)).toBe(false);
  });

  it('fails closed for legacy photos with no uploader', () => {
    expect(canDeleteLeadPhoto('setter', OWNER_ID, null)).toBe(false);
    expect(canDeleteLeadPhoto('closer', OWNER_ID, undefined)).toBe(false);
  });
});

describe('authorizeLeadAccess', () => {
  function clientReturning(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = async () => result;
    const eq = () => ({ maybeSingle });
    const select = () => ({ eq });
    return { from: () => ({ select }) } as unknown as SupabaseClient;
  }

  it('returns one consistent denial for a missing or forbidden lead', async () => {
    await expect(
      authorizeLeadAccess(clientReturning({ data: null, error: null }), 'setter', OWNER_ID)
    ).resolves.toEqual({ ok: false, status: 404, error: 'Lead not found' });

    await expect(
      authorizeLeadAccess(
        clientReturning({ data: { id: OWNER_ID, status: 'appointment_set' }, error: null }),
        'closer',
        OWNER_ID
      )
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('passes through visible leads and database failures', async () => {
    await expect(
      authorizeLeadAccess(
        clientReturning({ data: { id: OWNER_ID, status: 'new' }, error: null }),
        'setter',
        OWNER_ID
      )
    ).resolves.toEqual({ ok: true, lead: { id: OWNER_ID, status: 'new' } });

    await expect(
      authorizeLeadAccess(
        clientReturning({ data: null, error: { message: 'database unavailable' } }),
        'admin',
        OWNER_ID
      )
    ).resolves.toEqual({ ok: false, status: 500, error: 'database unavailable' });
  });
});
