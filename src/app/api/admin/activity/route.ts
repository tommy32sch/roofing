import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = (page - 1) * limit;

    const type = searchParams.get('type');
    const userId = searchParams.get('user_id');

    const supabase = db();

    // Office scoping runs through the activity's lead. Inner-joined only when a
    // market is selected, so activities with no lead row aren't dropped.
    const marketId = await marketFilterFor(admin.sub, searchParams.get('market_id'));
    const leadEmbed = marketId != null ? 'leads!lead_id!inner' : 'leads!lead_id';

    let query = supabase
      .from('lead_activities')
      .select(
        'id, activity_type, content, old_status, new_status, created_at, ' +
        `${leadEmbed}(id, first_name, last_name, address_street, address_city, address_state, market_id), ` +
        'admin_users!created_by(name)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (type) query = query.eq('activity_type', type);
    if (userId) query = query.eq('created_by', userId);
    if (marketId != null) query = query.eq('leads.market_id', marketId);

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      activities: data ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
