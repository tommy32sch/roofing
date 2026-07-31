/**
 * Recording what a lead deletion destroyed.
 *
 * Deleting a lead cascades through activities, knocks, calls, photos and
 * appointments, so afterwards there is nothing left to join to. Anything worth
 * reading later has to be copied out before the delete runs — which is what
 * these helpers build.
 */

export interface DeletedLeadSnapshot {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  status?: string | null;
  deal_value?: number | null;
  market_id?: number | null;
  assigned_setter_id?: string | null;
  assigned_closer_id?: string | null;
  created_at?: string | null;
  created_by?: string | null;
}

export interface DeletionCounts {
  activities?: number;
  knocks?: number;
  calls?: number;
  photos?: number;
  appointments?: number;
}

export interface Deleter {
  sub: string;
  name?: string | null;
  email?: string | null;
  role: string;
}

/**
 * Build the audit row for a lead about to be deleted.
 *
 * The deleter's name is copied rather than referenced so the record still reads
 * correctly after that account is renamed or removed — an audit trail that goes
 * blank when someone leaves is not much of an audit trail.
 */
export function buildLeadDeletionRecord(
  lead: DeletedLeadSnapshot,
  deleter: Deleter,
  counts: DeletionCounts = {}
): Record<string, unknown> {
  return {
    lead_id: lead.id,
    first_name: lead.first_name ?? null,
    last_name: lead.last_name ?? null,
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    address_street: lead.address_street ?? null,
    address_city: lead.address_city ?? null,
    address_state: lead.address_state ?? null,
    address_zip: lead.address_zip ?? null,
    status: lead.status ?? null,
    deal_value: lead.deal_value ?? null,
    market_id: lead.market_id ?? null,
    assigned_setter_id: lead.assigned_setter_id ?? null,
    assigned_closer_id: lead.assigned_closer_id ?? null,
    lead_created_at: lead.created_at ?? null,
    lead_created_by: lead.created_by ?? null,
    deleted_by: deleter.sub,
    deleted_by_name: deleter.name?.trim() || deleter.email || null,
    deleted_by_role: deleter.role,
    activities_destroyed: counts.activities ?? 0,
    knocks_destroyed: counts.knocks ?? 0,
    calls_destroyed: counts.calls ?? 0,
    photos_destroyed: counts.photos ?? 0,
    appointments_destroyed: counts.appointments ?? 0,
  };
}

/** Total child records lost with the lead. */
export function totalDestroyed(counts: DeletionCounts): number {
  return (
    (counts.activities ?? 0) +
    (counts.knocks ?? 0) +
    (counts.calls ?? 0) +
    (counts.photos ?? 0) +
    (counts.appointments ?? 0)
  );
}

/**
 * Whether a deletion is worth a second look.
 *
 * Removing a duplicate nobody ever worked is routine. Removing a lead with
 * knocks, calls or a booked appointment against it destroyed real fieldwork, and
 * that is the one someone should notice in a list.
 */
export function isSignificantDeletion(counts: DeletionCounts): boolean {
  return (counts.knocks ?? 0) > 0 || (counts.calls ?? 0) > 0 || (counts.appointments ?? 0) > 0;
}

/** "Jane Smith" / "1421 E Palm Ln" / falls back so a row is never blank. */
export function deletedLeadLabel(row: {
  first_name?: string | null;
  last_name?: string | null;
  address_street?: string | null;
}): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (row.address_street) return row.address_street;
  return 'Unnamed lead';
}
