import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidUUID } from '@/lib/utils/validation';

/** Who may receive a booked appointment. Admins can close as well as closers. */
export function isAssignableCloserRole(role: unknown): boolean {
  return role === 'closer' || role === 'admin';
}

/**
 * A booking is invisible to closers until a closer is assigned.
 * Keep an existing assignee if the caller did not send a new one.
 */
export function resolveCloserHandoff(
  currentCloserId: string | null | undefined,
  requestedCloserId: unknown
): { ok: true; closerId: string } | { ok: false; error: string } {
  if (typeof requestedCloserId === 'string' && requestedCloserId.trim()) {
    if (!isValidUUID(requestedCloserId)) {
      return { ok: false, error: 'Invalid closer' };
    }
    return { ok: true, closerId: requestedCloserId };
  }
  if (typeof currentCloserId === 'string' && currentCloserId) {
    return { ok: true, closerId: currentCloserId };
  }
  return { ok: false, error: 'A closer is required to book this appointment' };
}

export async function assertAssignableCloser(
  supabase: SupabaseClient,
  closerId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, role')
    .eq('id', closerId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data || !isAssignableCloserRole(data.role)) {
    return { ok: false, error: 'Closer not found' };
  }
  return { ok: true };
}
