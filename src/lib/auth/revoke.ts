import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Invalidate all of a user's existing sessions by bumping token_version.
 *
 * Every JWT embeds the version it was minted with; getAuthenticatedAdmin rejects
 * any token whose version no longer matches. Incrementing it therefore logs the
 * user out everywhere on their next request, without waiting for the 24h expiry.
 *
 * Read-then-write rather than an atomic SQL expression: this only runs on rare
 * admin actions (revoke / role change / password change), so a lost concurrent
 * increment would at worst require clicking "log out everywhere" again — it can
 * never fail to revoke.
 */
export async function revokeUserSessions(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const { data: current, error: readErr } = await supabase
    .from('admin_users')
    .select('token_version')
    .eq('id', userId)
    .single();

  if (readErr || !current) {
    return { ok: false, error: readErr?.message ?? 'User not found' };
  }

  const next = (current.token_version ?? 0) + 1;
  const { error: writeErr } = await supabase
    .from('admin_users')
    .update({ token_version: next })
    .eq('id', userId);

  if (writeErr) return { ok: false, error: writeErr.message };
  return { ok: true, version: next };
}
