import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'src/app/admin/map/page.tsx'), 'utf8');

describe('map territory execution wiring', () => {
  it('loads every canonical progress page independently of map filters', () => {
    expect(page).toContain('/api/admin/territories/progress?');
    expect(page).toContain("limit: '100'");
    expect(page).toContain('while (page <= totalPages)');
    expect(page).toContain('summary.territory_id');

    const request = page.slice(
      page.indexOf('const fetchTerritoryProgress'),
      page.indexOf('useEffect(() => {\n    void fetchTerritoryProgress()')
    );
    expect(request).not.toContain('status');
    expect(request).not.toContain('priority');
  });

  it('switches the map to the exact territory snapshot and execution overlays', () => {
    expect(page).toContain('leads={displayedLeads}');
    expect(page).toContain('territories={displayedTerritories}');
    expect(page).toContain('activeLeadId={execution.currentLead?.id ?? null}');
    expect(page).toContain('revisitDueIds={execution.revisitDueIds}');
    expect(page).toContain('userLocation={execution.location}');
    expect(page).toContain('stormReports={execution.active ? [] : stormReports}');
    expect(page).toContain('focus={displayedFocus}');
  });

  it('connects resume, one-tap results, manual selection, follow-up, and exit', () => {
    expect(page).toContain('<TerritoryExecutionPanel');
    expect(page).toContain('onFindNearest={() => void execution.findNearest()}');
    expect(page).toContain('onSelectLead={execution.selectLead}');
    expect(page).toContain("logLeadResult({ channel: 'knock', disposition }, lead)");
    expect(page).toContain('onFollowUpChange={refreshLeadViews}');
    expect(page).toContain('onExit={exitTerritoryWork}');
    expect(page).toContain('onResume={(territory) => void resumeTerritoryWork(territory)}');
  });

  it('keeps manager progress and offline settlement refreshes authoritative', () => {
    expect(page).toContain('progressByTerritory={territoryProgress}');
    expect(page).toContain('progressLoading={territoryProgressLoading}');
    expect(page).toContain('executionRefreshRef.current();');
    expect(page).toContain('territoryProgressRefreshRef.current();');
  });
});
