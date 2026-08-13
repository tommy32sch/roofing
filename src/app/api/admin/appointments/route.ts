import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';

const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return NextResponse.json(
        { success: false, error: 'Valid start and end params are required' },
        { status: 400 }
      );
    }
    if (Date.parse(end) - Date.parse(start) > MAX_WINDOW_MS) {
      return NextResponse.json({ success: false, error: 'Window too large (max 90 days)' }, { status: 400 });
    }

    const supabase = db();

    // Office and account scoping run through the appointment's lead. The lead
    // foreign key is required with ON DELETE CASCADE, so an inner join cannot
    // remove a valid appointment.
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));
    const leadEmbed = 'leads!lead_id!inner';

    let apptQuery = supabase
      .from('lead_appointments')
      .select(
        `*, ${leadEmbed}(id, first_name, last_name, address_street, address_city, status, assigned_setter_id, assigned_closer_id, market_id)`
      )
      .gte('scheduled_at', start)
      .lt('scheduled_at', end)
      .order('scheduled_at', { ascending: true });

    if (marketId != null) apptQuery = apptQuery.eq('leads.market_id', marketId);
    apptQuery = applyLeadAccessFilter(apptQuery, { id: admin.sub, role: admin.role }, {
      foreignTable: 'leads',
    });

    const { data: appointments, error } = await apptQuery;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, appointments: appointments || [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
