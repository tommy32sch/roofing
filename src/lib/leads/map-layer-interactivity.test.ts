import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'src/components/leads/LeadMap.tsx'),
  'utf8'
);

describe('map canvas layer interactivity', () => {
  it('keeps overlapping interactive vectors on one canvas renderer', () => {
    expect(source).toContain('preferCanvas');
    expect(source.match(/<Pane name="map-data"/g)).toHaveLength(1);
    expect(source).not.toContain('<Pane name="storm-data"');
    expect(source).not.toContain('<Pane name="saved-territories"');
    expect(source).not.toContain('<Pane name="lead-pins"');
    expect(source).not.toContain('<Pane name="territory-draft"');
  });

  it('draws area fills before storm points and lead pins', () => {
    const territoryIndex = source.indexOf('{territories.map');
    const stormIndex = source.indexOf('{!stormZones && sortStormsForDrawing');
    const leadIndex = source.indexOf('{leads.map');

    expect(territoryIndex).toBeGreaterThan(-1);
    expect(stormIndex).toBeGreaterThan(territoryIndex);
    expect(leadIndex).toBeGreaterThan(stormIndex);
  });

  it('binds both hover and click details to storm points', () => {
    const stormBlock = source.slice(
      source.indexOf('{!stormZones && sortStormsForDrawing'),
      source.indexOf('{leads.map')
    );

    expect(stormBlock).toContain('<Tooltip');
    expect(stormBlock).toContain('<Popup>');
    expect(stormBlock).toContain('{stormLabel(r.type, r.value)}');
    expect(stormBlock).toContain('{r.date}');
  });
});
