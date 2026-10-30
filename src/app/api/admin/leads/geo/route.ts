import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';

const PAGE_SIZE = 1000;

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
    // Office scoping: explicit ?market_id, else the caller's home market.
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));

    const loadPage = async (after: string | null) => {
      let query = supabase
        .from('leads')
        .select(
          'id, market_id, first_name, last_name, latitude, longitude, status, priority, estimated_roof_value, phone, address_street, address_city, address_state, address_zip, is_dnc, hail_date, hail_size_inches, last_knock_at, last_disposition, knock_count, do_not_knock, last_call_at, last_call_disposition, call_count, follow_up_date'
        )
        .eq('is_flagged_duplicate', false);

      query = applyLeadAccessFilter(query, { id: admin.sub, role: admin.role });

      if (status) query = query.eq('status', status);
      if (priority) query = query.eq('priority', priority);
      query = applyMarketFilter(query, marketId);
      if (after) query = query.gt('id', after);

      return await query.order('id', { ascending: true }).limit(PAGE_SIZE);
    };

    // Supabase caps each response independently of the requested limit. Read
    // every page, including rows without coordinates so the warning is exact.
    // Stop on an empty page to also support a database cap below PAGE_SIZE.
    const all: NonNullable<Awaited<ReturnType<typeof loadPage>>['data']> = [];
    let after: string | null = null;
    for (;;) {
      const { data, error } = await loadPage(after);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      if (!data?.length) break;
      all.push(...data);
      after = data[data.length - 1].id;
    }

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
