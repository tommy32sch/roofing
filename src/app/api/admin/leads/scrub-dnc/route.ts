import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

/**
 * Remove phone numbers from every lead flagged Do Not Call, while keeping the
 * lead itself. DNC restricts calling, not door-knocking — so the address stays
 * on the list and map for canvassing; only the callable numbers are cleared.
 * Admin-only; the UI gates this behind a confirmation.
 */
export async function POST() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = db();

    // Count leads that still have a number to clear, for an accurate summary.
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('is_dnc', true)
      .or('phone.not.is.null,phone2.not.is.null,phone3.not.is.null');

    const { error } = await supabase
      .from('leads')
      .update({
        phone: null,
        phone_normalized: null,
        phone2: null,
        phone2_normalized: null,
        phone3: null,
        phone3_normalized: null,
      })
      .eq('is_dnc', true);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, scrubbed: count ?? 0 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
