import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/types';

/** The signed-in account used by every lead access decision. */
export interface LeadActor {
  id: string;
  role: UserRole;
}

export type LeadDataScope = 'mine' | 'all';

export interface LeadAccessFacts {
  id?: string;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
}

export type LeadScopeDecision =
  | { ok: true; scope: LeadDataScope }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Resolve a requested team scope without trusting the client control. Admins
 * may choose either scope. Setters and closers always remain in "mine".
 */
export function resolveLeadDataScope(
  actor: LeadActor,
  requestedScope: string | null | undefined,
  adminDefault: LeadDataScope = 'all'
): LeadScopeDecision {
  if (requestedScope != null && requestedScope !== 'mine' && requestedScope !== 'all') {
    return { ok: false, status: 400, error: 'Invalid lead scope' };
  }

  if (actor.role === 'admin') {
    return { ok: true, scope: requestedScope ?? adminDefault };
  }

  if (requestedScope === 'all') {
    return { ok: false, status: 403, error: 'Team data is limited to admins' };
  }

  return { ok: true, scope: 'mine' };
}

/** Apply the same assignment rule to direct lead checks. */
export function canAccessLead(
  actor: LeadActor,
  lead: LeadAccessFacts,
  scope: LeadDataScope = actor.role === 'admin' ? 'all' : 'mine'
): boolean {
  if (actor.role === 'admin' && scope === 'all') return true;
  if (actor.role === 'setter') return lead.assigned_setter_id === actor.id;
  if (actor.role === 'closer') return lead.assigned_closer_id === actor.id;
  return lead.assigned_setter_id === actor.id || lead.assigned_closer_id === actor.id;
}

interface LeadFilterQuery<T> {
  eq(column: string, value: string): T;
  or(filters: string, options?: { foreignTable: string }): T;
}

/**
 * Apply the shared assignment rule to a lead query or an embedded lead join.
 * The server uses a service-role client, so every aggregate route must call this
 * helper instead of relying on database RLS.
 */
export function applyLeadAccessFilter<T>(
  query: T,
  actor: LeadActor,
  options: { scope?: LeadDataScope; foreignTable?: string } = {}
): T {
  const scope = options.scope ?? (actor.role === 'admin' ? 'all' : 'mine');
  if (actor.role === 'admin' && scope === 'all') return query;

  const filtered = query as LeadFilterQuery<T>;
  if (actor.role === 'setter') {
    return filtered.eq(
      options.foreignTable ? `${options.foreignTable}.assigned_setter_id` : 'assigned_setter_id',
      actor.id
    );
  }
  if (actor.role === 'closer') {
    return filtered.eq(
      options.foreignTable ? `${options.foreignTable}.assigned_closer_id` : 'assigned_closer_id',
      actor.id
    );
  }

  const assignmentFilter =
    `assigned_setter_id.eq.${actor.id},assigned_closer_id.eq.${actor.id}`;
  return options.foreignTable
    ? filtered.or(assignmentFilter, { foreignTable: options.foreignTable })
    : filtered.or(assignmentFilter);
}

/** Make a rep-created lead visible to that rep without changing admin input. */
export function assignmentForNewLead(
  actor: LeadActor
): Partial<Pick<LeadAccessFacts, 'assigned_setter_id' | 'assigned_closer_id'>> {
  if (actor.role === 'setter') return { assigned_setter_id: actor.id };
  if (actor.role === 'closer') return { assigned_closer_id: actor.id };
  return {};
}

export type LeadAccessDecision =
  | { ok: true; lead: LeadAccessFacts & { id: string } }
  | { ok: false; status: 403 | 404 | 500; error: string };

/**
 * Prove that the parent lead exists and is visible before a child route reads or
 * writes anything beneath it. The typed denial is returned directly by routes,
 * so missing, forbidden and database-failure behavior cannot drift per child.
 */
export async function authorizeLeadAccess(
  supabase: SupabaseClient,
  actor: LeadActor,
  leadId: string
): Promise<LeadAccessDecision> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, assigned_setter_id, assigned_closer_id')
    .eq('id', leadId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'Lead not found' };
  if (!canAccessLead(actor, data)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true, lead: data };
}

/** Permanent photo deletion is limited to an admin or the account that uploaded it. */
export function canDeleteLeadPhoto(
  role: UserRole,
  currentUserId: string,
  uploadedBy: string | null | undefined
): boolean {
  return role === 'admin' || (!!uploadedBy && uploadedBy === currentUserId);
}
