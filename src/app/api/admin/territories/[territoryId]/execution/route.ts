import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidDateString } from '@/lib/leads/today';
import { db } from '@/lib/supabase/server';
import { canExecuteTerritories } from '@/lib/territories/execution';
import { loadTerritoryExecutionSnapshot } from '@/lib/territories/execution.server';
import { isValidUUID } from '@/lib/utils/validation';

/** Exact active-territory membership and field state, independent of map filters. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (!canExecuteTerritories(admin.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { territoryId } = await params;
    if (!isValidUUID(territoryId)) {
      return NextResponse.json({ success: false, error: 'Invalid territory ID' }, { status: 400 });
    }

    const today = new URL(request.url).searchParams.get('date');
    if (!isValidDateString(today)) {
      return NextResponse.json(
        { success: false, error: 'A local date in YYYY-MM-DD form is required' },
        { status: 400 }
      );
    }

    const result = await loadTerritoryExecutionSnapshot(
      db(),
      territoryId,
      { id: admin.sub, role: admin.role },
      { today, now: new Date().toISOString() }
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, snapshot: result.snapshot });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
