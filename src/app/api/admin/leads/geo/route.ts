import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    const supabase = db();

    let query = supabase
      .from('leads')
      .select(
        'id, market_id, first_name, last_name, latitude, longitude, status, priority, estimated_roof_value, address_street, address_city, is_dnc, hail_date, hail_size_inches, last_knock_at, last_disposition, knock_count, do_not_knock, last_call_at, last_call_disposition, call_count, follow_up_date'
      )
      .eq('is_flagged_duplicate', false)
      .limit(10000);

    query = applyLeadAccessFilter(query, { id: admin.sub, role: admin.role });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);

    // Office scoping: explicit ?market_id, else the caller's home market.
    query = applyMarketFilter(query, await marketFilterFor(admin.marketId, searchParams.get('market_id')));

    const { data: leads, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const all = leads || [];
    const withCoords = all.filter((l) => l.latitude != null && l.longitude != null);

    return NextResponse.json({
      success: true,
      leads: withCoords,
      missing_coords: all.length - withCoords.length,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
