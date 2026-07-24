import { db } from '@/lib/supabase/server';
import { resolveMarketFilter } from './markets';

/**
 * The market a request should be scoped to: the explicit `market_id` parameter
 * when the caller sends one, otherwise their home office.
 *
 * Fails soft on purpose. Migrations on this project are applied by hand in the
 * Supabase dashboard, so there is a window where this code is deployed and the
 * `market_id` column does not exist yet. In that window the lookup yields null,
 * which means "no market filter" — the app behaves exactly as it did before
 * instead of hiding every lead.
 *
 * This is also why the home market is NOT read inside getAuthenticatedAdmin,
 * where it would be one query cheaper: a failed lookup there fails closed and
 * would log every user out until the migration was applied.
 */
export async function marketFilterFor(
  userId: string,
  param: string | null
): Promise<number | null> {
  let home: number | null = null;
  try {
    const { data } = await db()
      .from('admin_users')
      .select('market_id')
      .eq('id', userId)
      .single();
    home = (data as { market_id?: number | null } | null)?.market_id ?? null;
  } catch {
    home = null;
  }
  return resolveMarketFilter(param, home);
}
