import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Static guard for the assignment feature's wiring.
 *
 * Each of these fails silently if dropped: the column renders "—" forever, or a
 * filter is accepted in the URL and quietly ignored so the operator acts on a
 * set they did not ask for. Neither shows up as an error.
 */
const route = readFileSync(join(process.cwd(), 'src/app/api/admin/leads/route.ts'), 'utf8');
const exportRoute = readFileSync(join(process.cwd(), 'src/app/api/admin/leads/export/route.ts'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src/app/admin/(app)/leads/page.tsx'), 'utf8');
const queueState = readFileSync(join(process.cwd(), 'src/lib/leads/work-queue.ts'), 'utf8');
const queueServer = readFileSync(join(process.cwd(), 'src/lib/leads/work-queue.server.ts'), 'utf8');

describe('lead assignment route contract', () => {
  // Two embeds of admin_users are ambiguous to PostgREST without explicit
  // foreign-key hints, and the whole request fails rather than degrading.
  it('embeds both assignees with explicit foreign keys', () => {
    expect(route).toMatch(/assigned_setter:admin_users!assigned_setter_id\(/);
    expect(route).toMatch(/assigned_closer:admin_users!assigned_closer_id\(/);
  });

  it('applies both ownership filters', () => {
    expect(route).toContain('applyLeadQueueFilters(query, queueParams)');
    expect(queueServer).toMatch(/applyAssigneeFilter\(filtered, 'setter', parseAssigneeFilter\(params\.assigned_setter\)\)/);
    expect(queueServer).toMatch(/applyAssigneeFilter\(filtered, 'closer', parseAssigneeFilter\(params\.assigned_closer\)\)/);
  });

  it('parses them from the request rather than trusting raw input', () => {
    expect(route).toContain('leadQueueRequestParamsFromSearchParams(searchParams)');
    expect(queueServer).toContain("['assigned_setter', 'assigned_closer']");
    expect(queueState).toContain("'assigned_setter'");
    expect(queueState).toContain("'assigned_closer'");
  });
});

describe('lead assignment page contract', () => {
  it('sends both filters when fetching', () => {
    expect(page).toContain('buildLeadQueueSearchParams(queueParams)');
    expect(queueState).toContain("'assigned_setter'");
    expect(queueState).toContain("'assigned_closer'");
  });

  // A CSV that disagrees with the screen is worse than no export.
  it('carries them into the export', () => {
    const exportBlock = page.slice(page.indexOf('function handleExport'));
    expect(exportBlock.slice(0, 400)).toContain('buildLeadQueueSearchParams(queueParams)');
    expect(exportRoute).toContain('applyLeadQueueFilters(query, queueParams)');
  });

  // The selection-scope guard exists because bulk assign has no undo. A filter
  // missing from the key means a selection survives a change it should not.
  it('includes both filters in the selection scope key', () => {
    const scopeCall = page.slice(page.indexOf('leadFilterKey({'), page.indexOf('leadFilterKey({') + 500);
    expect(scopeCall).toMatch(/assignedSetter/);
    expect(scopeCall).toMatch(/assignedCloser/);
  });

  it('refetches when either filter changes', () => {
    expect(page).toMatch(
      /const fetchLeads = useCallback\([\s\S]*?\}, \[queueParams, page, importBatchId\]\);/
    );
  });

  it('offers unassign as its own action, not only a checkbox in the dialog', () => {
    expect(page).toMatch(/setAssignMode\('unassign'\)/);
    expect(page).toMatch(/defaultUnassign=\{assignMode === 'unassign'\}/);
  });
});
