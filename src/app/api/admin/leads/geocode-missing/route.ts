import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { geocodeAddress } from '@/lib/integrations/geocode';

// Nominatim allows ~1 request/second, and serverless functions have a short
// timeout — so geocode a small batch per call and let the client loop through
// them. Keyset pagination by id ensures each lead is attempted once (bad
// addresses aren't retried forever within a run).
export const maxDuration = 60;
// Nominatim requests take ~1.2s each; keep the batch small so a single call
// finishes well under a 10s serverless cap even on the smallest plan. The
// client loops across batches, so throughput is unaffected.
const BATCH = 3;
const DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const after = typeof body?.after === 'string' ? body.after : null;

    const supabase = db();

    let query = supabase
      .from('leads')
      .select('id, address_street, address_city, address_state, address_zip')
      .is('latitude', null)
      .not('address_street', 'is', null)
      // A street with no city/zip can't be geocoded reliably — skip it
      .or('address_city.not.is.null,address_zip.not.is.null')
      .order('id', { ascending: true })
      .limit(BATCH);
    if (after) query = query.gt('id', after);

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const batch = rows || [];
    let geocoded = 0;

    for (let i = 0; i < batch.length; i++) {
      const lead = batch[i];
      const result = await geocodeAddress(
        lead.address_street!.trim(),
        lead.address_city,
        lead.address_state,
        lead.address_zip
      );
      if (result) {
        const { error: upErr } = await supabase
          .from('leads')
          .update({ latitude: result.latitude, longitude: result.longitude })
          .eq('id', lead.id)
          .is('latitude', null);
        if (!upErr) geocoded++;
      }
      if (i < batch.length - 1) await sleep(DELAY_MS);
    }

    const nextCursor = batch.length > 0 ? batch[batch.length - 1].id : after;
    const done = batch.length < BATCH;

    // Total still missing coordinates (for the banner)
    const { count: remaining } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .is('latitude', null)
      .not('address_street', 'is', null);

    return NextResponse.json({
      success: true,
      geocoded,
      processed: batch.length,
      done,
      nextCursor,
      remaining: remaining ?? 0,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
