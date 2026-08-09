import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(process.cwd(), 'src/components/leads/LeadMap.tsx'),
  'utf8'
);
const pageSource = readFileSync(
  join(process.cwd(), 'src/app/admin/(app)/map/page.tsx'),
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

  it('draws swaths and area fills before storm points and lead pins', () => {
    const zoneIndex = source.indexOf('{visibleStormZones.map');
    const territoryIndex = source.indexOf('{territories.map');
    const stormIndex = source.indexOf('{visibleStormReports.map');
    const leadIndex = source.indexOf('{leads.map');

    expect(zoneIndex).toBeGreaterThan(-1);
    expect(territoryIndex).toBeGreaterThan(zoneIndex);
    expect(territoryIndex).toBeGreaterThan(-1);
    expect(stormIndex).toBeGreaterThan(territoryIndex);
    expect(leadIndex).toBeGreaterThan(stormIndex);
  });

  it('keeps every storm point visible when the swath overlay is enabled', () => {
    expect(source).not.toContain('!stormZones && sortStormsForDrawing');
    expect(source).not.toContain('strays.map');
    expect(pageSource).toContain('Overlay each storm swath beneath its individual report dots');
  });

  it('switches lead dots to a house-number-safe treatment after zooming in', () => {
    const leadBlock = source.slice(
      source.indexOf('{leads.map'),
      source.indexOf('{onDrawPoint && onDrawPath')
    );

    expect(source).toContain("map.on('zoomend', report)");
    expect(source).toContain("map.off('zoomend', report)");
    expect(leadBlock).toContain('leadMarkerAppearance({');
    expect(leadBlock).toContain('addressDetail,');
    expect(leadBlock).toContain('radius={marker.radius}');
    expect(leadBlock).toContain('fillOpacity: marker.fillOpacity');
    expect(leadBlock).toContain('color: marker.strokeColor');
  });

  it('binds storm hover and click details to Leaflet information panes', () => {
    const stormBlock = source.slice(
      source.indexOf('{visibleStormReports.map'),
      source.indexOf('{leads.map')
    );

    expect(stormBlock).toContain('<Tooltip');
    expect(stormBlock).toContain('<Popup');
    expect(stormBlock).toContain('pane="tooltipPane"');
    expect(stormBlock).toContain('pane="popupPane"');
    expect(stormBlock).toContain('{stormLabel(r.type, r.value)}');
    expect(stormBlock).toContain('{r.date}');
  });

  it('keeps swath labels and popups above every vector mark without another canvas', () => {
    const zoneBlock = source.slice(
      source.indexOf('{visibleStormZones.map'),
      source.indexOf('{territories.map')
    );

    expect(zoneBlock).toContain('pane="tooltipPane"');
    expect(zoneBlock).toContain('pane="popupPane"');
    expect(source.match(/<Pane name=/g)).toHaveLength(1);
  });

  it('keeps report severity and both active age encodings in the combined legend', () => {
    expect(pageSource).toContain('Report severity');
    expect(pageSource).toContain('Report age');
    expect(pageSource).toContain('Swath age');
    expect(pageSource).not.toContain('!stormZones &&\n              stormLegendEntries');
  });
});
