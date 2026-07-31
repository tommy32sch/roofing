import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

/**
 * Deleted leads, most recent first.
 *
 * Admin-only. The rows are a snapshot of leads that no longer exist, including
 * names, phones and addresses — the same PII the lead itself held, which is why
 * this is gated the same way the CSV export is.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = (page - 1) * limit;

    const supabase = db();
    let query = supabase
      .from('lead_deletions')
      .select('*', { count: 'exact' })
      .order('deleted_at', { ascending: false });

    const deletedBy = searchParams.get('deleted_by');
    if (deletedBy) query = query.eq('deleted_by', deletedBy);

    // The panel is a review queue, so pending is the default view. Reviewed
    // rows are never removed — they are just not what the queue is for.
    if (searchParams.get('reviewed') === '1') {
      query = query.not('reviewed_at', 'is', null);
    } else if (searchParams.get('all') !== '1') {
      query = query.is('reviewed_at', null);
    }

    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletions: data || [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
