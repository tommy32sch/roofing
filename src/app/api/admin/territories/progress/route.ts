import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { isValidDateString } from '@/lib/leads/today';
import { db } from '@/lib/supabase/server';
import { canExecuteTerritories } from '@/lib/territories/execution';
import { loadTerritoryProgressPage } from '@/lib/territories/execution.server';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function positiveInteger(value: string | null, fallback: number, max?: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
}

/** Current, server-derived progress for active territories in the selected market. */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (!canExecuteTerritories(admin.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const today = searchParams.get('date');
    if (!isValidDateString(today)) {
      return NextResponse.json(
        { success: false, error: 'A local date in YYYY-MM-DD form is required' },
        { status: 400 }
      );
    }

    const page = positiveInteger(searchParams.get('page'), 1);
    const limit = positiveInteger(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
    const result = await loadTerritoryProgressPage(db(), {
      role: admin.role,
      marketId: await marketFilterFor(admin.sub, searchParams.get('market_id')),
      page,
      limit,
      clock: { today, now: new Date().toISOString() },
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, ...result.progress });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
