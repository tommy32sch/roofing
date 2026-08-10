import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const collection = read('src/app/api/admin/leads/views/route.ts');
const item = read('src/app/api/admin/leads/views/[viewId]/route.ts');
const migration = read('supabase/migrations/030_lead_saved_views.sql');
const backupManifest = read('scripts/lib/backup-manifest.ts');

describe('saved lead view boundaries', () => {
  it('authenticates before reading or writing views', () => {
    expect(collection.indexOf('getAuthenticatedAdmin()')).toBeLessThan(collection.indexOf(".from('lead_saved_views')"));
    expect(item.indexOf('getAuthenticatedAdmin()')).toBeLessThan(item.indexOf(".from('lead_saved_views')"));
  });

  it('scopes every operation to the signed-in owner', () => {
    expect(collection).toContain(".eq('owner_user_id', admin.sub)");
    expect(collection).toContain('savedViewInsert(admin.sub, name, definition)');
    expect(item.match(/\.eq\('owner_user_id', admin\.sub\)/g)).toHaveLength(2);
    expect(item).not.toMatch(/owner_user_id\s*:\s*body/);
  });

  it('validates definitions and maps duplicate names to conflict responses', () => {
    expect(collection).toContain('parseLeadViewDefinition(body.definition)');
    expect(item).toContain('parseLeadViewDefinition(body.definition)');
    expect(collection).toContain("error.code === '23505'");
    expect(item).toContain("error.code === '23505'");
    expect(collection).toContain('status: duplicate ? 409 : 500');
  });

  it('defines versioned, user-owned, backed-up database records', () => {
    expect(migration).toContain('owner_user_id UUID NOT NULL');
    expect(migration).toContain('REFERENCES admin_users(id) ON DELETE CASCADE');
    expect(migration).toContain('definition_version SMALLINT NOT NULL DEFAULT 1');
    expect(migration).toContain("jsonb_typeof(definition) = 'object'");
    expect(migration).toContain('lower(btrim(name))');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('Service role full access');
    expect(backupManifest).toContain("'lead_saved_views'");
  });
});
