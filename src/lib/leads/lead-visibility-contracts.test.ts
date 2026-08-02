import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const CHILD_ROUTES = [
  ['src/app/api/admin/leads/[leadId]/activities/route.ts', 2],
  ['src/app/api/admin/leads/[leadId]/knocks/route.ts', 2],
  ['src/app/api/admin/leads/[leadId]/calls/route.ts', 2],
  ['src/app/api/admin/leads/[leadId]/photos/route.ts', 2],
  ['src/app/api/admin/leads/[leadId]/photos/[photoId]/route.ts', 1],
] as const;

describe('lead visibility route contracts', () => {
  it.each(CHILD_ROUTES)('%s authorizes the parent lead in every handler', (path, handlers) => {
    const source = read(path);
    expect(source.match(/export async function (GET|POST|DELETE)/g) ?? []).toHaveLength(handlers);
    expect(source.match(/authorizeLeadAccess\(/g) ?? []).toHaveLength(handlers);
  });

  it('filters both global reporting routes through the shared visibility policy', () => {
    const activity = read('src/app/api/admin/activity/route.ts');
    const stats = read('src/app/api/admin/stats/route.ts');

    expect(activity).toContain('applyLeadVisibilityFilter');
    expect(activity).toContain("'leads.status'");
    expect(stats.match(/applyLeadVisibilityFilter\(/g) ?? []).toHaveLength(2);
  });

  it('keeps reps on their own global activity while admins may choose an account', () => {
    const activity = read('src/app/api/admin/activity/route.ts');
    expect(activity).toContain('resolveContactActivityUser(');
    expect(activity).toContain("query.eq('created_by', user.userId)");
  });

  it('requires uploader ownership before permanent photo deletion', () => {
    const deletion = read('src/app/api/admin/leads/[leadId]/photos/[photoId]/route.ts');
    const listing = read('src/app/api/admin/leads/[leadId]/photos/route.ts');
    const component = read('src/components/leads/LeadPhotos.tsx');

    expect(deletion).toContain(".select('id, storage_path, lead_id, created_by')");
    const ownerGuard = deletion.indexOf('canDeleteLeadPhoto(');
    const storageDelete = deletion.indexOf('.remove([photo.storage_path])');
    expect(ownerGuard).toBeGreaterThan(-1);
    expect(storageDelete).toBeGreaterThan(ownerGuard);
    expect(listing).toContain('can_delete: canDeleteLeadPhoto(');
    expect(component).toContain('photo.can_delete &&');
  });
});
