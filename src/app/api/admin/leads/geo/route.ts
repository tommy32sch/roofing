import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

const CLOSER_STATUSES = ['appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost'];

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
        'id, first_name, last_name, latitude, longitude, status, priority, estimated_roof_value, address_street, address_city'
      )
      .eq('is_flagged_duplicate', false)
      .limit(10000);

    // Closers only see leads from appointment_set onward (matches leads GET)
    if (admin.role === 'closer') {
      if (status && CLOSER_STATUSES.includes(status)) {
        query = query.eq('status', status);
      } else {
        query = query.in('status', CLOSER_STATUSES);
      }
    } else if (status) {
      query = query.eq('status', status);
    }
    if (priority) query = query.eq('priority', priority);

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
