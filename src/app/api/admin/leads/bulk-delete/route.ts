import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { LIMITS } from '@/lib/utils/validation';
import { parseLeadIdList } from '@/lib/leads/lead-deletion';
import { deleteLeadsWithAudit } from '@/lib/leads/lead-deletion.server';

/**
 * Delete many leads at once, or preview what that would destroy.
 *
 * Admin-only, like single-lead deletion. Every lead still gets its own
 * lead_deletions record, so a bulk delete shows up in Deleted leads exactly as
 * the same deletions done one at a time would.
 *
 * `dry_run: true` writes nothing. The confirmation dialog uses it to show how
 * much fieldwork goes with the selection before anyone commits.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    let body: { lead_ids?: unknown; dry_run?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseLeadIdList(body?.lead_ids, LIMITS.BULK_DELETE_MAX);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }
    const dryRun = body.dry_run === true;

    const result = await deleteLeadsWithAudit(db(), admin.sub, parsed.ids, { dryRun });
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    const { receipt } = result;
    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      requested: receipt.requested,
      found: receipt.found,
      deleted: receipt.deleted,
      worked: receipt.worked,
      destroyed: receipt.destroyed,
      photo_cleanup_failed: result.photoCleanupFailed,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
