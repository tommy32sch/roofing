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

const FILTERED_ROUTES = [
  'src/app/api/admin/leads/route.ts',
  'src/app/api/admin/leads/geo/route.ts',
  'src/app/api/admin/stats/route.ts',
  'src/app/api/admin/activity/route.ts',
  'src/app/api/admin/contact-activity/route.ts',
  'src/app/api/admin/appointments/route.ts',
  'src/app/api/admin/performance/route.ts',
  'src/app/api/admin/today/route.ts',
  'src/lib/territories/execution.server.ts',
] as const;

describe('lead visibility route contracts', () => {
  it.each(CHILD_ROUTES)('%s authorizes the parent lead in every handler', (path, handlers) => {
    const source = read(path);
    expect(source.match(/export async function (GET|POST|DELETE)/g) ?? []).toHaveLength(handlers);
    expect(source.match(/authorizeLeadAccess\(/g) ?? []).toHaveLength(handlers);
  });

  it.each(FILTERED_ROUTES)('%s uses the shared assignment filter', (path) => {
    expect(read(path)).toContain('applyLeadAccessFilter');
  });

  it('protects lead detail reads, updates, and appointment writes', () => {
    const detail = read('src/app/api/admin/leads/[leadId]/route.ts');
    const appointments = read('src/app/api/admin/leads/[leadId]/appointments/route.ts');
    const appointment = read(
      'src/app/api/admin/leads/[leadId]/appointments/[appointmentId]/route.ts'
    );

    expect(detail.match(/authorizeLeadAccess\(/g) ?? []).toHaveLength(2);
    expect(appointments).toContain('authorizeLeadAccess(');
    expect(appointment).toContain('authorizeLeadAccess(');
  });

  it('lets a setter hand a booked appointment to a closer without exposing emails', () => {
    const fields = read('src/lib/leads/lead-fields.ts');
    const team = read('src/app/api/admin/team/route.ts');
    const booking = read('src/components/leads/AppointmentModal.tsx');

    expect(fields).toContain("LEAD_SETTER_HANDOFF_FIELDS = new Set(['assigned_closer_id'])");
    expect(team).toContain(".select('id, name, role')");
    expect(team).not.toMatch(/\.select\([^)]*email/);
    expect(booking).toContain('assigned_closer_id: closerId');
  });

  it('auto-assigns every rep-created lead through one helper', () => {
    for (const path of [
      'src/app/api/admin/leads/route.ts',
      'src/app/api/admin/import/route.ts',
      'src/app/api/admin/leads/walk-up/route.ts',
    ]) {
      expect(read(path), path).toContain('assignmentForNewLead(');
    }
  });

  it('does not reintroduce status-only closer authorization', () => {
    for (const path of FILTERED_ROUTES) {
      expect(read(path), path).not.toContain('CLOSER_STATUSES');
    }
  });

  it('scopes appointment conflicts and reminder recipients to current assignments', () => {
    const guard = read('src/lib/leads/appointment-guard.ts');
    const reminders = read('src/lib/appointments/reminder-service.ts');

    expect(guard).toContain("applyLeadAccessFilter(query, opts.actor, { foreignTable: 'leads' })");
    expect(reminders).toContain('[lead.assigned_setter_id, lead.assigned_closer_id]');
    expect(reminders).not.toContain('[lead.assigned_to, appointment.created_by]');
  });

  it('keeps hidden nearby-lead details generic and does not revive denied offline data', () => {
    const resolve = read('src/app/api/admin/leads/walk-up/resolve/route.ts');
    const addHouse = read('src/components/leads/AddHouseSheet.tsx');
    const execution = read('src/lib/territories/use-territory-execution.ts');

    expect(resolve).toContain('canAccessLead(actor, lead)');
    expect(resolve).toContain('hiddenNearbyCount');
    expect(addHouse).toContain('assigned to another account is near this point');
    expect(execution).toContain('if (serverResponded)');
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
