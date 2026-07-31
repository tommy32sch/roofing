import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { getCassKey } from '@/lib/integrations/geocode';
import { reverseGeocode } from '@/lib/integrations/geocode-reverse';
import { findNearbyLeads, isPlausibleCoordinate, NEARBY_RADIUS_M } from '@/lib/leads/walk-up';

/**
 * What is at this point on the map?
 *
 * Answers the two questions a rep has the instant they drop a pin: what is this
 * address, and is this house already in the system. Both in one round trip,
 * because it happens while they are standing at the door.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const latitude = Number(searchParams.get('lat'));
    const longitude = Number(searchParams.get('lng'));
    if (!isPlausibleCoordinate(latitude, longitude)) {
      return NextResponse.json({ success: false, error: 'Invalid coordinates' }, { status: 400 });
    }

    const supabase = db();

    /*
     * Narrow with a bounding box before measuring properly. Postgres cannot use
     * an index on a haversine expression, so this fetches the few rows within
     * roughly the right square and does the real distance in memory. At this
     * latitude 0.001 degrees is about 100m, comfortably wider than the radius.
     */
    const pad = 0.001;
    const { data: candidates } = await supabase
      .from('leads')
      .select('id, first_name, last_name, address_street, status, latitude, longitude')
      .gte('latitude', latitude - pad)
      .lte('latitude', latitude + pad)
      .gte('longitude', longitude - pad)
      .lte('longitude', longitude + pad)
      .limit(200);

    const nearby = findNearbyLeads(
      (candidates ?? []) as { id: string; latitude: number; longitude: number }[],
      { latitude, longitude },
      NEARBY_RADIUS_M
    );

    const address = await reverseGeocode(latitude, longitude, await getCassKey());

    return NextResponse.json({ success: true, address, nearby });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
