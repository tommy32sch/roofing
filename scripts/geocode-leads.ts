/**
 * Geocode leads that have a street address but no coordinates.
 *
 * Run after bulk imports (or once after enabling the map):
 *   npx tsx --env-file=.env.local scripts/geocode-leads.ts
 *
 * Uses the free OSM Nominatim service, throttled to ~1 request/second per its
 * usage policy. Only fills null coordinates — never overwrites existing ones —
 * so it is idempotent and safe to re-run; failures are logged and retried on
 * the next run.
 */

import { createClient } from '@supabase/supabase-js';
import { geocodeAddress } from '../src/lib/integrations/geocode';
import { assertSafeTarget } from './lib/guard';

const DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geocodeLeads() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);


  assertSafeTarget({ action: 'backfill coordinates onto leads' });

  // Default region fallback (fills leads that lack their own city/state)
  const { data: settings } = await supabase
    .from('app_settings')
    .select('default_geo_city, default_geo_state')
    .eq('id', 'default')
    .single();
  const defCity: string | null = settings?.default_geo_city?.trim() || null;
  const defState: string | null = settings?.default_geo_state?.trim() || null;
  if (defCity || defState) console.log(`Default region: ${[defCity, defState].filter(Boolean).join(', ')}`);

  let leadsQuery = supabase
    .from('leads')
    .select('id, address_street, address_city, address_state, address_zip')
    .is('latitude', null)
    .not('address_street', 'is', null)
    .limit(10000);
  // Without a default region, a street needs its own city/zip to be geocodable.
  if (!defCity) leadsQuery = leadsQuery.or('address_city.not.is.null,address_zip.not.is.null');
  const { data: leads, error } = await leadsQuery;

  if (error) {
    console.error('Error fetching leads:', error.message);
    process.exit(1);
  }
  if (!leads || leads.length === 0) {
    console.log('No leads need geocoding.');
    return;
  }

  console.log(`Geocoding ${leads.length} lead(s) at ~1/sec...`);
  let geocoded = 0;
  let failed = 0;

  for (const lead of leads) {
    const label = [lead.address_street, lead.address_city, lead.address_state]
      .filter(Boolean)
      .join(', ');
    const result = await geocodeAddress(
      lead.address_street!.trim(),
      lead.address_city?.trim() || defCity,
      lead.address_state?.trim() || defState,
      lead.address_zip
    );

    if (result) {
      const { error: updateError } = await supabase
        .from('leads')
        .update({ latitude: result.latitude, longitude: result.longitude })
        .eq('id', lead.id)
        .is('latitude', null);
      if (updateError) {
        console.log(`  ✗ ${label} — db error: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✓ ${label} → ${result.latitude.toFixed(5)}, ${result.longitude.toFixed(5)}`);
        geocoded++;
      }
    } else {
      console.log(`  ✗ ${label} — no match`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. Geocoded ${geocoded}, failed ${failed}.`);
  if (failed > 0) {
    console.log('Failed leads keep null coordinates; fix their addresses and re-run.');
  }
}

geocodeLeads().catch((err) => {
  console.error(err);
  process.exit(1);
});
