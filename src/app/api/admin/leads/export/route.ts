import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { safeSortColumn } from '@/lib/utils/lead-query';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import {
  applyLeadQueueFilters,
  leadQueueRequestParamsFromSearchParams,
} from '@/lib/leads/work-queue.server';
import { leadQueueSort } from '@/lib/leads/work-queue';
// Escaping lives in a shared module because it does two jobs — CSV quoting AND
// neutralising spreadsheet formulas in attacker-supplied lead text.
import { csvRow as row } from '@/lib/utils/csv';
import { isValidUUID } from '@/lib/utils/validation';



export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    /**
     * Admin-only. Every role can SEE these leads — that is deliberate, so reps
     * know who owns a door and don't double-knock — but one click that pulls
     * 10,000 rows of names, phones, emails and addresses into a file is a
     * different exposure from browsing them on screen. It is how a lead list
     * leaves with a departing rep.
     *
     * The button is hidden for non-admins too; this is the half that a hidden
     * button cannot enforce, since the endpoint is a plain GET anyone signed in
     * could request directly.
     */
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('source_id');
    const importBatchId = searchParams.get('import_batch_id');
    if (importBatchId && !isValidUUID(importBatchId)) {
      return NextResponse.json({ success: false, error: 'Invalid import batch ID' }, { status: 400 });
    }
    const queueParams = leadQueueRequestParamsFromSearchParams(searchParams);
    const { sort, order } = leadQueueSort(queueParams);

    const supabase = db();

    // Fetch all matching leads (no pagination)
    let query = supabase
      .from('leads')
      .select('*, lead_sources!source_id(display_name)')
      .eq('is_flagged_duplicate', false);

    query = applyMarketFilter(
      query,
      await marketFilterFor(admin.marketId, queueParams.market_id ?? null)
    );
    query = applyLeadQueueFilters(query, queueParams);
    if (importBatchId) query = query.eq('import_batch_id', importBatchId);

    // Only admins reach this point, so the closer status/priority scoping that
    // used to live here was unreachable — and kept implying a closer could
    // still export a narrowed list. The filters below are simply the ones the
    // Leads page passed in.
    if (sourceId) query = query.eq('source_id', parseInt(sourceId, 10));

    const ascending = order === 'asc';
    const sortColumn = safeSortColumn(sort);
    query = query.order(sortColumn, { ascending, nullsFirst: false });
    if (sortColumn === 'last_name') query = query.order('first_name', { ascending, nullsFirst: false });
    if (sortColumn === 'first_name') query = query.order('last_name', { ascending, nullsFirst: false });
    if (sortColumn !== 'created_at') query = query.order('created_at', { ascending: false, nullsFirst: false });
    query = query.order('id', { ascending: true }).limit(10000);

    const { data: leads, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Fetch users to resolve setter/closer names
    const { data: users } = await supabase
      .from('admin_users')
      .select('id, name');
    const userMap = new Map((users || []).map(u => [u.id, u.name]));

    const headers = [
      'First Name', 'Last Name', 'Phone', 'Email',
      'Address', 'City', 'State', 'ZIP',
      'Status', 'Priority', 'Source', 'Est. Roof Value', 'Deal Value',
      'Assigned Setter', 'Assigned Closer',
      'Hail Date', 'Hail Size (in)', 'Roof Type', 'Roof Age',
      'Home Value', 'Year Built', 'Sqft',
      'Created At',
    ];

    const lines: string[] = [headers.join(',')];

    for (const lead of leads || []) {
      const source = (lead.lead_sources as { display_name: string } | null)?.display_name ?? '';
      lines.push(row([
        lead.first_name,
        lead.last_name,
        lead.phone,
        lead.email,
        lead.address_street,
        lead.address_city,
        lead.address_state,
        lead.address_zip,
        lead.status,
        lead.priority,
        source,
        lead.estimated_roof_value != null ? lead.estimated_roof_value : '',
        lead.deal_value != null ? lead.deal_value : '',
        lead.assigned_setter_id ? (userMap.get(lead.assigned_setter_id) ?? lead.assigned_setter_id) : '',
        lead.assigned_closer_id ? (userMap.get(lead.assigned_closer_id) ?? lead.assigned_closer_id) : '',
        lead.hail_date,
        lead.hail_size_inches,
        lead.roof_type !== 'unknown' ? lead.roof_type : '',
        lead.roof_age,
        lead.home_value,
        lead.year_built,
        lead.sqft,
        lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-US') : '',
      ]));
    }

    const csv = lines.join('\n');
    const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
