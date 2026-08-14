import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { db } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/utils/validation';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ operationId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { operationId } = await params;
    if (!isValidUUID(operationId)) {
      return NextResponse.json({ success: false, error: 'Invalid operation ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));
    const { data, error } = await db().rpc('get_audit_operation_leads', {
      p_operation_id: operationId,
      p_market_id: marketId,
      p_limit: 500,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, items: data ?? [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
