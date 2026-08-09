import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { normalizePhone } from '@/lib/leads/normalize';
import { KNOCK_DISPOSITION_VALUES, type KnockDisposition } from '@/lib/leads/knocks';
import { validateWalkUp, walkUpNameColumns, type WalkUpInput } from '@/lib/leads/walk-up';

/** The seeded "Door Knock" source — a walk-up is by definition one. */
const DOOR_KNOCK_SOURCE_ID = 8;

/**
 * Create a lead for a house the rep is standing at, plus the knock that
 * prompted it.
 *
 * Open to every role. A setter finding an unlisted house is the entire reason
 * this exists, and importing leads is already open to everyone for the same
 * reason.
 *
 * Coordinates are taken from the request and written directly rather than
 * geocoded. The rep placed the pin on the roof they are looking at, which is
 * better information than any provider can return.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const input: WalkUpInput = {
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      address_street: body.address_street ?? null,
      address_city: body.address_city ?? null,
      address_state: body.address_state ?? null,
      address_zip: body.address_zip ?? null,
      notes: body.notes ?? null,
    };

    const valid = validateWalkUp(input);
    if (!valid.ok) {
      return NextResponse.json({ success: false, error: valid.error }, { status: 400 });
    }

    // A knock is optional — a rep may be logging a house to come back to — but
    // an invalid one is a bug worth surfacing rather than silently dropping.
    let disposition: KnockDisposition | null = null;
    if (body.disposition) {
      if (!KNOCK_DISPOSITION_VALUES.has(body.disposition)) {
        return NextResponse.json({ success: false, error: 'Invalid disposition' }, { status: 400 });
      }
      disposition = body.disposition as KnockDisposition;
    }

    const supabase = db();
    const { first_name, last_name } = walkUpNameColumns(input);
    const phones = normalizePhone(input.phone);

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        first_name,
        last_name,
        phone: phones.phone,
        phone_normalized: phones.phone_normalized,
        email: input.email?.trim()?.toLowerCase() || null,
        address_street: input.address_street?.trim() || null,
        address_city: input.address_city?.trim() || null,
        address_state: input.address_state?.trim() || null,
        address_zip: input.address_zip?.trim() || null,
        // Placed by hand on the map, so it needs no geocoding pass and should
        // never be moved by one.
        latitude: input.latitude,
        longitude: input.longitude,
        status: 'new',
        source_id: DOOR_KNOCK_SOURCE_ID,
        source_notes: 'Added from the map while canvassing',
        market_id: await marketFilterFor(admin.marketId, body.market_id != null ? String(body.market_id) : null),
        created_by: admin.sub,
        created_by_name: admin.name?.trim() || admin.email,
      })
      .select('*')
      .single();

    if (error || !lead) {
      return NextResponse.json(
        { success: false, error: error?.message ?? 'Could not create the lead' },
        { status: 500 }
      );
    }

    /*
     * The knock goes through the same RPC the lead page uses, so the derived
     * state it maintains — last_knock_at, knock_count, do_not_knock, the status
     * transition — cannot drift between the two entry points.
     *
     * Deliberately NOT rolled back if it fails. The lead is the valuable thing
     * the rep just produced standing at a door; discarding it to keep the pair
     * atomic would throw away their work to preserve a technicality. A failed
     * knock is reported instead, and can be recorded again from the lead.
     */
    let knockRecorded = false;
    if (disposition) {
      const { data: knockResult } = await supabase.rpc('record_lead_knock', {
        p_lead_id: lead.id,
        p_disposition: disposition,
        p_notes: input.notes?.trim() || null,
        p_created_by: admin.sub,
        p_knocked_at: new Date().toISOString(),
        p_client_id: null,
      });
      knockRecorded = !!(knockResult as { success?: boolean } | null)?.success;
    }

    await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'created',
      content: 'Added from the map while canvassing',
      created_by: admin.sub,
    });

    // Re-read so the caller gets the state the knock RPC left behind rather
    // than the pre-knock row.
    const { data: fresh } = await supabase.from('leads').select('*').eq('id', lead.id).single();

    return NextResponse.json({ success: true, lead: fresh ?? lead, knockRecorded });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
