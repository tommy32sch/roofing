import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const page = read('src/app/admin/(app)/map/page.tsx');
const map = read('src/components/leads/LeadMap.tsx');
const controls = read('src/components/leads/MapWorkspaceControls.tsx');

describe('map workspace visual contracts', () => {
  it('keeps one stable full-height map canvas and puts desktop commands over it', () => {
    expect(page).toContain('h-[calc(100dvh-');
    expect(page).toContain('data-stable-map-canvas');
    expect(page).toContain('aria-label="Map command dock"');
    expect(page).toContain('xl:flex');

    const canvas = page.slice(
      page.indexOf('data-stable-map-canvas'),
      page.indexOf('<Sheet open={mapToolsOpen}')
    );
    expect(canvas).toContain('<LeadMap');
    expect(canvas).toContain('absolute');
  });

  it('names each workspace mode and separates modes from view layers', () => {
    for (const label of [
      'Browse',
      'Select area',
      'Draw territory',
      'Add house',
      'Execute territory',
      'Filters',
      'Layers',
      'Legend',
    ]) {
      expect(page).toContain(label);
    }
    expect(page).toContain('<MapFiltersPanel');
    expect(page).toContain('<MapLayersPanel');
    expect(page).toContain('<MapLegendPanel');
    expect(controls).toContain('aria-label="Lead status"');
    expect(controls).toContain('aria-label="Lead priority"');
    expect(controls).toContain('Storm reports');
    expect(controls).toContain('Do Not Call · knock only');
  });

  it('keeps immediate phone field actions above a non-shrinking tool sheet', () => {
    expect(page).toContain('aria-label="Mobile map actions"');
    expect(page).toContain('Territories');
    expect(page).toContain('Add house');
    expect(page).toContain('side="bottom"');
    expect(page).toContain('aria-label="Mobile map tools sheet"');
    expect(page).toContain('The map stays in place behind this panel.');

    const canvas = page.slice(
      page.indexOf('data-stable-map-canvas'),
      page.indexOf('<Sheet open={mapToolsOpen}')
    );
    expect(canvas).not.toContain('mapToolsOpen ?');
  });

  it('gives popup contact and navigation actions 44px targets', () => {
    expect(map).toContain('POPUP_ACTION_CLASS');
    expect(map).toContain('min-h-11');
    for (const label of ['Call ', 'Text ', 'Directions to ', 'Open lead for ']) {
      expect(map).toContain(`aria-label={\`${label}`);
    }
  });

  it('blocks only the unsafe popup channel', () => {
    expect(map).toContain('!lead.is_dnc && primaryPhone');
    expect(map).toContain('!lead.do_not_knock');
    expect(map).toContain('disabled={lead.do_not_knock}');
    expect(map).toContain('disabled={lead.is_dnc}');

    const phoneActions = map.slice(
      map.indexOf('aria-label={`Lead actions'),
      map.indexOf('Directions to ')
    );
    expect(phoneActions).toContain('!lead.is_dnc && primaryPhone');
    expect(phoneActions).not.toContain('lead.do_not_knock');
  });

  it('keeps assignment and territory-edit controls admin-only', () => {
    const desktopCommands = page.slice(
      page.indexOf('aria-label="Map command dock"'),
      page.indexOf('aria-label="Desktop map panel dock"')
    );
    expect(desktopCommands).toContain('Territories');
    expect(desktopCommands).toContain('Add house');
    expect(desktopCommands.indexOf('Add house')).toBeLessThan(desktopCommands.indexOf('{isAdmin && ('));
    expect(desktopCommands.slice(desktopCommands.indexOf('{isAdmin && ('))).toContain('Select visible');
    expect(desktopCommands.slice(desktopCommands.indexOf('{isAdmin && ('))).toContain('Draw area');
    expect(desktopCommands.slice(desktopCommands.indexOf('{isAdmin && ('))).toContain('New territory');

    expect(page).toContain('onToggleSelect={isAdmin && !execution.active');
    expect(page).toContain('onSelectTerritoryLeads={');
    expect(page).toContain('isAdmin && !execution.active ? addTerritoryLeadsToSelection');
    expect(page).toContain('onEditTerritory={isAdmin && !execution.active');
    expect(page).toContain('{isAdmin && !execution.active && selection.size > 0 && (');
  });

  it('keeps the bulk selection summary clear of phone safe areas', () => {
    const selectionBar = page.slice(
      page.indexOf('{isAdmin && !execution.active && selection.size > 0 && ('),
      page.indexOf('{isAdmin && (', page.indexOf('{isAdmin && !execution.active && selection.size > 0 && ('))
    );
    expect(selectionBar).toContain('env(safe-area-inset-bottom)');
    expect(selectionBar).toContain('selection.size');
    expect(selectionBar).toContain('selectionTotal.toLocaleString()');
    expect(selectionBar).toContain('LIMITS.BULK_ASSIGN_MAX');
    expect(selectionBar).toContain('Assign');
    expect(selectionBar).toContain('Clear');
    expect(selectionBar).toContain('onClick={clearSelectionAreas}');
  });

  it('clears selected leads and lasso areas whenever a lead-set filter changes', () => {
    expect(page).toContain('function clearSelectionAreas()');
    expect(page).toContain('setSelection(new Map())');
    expect(page).toContain('setLassoAreas([])');

    for (const [handler, nextHandler] of [
      ['handleMarketChange', 'handleStatusChange'],
      ['handleStatusChange', 'handlePriorityChange'],
      ['handlePriorityChange', 'const selectionTotal'],
    ]) {
      const filterChange = page.slice(
        page.indexOf(`function ${handler}`),
        page.indexOf(nextHandler, page.indexOf(`function ${handler}`))
      );
      expect(filterChange).toContain('clearSelectionAreas()');
    }
    expect(page).toContain('onMarketChange={handleMarketChange}');
    expect(page).toContain('onStatusChange={handleStatusChange}');
    expect(page).toContain('onPriorityChange={handlePriorityChange}');
  });

  it('removes browse controls and storm layers during territory execution', () => {
    expect(page).toContain('stormReports={execution.active ? [] : stormReports}');
    expect(page).toContain('stormZones={!execution.active && stormZones}');
    expect(page).toContain('drawing={!execution.active && drawing}');
    expect(page).toContain('{!execution.active && !drawing && !addingHouse && (');
    expect(page).toContain('{execution.active && execution.summary && (');
  });
});
