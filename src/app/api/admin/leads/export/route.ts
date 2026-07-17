import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { buildLeadSearchFilter } from '@/lib/utils/lead-query';

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(values: unknown[]): string {
  return values.map(escapeCsv).join(',');
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const sourceId = searchParams.get('source_id');
    const search = searchParams.get('search');

    const supabase = db();

    // Fetch all matching leads (no pagination)
    let query = supabase
      .from('leads')
      .select('*, lead_sources!source_id(display_name)')
      .eq('is_flagged_duplicate', false)
      .order('created_at', { ascending: false })
      .limit(10000);

    const CLOSER_STATUSES = ['appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost'];
    if (admin.role === 'closer') {
      if (status && CLOSER_STATUSES.includes(status)) {
        query = query.eq('status', status);
      } else {
        query = query.in('status', CLOSER_STATUSES);
      }
    } else if (status) {
      query = query.eq('status', status);
    }

    if (admin.role !== 'closer') {
      if (priority) query = query.eq('priority', priority);
      if (sourceId) query = query.eq('source_id', parseInt(sourceId, 10));
    }

    const searchFilter = buildLeadSearchFilter(search);
    if (searchFilter) {
      query = query.or(searchFilter);
    }

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
