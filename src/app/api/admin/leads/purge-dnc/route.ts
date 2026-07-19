import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

/**
 * Delete every lead flagged Do Not Call. Admin-only and irreversible; the UI
 * gates this behind a confirmation. Child rows (activities, appointments)
 * cascade via their ON DELETE CASCADE foreign keys.
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
    const { error, count } = await supabase
      .from('leads')
      .delete({ count: 'exact' })
      .eq('is_dnc', true);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: count ?? 0 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
