/**
 * Backfill `estimated_roof_value` for existing leads.
 *
 * Run once after applying migration 008:
 *   npx tsx --env-file=.env.local scripts/backfill-roof-value.ts
 *
 * Recomputes the estimate for every lead that has square footage, using the
 * admin-configured base price per square (or the built-in default if unset).
 * Idempotent — safe to re-run.
 */

import { createClient } from '@supabase/supabase-js';
import { estimateRoofValue } from '../src/lib/leads/roof-value';
import { assertSafeTarget } from './lib/guard';

async function backfill() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);


  assertSafeTarget({ action: 'backfill estimated roof value onto leads' });

  const { data: settings } = await supabase
    .from('app_settings')
    .select('roof_price_per_square')
    .eq('id', 'default')
    .single();
  const basePricePerSquare: number | null = settings?.roof_price_per_square ?? null;
  console.log(`Base price per square: $${basePricePerSquare ?? '(default)'}`);

  const pageSize = 1000;
  let from = 0;
  let updated = 0;
  let skipped = 0;

  for (;;) {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, sqft, stories, roof_type')
      .not('sqft', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Error fetching leads:', error.message);
      process.exit(1);
    }
    if (!leads || leads.length === 0) break;

    for (const lead of leads) {
      const estimate = estimateRoofValue(
        { sqft: lead.sqft, stories: lead.stories, roof_type: lead.roof_type },
        { basePricePerSquare }
      );
      if (!estimate) {
        skipped++;
        continue;
      }
      const { error: updateError } = await supabase
        .from('leads')
        .update({ estimated_roof_value: estimate.value })
        .eq('id', lead.id);
      if (updateError) {
        console.error(`Failed to update lead ${lead.id}:`, updateError.message);
        skipped++;
      } else {
        updated++;
      }
    }

    if (leads.length < pageSize) break;
    from += pageSize;
  }

  console.log(`\nDone. Updated ${updated} lead(s), skipped ${skipped}.`);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
