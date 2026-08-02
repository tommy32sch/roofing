import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/types';

/**
 * Who may see a lead and every resource beneath it.
 *
 * The server uses a service-role Supabase client, so database RLS cannot infer
 * the signed-in app user. Every route that starts from a lead id must therefore
 * pass through authorizeLeadAccess, while aggregate routes apply the same rule
 * to their database query with applyLeadVisibilityFilter. Keeping those two
 * entry points beside the pure policy prevents child collections and reports
 * from gradually inventing different definitions of a visible lead.
 */

export const CLOSER_VISIBLE_LEAD_STATUS = 'sold' as const;

/**
 * May this role read this lead?
 *
 * Mirrors the lead detail route: only closers are restricted, and only to sold
 * leads. Setters knock every door, so they see everything — deliberate, since
 * knowing who owns a door is what stops two reps knocking it.
 *
 * A null/unknown status fails CLOSED for a closer. A missing status usually
 * means the lead row could not be read, and guessing "probably fine" is the
 * wrong default for an access check.
 */
export function canViewLead(role: UserRole, leadStatus: string | null | undefined): boolean {
  if (role !== 'closer') return true;
  return leadStatus === CLOSER_VISIBLE_LEAD_STATUS;
}

/**
 * Narrow a lead query (or a child query with an embedded lead) to rows the role
 * may see. Admins and setters keep the original query; closers only receive sold
 * leads, matching canViewLead.
 */
export function applyLeadVisibilityFilter<T>(
  query: T,
  role: UserRole,
  statusColumn = 'status'
): T {
  if (role !== 'closer') return query;
  return (query as { eq(column: string, value: string): T }).eq(
    statusColumn,
    CLOSER_VISIBLE_LEAD_STATUS
  );
}

export type LeadAccessDecision =
  | { ok: true; lead: { id: string; status: string | null } }
  | { ok: false; status: 403 | 404 | 500; error: string };

/**
 * Prove that the parent lead exists and is visible before a child route reads or
 * writes anything beneath it. The typed denial is returned directly by routes,
 * so missing, forbidden and database-failure behavior cannot drift per child.
 */
export async function authorizeLeadAccess(
  supabase: SupabaseClient,
  role: UserRole,
  leadId: string
): Promise<LeadAccessDecision> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, status')
    .eq('id', leadId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'Lead not found' };
  if (!canViewLead(role, data.status)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true, lead: { id: data.id, status: data.status } };
}

/** Permanent photo deletion is limited to an admin or the account that uploaded it. */
export function canDeleteLeadPhoto(
  role: UserRole,
  currentUserId: string,
  uploadedBy: string | null | undefined
): boolean {
  return role === 'admin' || (!!uploadedBy && uploadedBy === currentUserId);
}
