/**
 * Recording what a lead deletion destroyed.
 *
 * Deleting a lead cascades through activities, knocks, calls, photos and
 * appointments, so afterwards there is nothing left to join to. Anything worth
 * reading later has to be copied out before the delete runs. The database does
 * that copy in the same transaction as the delete (migration 035); these
 * helpers validate what goes in and read what comes back.
 */

import { isValidUUID } from '@/lib/utils/validation';
import { pathBelongsToLead } from './photos';

export interface DeletionCounts {
  activities?: number;
  knocks?: number;
  calls?: number;
  photos?: number;
  appointments?: number;
}

/**
 * What delete_leads_with_audit (migration 035) reports back.
 *
 * The snapshot itself is built in the database, inside the same transaction as
 * the delete. These fields are the receipt the API and the confirmation dialog
 * read.
 */
export interface LeadDeletionReceipt {
  dryRun: boolean;
  requested: number;
  found: number;
  deleted: number;
  worked: number;
  destroyed: Required<DeletionCounts>;
  photoPaths: string[];
}

export type LeadIdListResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

/** Validate and de-duplicate a client-supplied list of lead IDs. */
export function parseLeadIdList(value: unknown, max: number): LeadIdListResult {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !isValidUUID(id))) {
    return { ok: false, error: 'Invalid lead_ids' };
  }
  const ids = [...new Set(value as string[])];
  if (ids.length === 0 || ids.length > max) {
    return { ok: false, error: `lead_ids must contain 1-${max} leads` };
  }
  return { ok: true, ids };
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Read the RPC result, or return null if it is not a complete receipt.
 *
 * A receipt that does not add up is treated as a failure: the caller must not
 * tell the operator "deleted" on the strength of a result it cannot account for.
 */
export function parseDeletionReceipt(
  data: unknown,
  expected: { requested: number; dryRun: boolean }
): LeadDeletionReceipt | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  const counts = [
    'requested_count', 'found_count', 'deleted_count', 'worked_count',
    'activities', 'knocks', 'calls', 'photos', 'appointments',
  ];
  if (!counts.every((key) => isCount(r[key]))) return null;
  if (r.dry_run !== expected.dryRun || r.requested_count !== expected.requested) return null;

  const found = r.found_count as number;
  const deleted = r.deleted_count as number;
  if (found > expected.requested) return null;
  if (expected.dryRun ? deleted !== 0 : deleted !== found) return null;
  if ((r.worked_count as number) > found) return null;

  const paths = r.photo_paths;
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) return null;

  return {
    dryRun: expected.dryRun,
    requested: expected.requested,
    found,
    deleted,
    worked: r.worked_count as number,
    destroyed: {
      activities: r.activities as number,
      knocks: r.knocks as number,
      calls: r.calls as number,
      photos: r.photos as number,
      appointments: r.appointments as number,
    },
    photoPaths: paths as string[],
  };
}

/** A bulk delete is confirmed by typing the number of selected leads. */
export function bulkDeleteConfirmed(typed: string, count: number): boolean {
  return count > 0 && typed.trim() === String(count);
}

/**
 * The Storage objects to remove after a delete commits.
 *
 * Only paths inside a deleted lead's own folder qualify, so a bad row can never
 * point the cleanup at another lead's photos or outside the bucket layout.
 */
export function photoPathsToRemove(paths: string[], deletedLeadIds: string[]): string[] {
  const ids = new Set(deletedLeadIds);
  return paths.filter((path) => {
    const leadId = path.split('/')[0];
    return ids.has(leadId) && pathBelongsToLead(path, leadId);
  });
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * "14 knocks, 2 calls, 1 appointment" — the fieldwork a deletion destroys, for
 * the confirmation text. Empty when there is none.
 */
export function describeFieldwork(counts: DeletionCounts): string {
  return [
    counts.knocks ? plural(counts.knocks, 'knock') : null,
    counts.calls ? plural(counts.calls, 'call') : null,
    counts.appointments ? plural(counts.appointments, 'appointment') : null,
    counts.photos ? plural(counts.photos, 'photo') : null,
  ].filter(Boolean).join(', ');
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
