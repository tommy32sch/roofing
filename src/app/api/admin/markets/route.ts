import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { geocodeAddress } from '@/lib/integrations/geocode';

/**
 * Markets (offices).
 *
 * Reading is open to every authenticated role — setters and closers need the
 * list to populate their market picker. Creating and renaming an office is an
 * admin action, enforced here in the handler. This route is deliberately NOT in
 * the middleware admin-only list, because that would block the read too.
 */

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const { data, error } = await db()
    .from('markets')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('name');

  if (error) {
    // Before the markets migration is applied the table doesn't exist. Report an
    // empty list rather than a 500 so the pickers just don't render.
    return NextResponse.json({ success: true, markets: [] });
  }

  return NextResponse.json({ success: true, markets: data ?? [] });
}

export async function POST(request: NextRequest) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }
  if (admin.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  }

  let body: { name?: string; default_geo_city?: string; default_geo_state?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
  }

  const city = body.default_geo_city?.trim() || null;
  const state = body.default_geo_state?.trim()?.toUpperCase() || null;

  // Give the new office a map position up front, so selecting it moves the map
  // even before a single lead is imported. Best-effort: a failed lookup just
  // leaves the center null and the map keeps its current view.
  let center: { latitude: number; longitude: number } | null = null;
  if (city) {
    try {
      center = await geocodeAddress('', city, state, null);
    } catch {
      center = null;
    }
  }

  const { data, error } = await db()
    .from('markets')
    .insert({
      name,
      default_geo_city: city,
      default_geo_state: state,
      center_lat: center?.latitude ?? null,
      center_lng: center?.longitude ?? null,
      center_zoom: center ? 10 : null,
    })
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
