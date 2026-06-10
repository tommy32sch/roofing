import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID, LIMITS } from '@/lib/utils/validation';
import { distributeLeads } from '@/lib/leads/distribute';
import type { UserRole } from '@/types';

// supabase-js encodes .in() filters into the URL; keep chunks small enough
// that 100 UUIDs never push past gateway URL-length limits.
const IN_CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface AssignmentSummary {
  user_id: string | null;
  name: string | null;
  count: number;
  total_value: number;
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { mode, role, dry_run } = body as { mode?: string; role?: string; dry_run?: boolean };

    if (mode !== 'single' && mode !== 'distribute') {
      return NextResponse.json({ success: false, error: 'Invalid mode' }, { status: 400 });
    }
    if (role !== 'setter' && role !== 'closer') {
      return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
    }

    if (!Array.isArray(body.lead_ids) || body.lead_ids.some((id: unknown) => typeof id !== 'string' || !isValidUUID(id))) {
      return NextResponse.json({ success: false, error: 'Invalid lead_ids' }, { status: 400 });
    }
    const leadIds = [...new Set(body.lead_ids as string[])];
    if (leadIds.length === 0 || leadIds.length > LIMITS.BULK_ASSIGN_MAX) {
      return NextResponse.json(
        { success: false, error: `lead_ids must contain 1-${LIMITS.BULK_ASSIGN_MAX} leads` },
        { status: 400 }
      );
    }

    // Resolve target user ids per mode
    let targetIds: string[];
    let strategy: 'count' | 'value' | null = null;
    if (mode === 'single') {
      if (body.user_id !== null && (typeof body.user_id !== 'string' || !isValidUUID(body.user_id))) {
        return NextResponse.json({ success: false, error: 'Invalid user_id' }, { status: 400 });
      }
      targetIds = body.user_id === null ? [] : [body.user_id];
    } else {
      strategy = body.strategy;
      if (strategy !== 'count' && strategy !== 'value') {
        return NextResponse.json({ success: false, error: 'Invalid strategy' }, { status: 400 });
      }
      if (!Array.isArray(body.user_ids) || body.user_ids.some((id: unknown) => typeof id !== 'string' || !isValidUUID(id))) {
        return NextResponse.json({ success: false, error: 'Invalid user_ids' }, { status: 400 });
      }
      targetIds = [...new Set(body.user_ids as string[])];
      if (targetIds.length < 2 || targetIds.length > 20) {
        return NextResponse.json(
          { success: false, error: 'distribute mode requires 2-20 users' },
          { status: 400 }
        );
      }
    }

    const supabase = db();

    // Verify target users exist and are eligible (matching role, or admin —
    // mirrors the single-lead assignment dropdowns).
    const userMap = new Map<string, string>();
    if (targetIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('admin_users')
        .select('id, name, role')
        .in('id', targetIds);
      if (usersError) {
        return NextResponse.json({ success: false, error: usersError.message }, { status: 500 });
      }
      const eligible = (users || []).filter(
        (u: { role: UserRole }) => u.role === role || u.role === 'admin'
      );
      if (eligible.length !== targetIds.length) {
        return NextResponse.json(
          { success: false, error: `One or more selected users not found or not eligible for ${role} assignment` },
          { status: 400 }
        );
      }
      eligible.forEach((u: { id: string; name: string }) => userMap.set(u.id, u.name));
    }

    // Fetch the leads that still exist (chunked .in())
    const foundLeads: { id: string; estimated_roof_value: number | null }[] = [];
    for (const ids of chunk(leadIds, IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, estimated_roof_value')
        .in('id', ids);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      foundLeads.push(...(data || []));
    }
    if (foundLeads.length === 0) {
      return NextResponse.json({ success: false, error: 'No matching leads found' }, { status: 404 });
    }
    const skipped = leadIds.length - foundLeads.length;

    // Build assignment groups (user_id null = unassign, single mode only)
    let groups: { user_id: string | null; lead_ids: string[]; count: number; total_value: number }[];
    if (mode === 'single') {
      groups = [
        {
          user_id: body.user_id,
          lead_ids: foundLeads.map((l) => l.id),
          count: foundLeads.length,
          total_value: foundLeads.reduce((s, l) => s + (Number(l.estimated_roof_value) || 0), 0),
        },
      ];
    } else {
      groups = distributeLeads(
        foundLeads.map((l) => ({ id: l.id, value: l.estimated_roof_value })),
        targetIds,
        strategy!
      );
    }

    const assignments: AssignmentSummary[] = groups.map((g) => ({
      user_id: g.user_id,
      name: g.user_id ? (userMap.get(g.user_id) ?? null) : null,
      count: g.count,
      total_value: g.total_value,
    }));

    if (dry_run) {
      return NextResponse.json({ success: true, dry_run: true, updated: 0, skipped, assignments });
    }

    // Apply updates per group, chunked; .select('id') returns rows actually written
    const column = role === 'setter' ? 'assigned_setter_id' : 'assigned_closer_id';
    let updated = 0;
    const activityRows: { lead_id: string; activity_type: string; content: string; created_by: string }[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const content = group.user_id
        ? `Bulk assigned ${role}: ${userMap.get(group.user_id)}`
        : `Bulk unassigned ${role}`;
      let groupUpdated = 0;
      for (const ids of chunk(group.lead_ids, IN_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from('leads')
          .update({ [column]: group.user_id })
          .in('id', ids)
          .select('id');
        if (error) {
          return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }
        const writtenIds = (data || []).map((r) => r.id);
        groupUpdated += writtenIds.length;
        activityRows.push(
          ...writtenIds.map((lead_id) => ({
            lead_id,
            activity_type: 'updated',
            content,
            created_by: admin.sub,
          }))
        );
      }
      updated += groupUpdated;
      assignments[i].count = groupUpdated;
    }

    // One bulk activity insert; non-fatal on failure
    if (activityRows.length > 0) {
      const { error: activityError } = await supabase.from('lead_activities').insert(activityRows);
      if (activityError) {
        console.error('Bulk assign activity log failed:', activityError.message);
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: false,
      updated,
      skipped: leadIds.length - updated,
      assignments,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
