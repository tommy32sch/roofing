import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyLeadVisibilityFilter } from '@/lib/leads/lead-visibility';
import { resolveContactActivityUser } from '@/lib/leads/contact-activity';

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
    const user = resolveContactActivityUser(admin.role, admin.sub, searchParams.get('user_id'));
    if (!user.ok) {
      return NextResponse.json(
        { success: false, error: user.error },
        { status: user.status }
      );
    }

    const supabase = db();

    // lead_id is non-null with ON DELETE CASCADE, so every surviving activity
    // has a parent. The inner join lets market and role visibility constrain the
    // parent row instead of merely nulling its embedded PII.
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));
    const leadEmbed = 'leads!lead_id!inner';

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
    if (user.userId) query = query.eq('created_by', user.userId);
    if (marketId != null) query = query.eq('leads.market_id', marketId);
    query = applyLeadVisibilityFilter(query, admin.role, 'leads.status');

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
