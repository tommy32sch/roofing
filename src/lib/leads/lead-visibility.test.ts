import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyLeadAccessFilter,
  assignmentForNewLead,
  authorizeLeadAccess,
  canAccessLead,
  canDeleteLeadPhoto,
  resolveLeadDataScope,
  type LeadActor,
} from './lead-visibility';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const admin: LeadActor = { id: OWNER_ID, role: 'admin' };
const setter: LeadActor = { id: OWNER_ID, role: 'setter' };
const closer: LeadActor = { id: OWNER_ID, role: 'closer' };

const lead = (
  assignedSetterId: string | null,
  assignedCloserId: string | null
) => ({
  id: OTHER_ID,
  assigned_setter_id: assignedSetterId,
  assigned_closer_id: assignedCloserId,
});

describe('canAccessLead', () => {
  it('lets an admin see the team or limit the result to either assignment', () => {
    expect(canAccessLead(admin, lead(null, null), 'all')).toBe(true);
    expect(canAccessLead(admin, lead(OWNER_ID, null), 'mine')).toBe(true);
    expect(canAccessLead(admin, lead(null, OWNER_ID), 'mine')).toBe(true);
    expect(canAccessLead(admin, lead(OTHER_ID, OTHER_ID), 'mine')).toBe(false);
  });

  it('uses the setter assignment for a setter and the closer assignment for a closer', () => {
    expect(canAccessLead(setter, lead(OWNER_ID, OTHER_ID))).toBe(true);
    expect(canAccessLead(setter, lead(OTHER_ID, OWNER_ID))).toBe(false);
    expect(canAccessLead(closer, lead(OTHER_ID, OWNER_ID))).toBe(true);
    expect(canAccessLead(closer, lead(OWNER_ID, OTHER_ID))).toBe(false);
  });

  it('does not use pipeline status as an access rule', () => {
    for (const status of ['new', 'contacted', 'appointment_set', 'sold', 'lost']) {
      const candidate = { ...lead(null, OWNER_ID), status };
      expect(canAccessLead(closer, candidate), status).toBe(true);
    }
  });
});

describe('resolveLeadDataScope', () => {
  it('lets an admin choose mine or all and defaults to all', () => {
    expect(resolveLeadDataScope(admin, null)).toEqual({ ok: true, scope: 'all' });
    expect(resolveLeadDataScope(admin, 'mine')).toEqual({ ok: true, scope: 'mine' });
    expect(resolveLeadDataScope(admin, 'all')).toEqual({ ok: true, scope: 'all' });
  });

  it('forces reps to mine and rejects an explicit team request', () => {
    expect(resolveLeadDataScope(setter, null)).toEqual({ ok: true, scope: 'mine' });
    expect(resolveLeadDataScope(closer, 'mine')).toEqual({ ok: true, scope: 'mine' });
    expect(resolveLeadDataScope(setter, 'all')).toEqual({
      ok: false,
      status: 403,
      error: 'Team data is limited to admins',
    });
  });

  it('rejects an unknown scope', () => {
    expect(resolveLeadDataScope(admin, 'team')).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid lead scope',
    });
  });
});

describe('applyLeadAccessFilter', () => {
  function queryProbe() {
    const calls: unknown[][] = [];
    const query = {
      eq(column: string, value: string) {
        calls.push(['eq', column, value]);
        return this;
      },
      or(filters: string, options?: { foreignTable: string }) {
        calls.push(['or', filters, options]);
        return this;
      },
    };
    return { calls, query };
  }

  it('does not narrow an admin team query', () => {
    const probe = queryProbe();
    expect(applyLeadAccessFilter(probe.query, admin)).toBe(probe.query);
    expect(probe.calls).toEqual([]);
  });

  it('uses the role-specific column on direct and embedded queries', () => {
    const direct = queryProbe();
    applyLeadAccessFilter(direct.query, setter);
    expect(direct.calls).toEqual([['eq', 'assigned_setter_id', OWNER_ID]]);

    const embedded = queryProbe();
    applyLeadAccessFilter(embedded.query, closer, { foreignTable: 'leads' });
    expect(embedded.calls).toEqual([['eq', 'leads.assigned_closer_id', OWNER_ID]]);
  });

  it('uses either assignment for an admin mine query', () => {
    const probe = queryProbe();
    applyLeadAccessFilter(probe.query, admin, { scope: 'mine', foreignTable: 'leads' });
    expect(probe.calls).toEqual([
      [
        'or',
        `assigned_setter_id.eq.${OWNER_ID},assigned_closer_id.eq.${OWNER_ID}`,
        { foreignTable: 'leads' },
      ],
    ]);
  });
});

describe('assignmentForNewLead', () => {
  it('auto-assigns a rep-created lead to the matching role only', () => {
    expect(assignmentForNewLead(setter)).toEqual({ assigned_setter_id: OWNER_ID });
    expect(assignmentForNewLead(closer)).toEqual({ assigned_closer_id: OWNER_ID });
    expect(assignmentForNewLead(admin)).toEqual({});
  });
});

describe('authorizeLeadAccess', () => {
  function clientReturning(result: { data: unknown; error: { message: string } | null }) {
    const maybeSingle = async () => result;
    const eq = () => ({ maybeSingle });
    const select = () => ({ eq });
    return { from: () => ({ select }) } as unknown as SupabaseClient;
  }

  it('distinguishes a missing lead from a lead assigned to someone else', async () => {
    await expect(
      authorizeLeadAccess(clientReturning({ data: null, error: null }), setter, OTHER_ID)
    ).resolves.toEqual({ ok: false, status: 404, error: 'Lead not found' });

    await expect(
      authorizeLeadAccess(
        clientReturning({ data: lead(OTHER_ID, OTHER_ID), error: null }),
        setter,
        OTHER_ID
      )
    ).resolves.toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('passes through an assigned lead and database failures', async () => {
    const visible = lead(OWNER_ID, null);
    await expect(
      authorizeLeadAccess(clientReturning({ data: visible, error: null }), setter, OTHER_ID)
    ).resolves.toEqual({ ok: true, lead: visible });

    await expect(
      authorizeLeadAccess(
        clientReturning({ data: null, error: { message: 'database unavailable' } }),
        admin,
        OTHER_ID
      )
    ).resolves.toEqual({ ok: false, status: 500, error: 'database unavailable' });
  });
});

describe('canDeleteLeadPhoto', () => {
  it('allows an admin regardless of who uploaded the photo', () => {
    expect(canDeleteLeadPhoto('admin', OTHER_ID, OWNER_ID)).toBe(true);
    expect(canDeleteLeadPhoto('admin', OTHER_ID, null)).toBe(true);
  });

  it('allows a rep to delete only their own upload', () => {
    expect(canDeleteLeadPhoto('setter', OWNER_ID, OWNER_ID)).toBe(true);
    expect(canDeleteLeadPhoto('closer', OWNER_ID, OWNER_ID)).toBe(true);
    expect(canDeleteLeadPhoto('setter', OTHER_ID, OWNER_ID)).toBe(false);
    expect(canDeleteLeadPhoto('closer', OTHER_ID, OWNER_ID)).toBe(false);
    expect(canDeleteLeadPhoto('setter', OWNER_ID, null)).toBe(false);
  });
});
