import { db } from '@/lib/supabase/server';

/**
 * Read the admin-configured base price per roofing square from app_settings.
 * Returns null when unset (the pure calc then falls back to its default).
 * Server-only — kept out of `roof-value.ts` so that module stays import-safe
 * for client components.
 */
export async function getRoofPricePerSquare(): Promise<number | null> {
  const supabase = db();
  const { data } = await supabase
    .from('app_settings')
    .select('roof_price_per_square')
    .eq('id', 'default')
    .single();

  return data?.roof_price_per_square ?? null;
}
