import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const page = read('src/app/admin/(app)/leads/page.tsx');
const toolbar = read('src/components/leads/LeadQueueToolbar.tsx');
const listRoute = read('src/app/api/admin/leads/route.ts');
const exportRoute = read('src/app/api/admin/leads/export/route.ts');
const streetRoute = read('src/app/api/admin/leads/streets/route.ts');
const todayPage = read('src/app/admin/(app)/today/page.tsx');

describe('Leads work queue contracts', () => {
  it('uses one controlled query toolbar and no event-handler debounce cleanup', () => {
    expect(page).toContain('<LeadQueueToolbar');
    expect(page).not.toContain('defaultValue={search}');
    expect(page).not.toMatch(/onChange=\{[\s\S]*?return \(\) => clearTimeout/);
    expect(toolbar).toContain('onCommitRef.current');
    expect(toolbar).toContain('useEffect(() => () =>');
    expect(toolbar).toContain('clearTimeout(timer.current)');
  });

  it('replaces queue history while keeping lead-detail navigation deliberate', () => {
    expect(page).toContain('router.replace(leadQueueHref');
    expect(page).toContain('router.push(`/admin/leads/${lead.id}`)');
    expect(page).not.toContain('router.push(`/admin/leads?');
  });

  it('forwards sort and order to the list route and supports accessible headers', () => {
    expect(page).toContain('buildLeadQueueSearchParams(queueParams)');
    expect(page).toContain('leadListViewFromSearchParams');
    expect(page).toContain('LEAD_PAGE_SIZE');
    expect(page).toContain('aria-sort=');
    expect(page).toContain('nextLeadSort(queueParams');
    expect(listRoute).toContain('leadQueueSort(queueParams)');
    expect(listRoute).toContain('nullsFirst: false');
    expect(listRoute).toContain("query.order('id', { ascending: true })");
  });

  it('makes the existing Today follow-up link affect the server query', () => {
    expect(todayPage).toContain('/admin/leads?sort=follow_up_date&order=asc');
    expect(page).toContain('leadQueueParamsFromSearchParams');
    expect(listRoute).toContain('leadQueueRequestParamsFromSearchParams(searchParams)');
  });

  it('uses the same filter contract for list, export, and street grouping', () => {
    for (const source of [listRoute, exportRoute, streetRoute]) {
      expect(source).toContain('applyLeadQueueFilters');
      expect(source).toContain('leadQueueRequestParamsFromSearchParams');
    }
    expect(exportRoute).toContain('applyMarketFilter');
    expect(streetRoute).toContain('includeSelectedStreets: false');
  });

  it('wires saved views, active chips, and atomic mobile filters', () => {
    expect(toolbar).toContain('<LeadSavedViews');
    expect(toolbar).toContain('aria-label="Active filters"');
    expect(toolbar).toContain('Clear all');
    expect(toolbar).toContain('Apply filters');
    expect(toolbar).toContain('setMobileDraft((current) => patchLeadQueueParams(current, patch))');
  });
});
