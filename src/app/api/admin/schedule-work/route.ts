import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';
import {
  calendarScopeAssignment,
  isCalendarDateParam,
  resolveCalendarScope,
} from '@/lib/leads/calendar';
import type { LeadStatus } from '@/types';

const PAGE_SIZE = 100;
const WORK_LIMIT = 30;
const SCAN_LIMIT = 2_000;
const CLOSED_STATUSES = '("sold","lost")';

interface EmbeddedAccount {
  id: string;
  name: string;
}

interface DueLeadRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone2: string | null;
  phone3: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  latitude: number | null;
  longitude: number | null;
  status: LeadStatus;
  follow_up_date: string;
  is_dnc: boolean;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  assigned_setter: EmbeddedAccount | EmbeddedAccount[] | null;
  assigned_closer: EmbeddedAccount | EmbeddedAccount[] | null;
}

function relationToOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Due follow-ups that still need a booking.
 *
 * The due date is a local calendar value supplied by the browser. `now` is an
 * explicit instant. The anti-join is done in bounded pages because the current
 * schema has no durable schedule-work view and this phase requires no migration.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dueBefore = searchParams.get('due_before');
    const now = searchParams.get('now');
    if (!isCalendarDateParam(dueBefore) || !now || Number.isNaN(Date.parse(now))) {
      return NextResponse.json(
        { success: false, error: 'Valid due_before and now params are required' },
        { status: 400 }
      );
    }
    const nowIso = new Date(Date.parse(now)).toISOString();

    const scopeDecision = resolveCalendarScope(admin.role, searchParams.get('scope'));
    if (!scopeDecision.ok) {
      return NextResponse.json(
        { success: false, error: scopeDecision.error },
        { status: scopeDecision.status }
      );
    }

    const supabase = db();
    const actor = { id: admin.sub, role: admin.role };
    const scope = scopeDecision.scope;
    const assignment = calendarScopeAssignment(scope);
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));
    const fields =
      'id, first_name, last_name, phone, phone2, phone3, address_street, address_city, ' +
      'address_state, address_zip, latitude, longitude, status, follow_up_date, is_dnc, ' +
      'assigned_setter_id, assigned_closer_id, ' +
      'assigned_setter:admin_users!assigned_setter_id(id, name), ' +
      'assigned_closer:admin_users!assigned_closer_id(id, name)';

    function duePage(offset: number) {
      let query = applyMarketFilter(
        supabase
          .from('leads')
          .select(fields)
          .lte('follow_up_date', dueBefore)
          .not('follow_up_date', 'is', null)
          .not('status', 'in', CLOSED_STATUSES)
          .eq('is_flagged_duplicate', false)
          .order('follow_up_date', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1),
        marketId
      );

      if (assignment) return query.eq(assignment.column, assignment.accountId);
      const leadScope = scope === 'all' ? 'all' : 'mine';
      query = applyLeadAccessFilter(query, actor, { scope: leadScope });
      return query;
    }

    const work: DueLeadRow[] = [];
    let scanned = 0;
    let reachedEnd = false;

    while (work.length < WORK_LIMIT && scanned < SCAN_LIMIT && !reachedEnd) {
      const page = await duePage(scanned);
      if (page.error) {
        return NextResponse.json({ success: false, error: page.error.message }, { status: 500 });
      }

      const rows = (page.data ?? []) as unknown as DueLeadRow[];
      if (rows.length === 0) break;
      scanned += rows.length;
      reachedEnd = rows.length < PAGE_SIZE;

      const leadIds = rows.map((lead) => lead.id);
      const future = await supabase
        .from('lead_appointments')
        .select('lead_id')
        .in('lead_id', leadIds)
        .gte('scheduled_at', nowIso)
        .eq('outcome', 'scheduled');
      if (future.error) {
        return NextResponse.json({ success: false, error: future.error.message }, { status: 500 });
      }

      const booked = new Set((future.data ?? []).map((appointment) => appointment.lead_id));
      for (const lead of rows) {
        if (!booked.has(lead.id)) work.push(lead);
        if (work.length === WORK_LIMIT) break;
      }
    }

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      dueBefore,
      scope,
      truncated: !reachedEnd && scanned >= SCAN_LIMIT,
      hasMore: work.length === WORK_LIMIT || (!reachedEnd && scanned >= SCAN_LIMIT),
      work: work.map((lead) => {
        const {
          assigned_setter: setterRelation,
          assigned_closer: closerRelation,
          ...leadFields
        } = lead;
        return {
          ...leadFields,
          setter: relationToOne(setterRelation),
          closer: relationToOne(closerRelation),
        };
      }),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
