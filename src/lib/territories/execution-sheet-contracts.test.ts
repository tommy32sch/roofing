import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(
  join(process.cwd(), 'src/components/territories/TerritorySheet.tsx'),
  'utf8'
);

describe('territory execution sheet contracts', () => {
  it('renders the authoritative execution summary without substituting shown map leads', () => {
    expect(sheet).toContain('progressByTerritory: Record<string, TerritoryExecutionSummary>');
    expect(sheet).toContain('progressLoading: boolean');
    expect(sheet).toContain('progress.coverage_percent');
    expect(sheet).toContain('progress.total_leads');
    expect(sheet).toContain('progress.progress.appointment');
    expect(sheet).toContain('progress.progress.follow_up');
    expect(sheet).toContain('progress.progress.contacted');
    expect(sheet).toContain('progress.progress.knocked');
    expect(sheet).toContain('progress.progress.unworked');
    expect(sheet).toContain('progress.revisits.due');
    expect(sheet).toContain('progress.revisits.needs_schedule');
    expect(sheet).toContain('progress.last_field_activity_at');
    expect(sheet).toContain('No field activity yet');
  });

  it('prioritizes stalled territories for admins and owned territories for other users', () => {
    const sort = sheet.slice(
      sheet.indexOf('function sortTerritories('),
      sheet.indexOf('interface TerritorySheetProps')
    );

    expect(sort).toContain('if (isAdmin)');
    expect(sort).toContain("state === 'stalled'");
    expect(sort).toContain('Number(bStalled) - Number(aStalled)');
    expect(sort).toContain('owner_user_id === currentUserId');
    expect(sort).toContain('Number(bOwned) - Number(aOwned)');
  });

  it('keeps ownership visual only and authorizes execution through canExecute', () => {
    const resume = sheet.slice(
      sheet.indexOf('{!archived && canExecute && ('),
      sheet.indexOf('{!archived && onSelectLeads && (')
    );

    expect(sheet).toContain('Yours');
    expect(sheet).toContain('canExecute: boolean');
    expect(sheet).toContain('onResume: (territory: Territory) => void');
    expect(resume).toContain('Resume Work');
    expect(resume).toContain('onResume(territory)');
    expect(resume).not.toContain('ownedByCurrentUser');
  });

  it('shows admin management states and preserves existing management flows', () => {
    expect(sheet).toContain("label: 'Not started'");
    expect(sheet).toContain("label: 'Active'");
    expect(sheet).toContain("label: 'Stalled'");
    expect(sheet).toContain("label: 'Complete'");
    expect(sheet).toContain('isAdmin && !archived && status');
    expect(sheet).toContain('onSelectLeads(territory)');
    expect(sheet).toContain('onEdit(territory)');
    expect(sheet).toContain('onEditBoundary(territory)');
    expect(sheet).toContain('onArchiveChange(territory, !archived)');
  });
});
