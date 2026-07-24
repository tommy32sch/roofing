import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

/** Rename an office, adjust its geocoding fallback, or retire it. Admin only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }
  if (admin.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  const { marketId } = await params;
  const id = Number(marketId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'Invalid market' }, { status: 400 });
  }

  let body: {
    name?: string;
    default_geo_city?: string | null;
    default_geo_state?: string | null;
    is_active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ success: false, error: 'Name cannot be empty' }, { status: 400 });
    }
    updates.name = name;
  }
  if (body.default_geo_city !== undefined) {
    updates.default_geo_city = body.default_geo_city?.trim() || null;
  }
  if (body.default_geo_state !== undefined) {
    updates.default_geo_state = body.default_geo_state?.trim()?.toUpperCase() || null;
  }
  if (body.is_active !== undefined) updates.is_active = !!body.is_active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await db()
    .from('markets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    const duplicate = error.code === '23505';
    return NextResponse.json(
      { success: false, error: duplicate ? 'A market with that name already exists' : error.message },
      { status: duplicate ? 409 : 500 }
    );
  }

  return NextResponse.json({ success: true, market: data });
}
