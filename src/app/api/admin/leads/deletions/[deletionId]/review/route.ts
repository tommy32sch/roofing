import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';

/**
 * Sign off on a recorded deletion, or undo that sign-off.
 *
 * Marks the row rather than removing it. Deleting the audit record to clear the
 * panel would undo the whole reason it exists, so "clear" here means "reviewed",
 * and the record stays queryable forever.
 *
 * Admin-only, matching who can delete a lead in the first place.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deletionId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { deletionId } = await params;
    if (!isValidUUID(deletionId)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    // Undo exists because approving is one click and mis-clicking it would
    // otherwise bury a deletion that deserved a second look.
    let undo = false;
    try {
      const body = await request.json();
      undo = body?.undo === true;
    } catch {
      // No body is the ordinary "approve" case.
    }

    const supabase = db();
    const { data, error } = await supabase
      .from('lead_deletions')
      .update(
        undo
          ? { reviewed_at: null, reviewed_by: null, reviewed_by_name: null }
          : {
              reviewed_at: new Date().toISOString(),
              reviewed_by: admin.sub,
              reviewed_by_name: admin.name?.trim() || admin.email || null,
            }
      )
      .eq('id', deletionId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deletion: data });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
