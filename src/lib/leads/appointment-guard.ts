import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findConflicts,
  conflictWindow,
  type AppointmentConflict,
} from './appointment-conflicts';
import { applyLeadAccessFilter, type LeadActor } from './lead-visibility';

/**
 * Server-side double-booking check, shared by every path that sets a time.
 *
 * Three routes write an appointment time — creating one from the Appointments
 * card, capturing one while moving a lead to "appointment set", and
 * rescheduling. A guard on only the UI, or on only one route, is not a guard:
 * two people booking the same slot seconds apart would both pass a client check.
 *
 * Scoped to the lead's MARKET, since Arizona and Minnesota are separate crews in
 * separate timezones.
 */
export async function findAppointmentConflicts(
  supabase: SupabaseClient,
  opts: {
    actor: LeadActor;
    leadId: string;
    scheduledAt: string;
    excludeAppointmentId?: string | null;
  }
): Promise<AppointmentConflict[]> {
  const window = conflictWindow(opts.scheduledAt);
  if (!window) return [];

  // Which office this booking belongs to. A lead with no market is only
  // compared against other unassigned leads, which is the honest match.
  const { data: lead } = await supabase
    .from('leads')
    .select('market_id')
    .eq('id', opts.leadId)
    .single();
  const marketId = (lead as { market_id?: number | null } | null)?.market_id ?? null;

  // Inner join: filtering on the embedded lead without it would null the embed
  // and keep the parent row, so every appointment in the window would look like
  // a same-market clash.
  let query = supabase
    .from('lead_appointments')
    .select('id, scheduled_at, appointment_type, leads!lead_id!inner(first_name, last_name, market_id, assigned_setter_id, assigned_closer_id)')
    // A recorded cancellation keeps its row for reporting, but it no longer
    // occupies the crew's time slot.
    .eq('outcome', 'scheduled')
    .gte('scheduled_at', window.start)
    .lte('scheduled_at', window.end);

  query = marketId == null
    ? query.is('leads.market_id', null)
    : query.eq('leads.market_id', marketId);
  query = applyLeadAccessFilter(query, opts.actor, { foreignTable: 'leads' });

  const { data, error } = await query;
  if (error || !data) return [];

  type Row = {
    id: string;
    scheduled_at: string;
    appointment_type: string | null;
    leads: { first_name: string | null; last_name: string | null } | null;
  };

  return findConflicts(opts.scheduledAt, data as unknown as Row[], {
    excludeId: opts.excludeAppointmentId ?? null,
  });
}

/** Shape returned to the client when a booking is refused for clashing. */
export function conflictResponseBody(conflicts: AppointmentConflict[]) {
  return {
    success: false as const,
    error: 'appointment_conflict',
    conflicts,
  };
}
