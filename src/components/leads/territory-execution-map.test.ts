import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const map = readFileSync(join(process.cwd(), 'src/components/leads/LeadMap.tsx'), 'utf8');
const panel = readFileSync(
  join(process.cwd(), 'src/components/territories/TerritoryExecutionPanel.tsx'),
  'utf8'
);
const nextConfig = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

describe('territory execution map UI contracts', () => {
  it('keeps execution and location marks in the existing shared canvas pane', () => {
    expect(map.match(/<Pane name=/g)).toHaveLength(1);
    expect(map).toContain('activeLeadId?: string | null');
    expect(map).toContain('revisitDueIds?: ReadonlySet<string>');
    expect(map).toContain('userLocation?: TerritoryUserLocation | null');

    const paneStart = map.indexOf('<Pane name="map-data"');
    const location = map.indexOf('{userLocation && (');
    const paneEnd = map.indexOf('</Pane>', paneStart);
    expect(location).toBeGreaterThan(paneStart);
    expect(location).toBeLessThan(paneEnd);
  });

  it('draws non-interactive execution halos beneath the original safety stroke', () => {
    const haloStart = map.indexOf('{/* Execution emphasis');
    const haloMap = map.indexOf('{leads.map((lead) => {', haloStart);
    const leadMap = map.indexOf('{leads.map((lead) => {', haloMap + 1);
    const haloBlock = map.slice(haloStart, leadMap);
    const leadBlock = map.slice(
      leadMap,
      map.indexOf('{/* The active draft')
    );

    expect(haloBlock).toContain('interactive={false}');
    expect(haloBlock).toContain("color: '#f59e0b'");
    expect(haloBlock).toContain("color: '#f97316'");
    expect(leadBlock).toContain('color: marker.strokeColor');
    expect(leadBlock).toContain('weight: marker.strokeWeight');
  });

  it('exposes compact one-tap field controls and every progress bucket', () => {
    expect(panel).toContain('onFindNearest');
    expect(panel).toContain('onSelectLead');
    expect(panel).toContain('onRecordKnock');
    expect(panel).toContain('onExit');
    expect(panel).toContain('KNOCK_DISPOSITIONS.map');
    expect(panel).toContain('pendingOfflineCount');
    expect(panel).toContain('locationError');
    for (const bucket of ['appointment', 'follow_up', 'contacted', 'knocked', 'unworked']) {
      expect(panel).toContain(`['${bucket}',`);
    }
  });

  it('allows first-party geolocation while continuing to block other origins', () => {
    expect(nextConfig).toContain('geolocation=(self)');
    expect(nextConfig).not.toContain('geolocation=()');
  });
});
