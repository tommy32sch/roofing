import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

export async function GET() {
  try {
    // Only vendor names live here, so the payload is dull — but authenticating
    // is what runs the token_version revocation check, and every other admin
    // route does it. A route that skips it is the one someone copies next.
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = db();
    const { data: sources, error } = await supabase
      .from('lead_sources')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, sources: sources || [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
