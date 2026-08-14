import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('durable Audit Log contracts', () => {
  const migrationPath = 'supabase/migrations/033_audit_operations.sql';

  it('links grouped operations to the per-lead timeline', () => {
    const migration = read(migrationPath);

    expect(migration).toContain('CREATE TABLE audit_operations');
    expect(migration).toMatch(/ADD COLUMN operation_id UUID REFERENCES audit_operations/);
    expect(migration).toContain('idx_lead_activities_operation');
  });

  it('makes a bulk assignment and its audit events one transaction', () => {
    const migration = read(migrationPath);
    const route = read('src/app/api/admin/leads/bulk-assign/route.ts');

    expect(migration).toContain('apply_bulk_assignment_with_audit');
    expect(migration).toContain("IF v_updated <> v_expected THEN");
    expect(migration).toContain("RAISE EXCEPTION 'One or more leads changed before assignment'");
    expect(route).toContain("supabase.rpc(\n      'apply_bulk_assignment_with_audit'");
    expect(route).not.toContain(".from('lead_activities').insert(activityRows)");
    expect(route).not.toContain(".update({ [column]: group.user_id })");
  });

  it('keeps database-only audit functions behind the service role', () => {
    const migration = read(migrationPath);

    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.apply_bulk_assignment_with_audit[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_admin_audit_feed[\s\S]*TO service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_rep_audit_feed[\s\S]*TO service_role/);
  });

  it('groups operations only in the admin feed', () => {
    const migration = read(migrationPath);
    const api = read('src/app/api/admin/activity/route.ts');

    expect(migration).toContain("'operation'::TEXT AS item_kind");
    expect(migration).toContain("'activity'::TEXT AS item_kind");
    expect(migration).toMatch(/list_rep_audit_feed[\s\S]*activity\.created_by = p_actor_id/);
    expect(api).toContain("admin.role === 'admin'");
    expect(api).toContain("'list_admin_audit_feed'");
    expect(api).toContain("'list_rep_audit_feed'");
  });

  it('enforces admin access and office scope on operation receipts', () => {
    const detail = read('src/app/api/admin/activity/[operationId]/route.ts');

    expect(detail).toContain("admin.role !== 'admin'");
    expect(detail).toContain('marketFilterFor(admin.marketId');
    expect(detail).toContain("db().rpc('get_audit_operation_leads'");
  });

  it('keeps all audit filters in the URL and applies mobile filters atomically', () => {
    const page = read('src/app/admin/(app)/activity/page.tsx');

    for (const param of ['market_id', 'type', 'user_id', 'from', 'to', 'q', 'page']) {
      expect(page, param).toContain(param);
    }
    expect(page).toContain('router.replace(');
    expect(page).toContain('applyMobileFilters');
    expect(page).toContain('Apply filters');
    expect(page).toContain("defaultPeriod: AUDIT_DEFAULT_PERIOD");
    expect(page).toContain("AUDIT_DEFAULT_PERIOD: Exclude<ReportPeriod, 'custom'> = 'year'");
    expect(page).toContain('applyDateRange');
    expect(page).toContain("period: 'custom'");
    expect(page).toContain('No events in this range');
  });

  it('shows one expandable receipt while preserving direct lead links', () => {
    const page = read('src/app/admin/(app)/activity/page.tsx');
    const navigation = read('src/components/layout/nav-config.ts');

    expect(page).toContain("item_kind: 'activity' | 'operation'");
    expect(page).toContain('View receipt');
    expect(page).toContain('toggleOperation(item.item_id)');
    expect(page).toContain('`/admin/leads/${detail.lead.id}`');
    expect(navigation).toContain("{ href: '/admin/activity', label: 'Audit Log'");
  });
});
