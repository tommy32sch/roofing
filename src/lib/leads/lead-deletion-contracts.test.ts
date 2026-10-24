import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIMITS } from '@/lib/utils/validation';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/035_delete_leads_with_audit.sql');
const helper = read('src/lib/leads/lead-deletion.server.ts');
const singleRoute = read('src/app/api/admin/leads/[leadId]/route.ts');
const bulkRoute = read('src/app/api/admin/leads/bulk-delete/route.ts');
const queuePage = read('src/app/admin/(app)/leads/page.tsx');
const detailPage = read('src/app/admin/(app)/leads/[leadId]/lead-detail.tsx');
const dialog = read('src/components/leads/BulkDeleteDialog.tsx');
const leadsListRoute = read('src/app/api/admin/leads/route.ts');
const mapPage = read('src/app/admin/(app)/map/page.tsx');

describe('lead deletion contracts', () => {
  it('records and deletes in one locked database transaction', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.delete_leads_with_audit(');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('INSERT INTO lead_deletions');
    expect(migration).toContain('DELETE FROM leads WHERE id = ANY(p_lead_ids)');
    expect(migration).toContain("RAISE EXCEPTION 'Lead deletion did not match its audit records'");
  });

  it('keeps the function behind the service role and an admin actor', () => {
    expect(migration).toContain("IF auth.role() IS DISTINCT FROM 'service_role' THEN");
    expect(migration).toContain("IF v_actor_role IS DISTINCT FROM 'admin' THEN");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.delete_leads_with_audit[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_leads_with_audit[\s\S]*TO service_role/);
  });

  it('caps the database and the API at the same size', () => {
    expect(migration).toContain(`v_requested > ${LIMITS.BULK_DELETE_MAX}`);
    expect(bulkRoute).toContain('LIMITS.BULK_DELETE_MAX');
  });

  // A second way to delete would be a second place to forget the audit record.
  it('routes single and bulk deletion through the one helper', () => {
    expect(helper).toContain("supabase.rpc('delete_leads_with_audit'");
    for (const route of [singleRoute, bulkRoute]) {
      expect(route).toContain('deleteLeadsWithAudit(');
      expect(route).not.toMatch(/\.from\('leads'\)\s*\.delete\(/);
      expect(route).not.toContain(".from('lead_deletions')");
    }
  });

  it('removes deleted photo files only after a real delete', () => {
    expect(helper).toContain('dryRun ? [] : photoPathsToRemove(');
    expect(helper).toContain('.from(PHOTO_BUCKET)');
  });

  it('gates both delete handlers on the admin role', () => {
    const singleDelete = singleRoute.slice(singleRoute.indexOf('export async function DELETE'));
    expect(singleDelete).toContain("admin.role !== 'admin'");
    expect(bulkRoute).toContain("admin.role !== 'admin'");
  });

  it('offers bulk delete only in the admin selection bar, behind a typed count', () => {
    const bar = queuePage.slice(queuePage.indexOf('{isAdmin && selection.size > 0 && ('));
    expect(bar.slice(0, bar.indexOf('{isAdmin && (\n'))).toContain('onClick={() => setDeleteOpen(true)}');
    expect(queuePage).toContain('disabled={selection.size > LIMITS.BULK_DELETE_MAX}');
    expect(dialog).toContain('bulkDeleteConfirmed(typed, count)');
    expect(dialog).toContain('dry_run: true');
  });

  it('offers bulk delete in the map selection bar, admin-only', () => {
    const bar = mapPage.slice(mapPage.indexOf('aria-label="Map selection actions"'));
    expect(mapPage).toContain('{isAdmin && !execution.active && selection.size > 0 && (');
    expect(bar.slice(0, bar.indexOf('</div>'))).toContain('onClick={() => setDeleteOpen(true)}');
    expect(mapPage).toContain('disabled={selection.size > LIMITS.BULK_DELETE_MAX}');
    expect(mapPage).toContain('{isAdmin && deleteOpen && (');
  });

  it('labels the single delete and reports a failed one', () => {
    expect(detailPage).toMatch(/<Trash2 \/>\s*Delete lead/);
    expect(detailPage).toContain("toast.error(data.error || 'Failed to delete lead')");
  });

  // Deleting the last page's leads leaves the queue on a page past the end.
  it('answers a page past the end with the real total, and the queue steps back', () => {
    expect(leadsListRoute).toContain("if (error?.code === 'PGRST103') {");
    expect(leadsListRoute).toContain("filteredLeads('id', { count: 'exact', head: true })");
    expect(queuePage).toContain('leadPageToStepBackTo(listView, page, pageLeads.length, data.totalPages)');
  });
});
