import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_BUCKET } from './photos';
import {
  parseDeletionReceipt,
  photoPathsToRemove,
  type LeadDeletionReceipt,
} from './lead-deletion';

// Storage takes a list of paths per request; keep each request small.
const STORAGE_REMOVE_CHUNK = 100;

export type LeadDeletionResult =
  | { ok: true; receipt: LeadDeletionReceipt; photoCleanupFailed: boolean }
  | { ok: false; error: string };

/**
 * The one way leads are deleted, for one lead or many.
 *
 * The audit snapshot, the destroyed-record counts and the delete itself run in
 * one database transaction (delete_leads_with_audit, migration 035). With
 * `dryRun` nothing is written and the receipt says what a real run would
 * destroy.
 *
 * Photo files live in Storage, outside that transaction, so they are removed
 * after the commit. A failure there does not undo the delete — the leads are
 * already gone — but it is reported so the caller can say so.
 */
export async function deleteLeadsWithAudit(
  supabase: SupabaseClient,
  actorId: string,
  leadIds: string[],
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<LeadDeletionResult> {
  const { data, error } = await supabase.rpc('delete_leads_with_audit', {
    p_actor_id: actorId,
    p_lead_ids: leadIds,
    p_dry_run: dryRun,
  });
  if (error) return { ok: false, error: error.message };

  const receipt = parseDeletionReceipt(data, { requested: leadIds.length, dryRun });
  if (!receipt) {
    return { ok: false, error: 'Lead deletion did not return a complete audit receipt' };
  }

  let photoCleanupFailed = false;
  const paths = dryRun ? [] : photoPathsToRemove(receipt.photoPaths, leadIds);
  for (let i = 0; i < paths.length; i += STORAGE_REMOVE_CHUNK) {
    const { error: storageError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove(paths.slice(i, i + STORAGE_REMOVE_CHUNK));
    if (storageError) {
      photoCleanupFailed = true;
      console.error('Lead photo cleanup failed after deletion:', storageError.message);
    }
  }

  return { ok: true, receipt, photoCleanupFailed };
}
