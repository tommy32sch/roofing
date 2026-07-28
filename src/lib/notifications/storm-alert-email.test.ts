import { describe, expect, it } from 'vitest';
import { buildStormAlertEmail } from './storm-alert-email';

const input = {
  marketId: 2,
  recipientName: 'Taylor',
  marketName: 'Minnesota',
  type: 'hail' as const,
  occurredOn: '2026-07-27',
  peakValue: 1.5,
  reportCount: 4,
  closestDistanceMiles: 8.234,
  centroidLat: 44.98,
  centroidLon: -93.27,
  severityBand: 2,
  kind: 'initial' as const,
  appUrl: 'https://roofing.example/',
};

describe('buildStormAlertEmail', () => {
  it('labels the source as preliminary and never presents it as a warning', () => {
    const built = buildStormAlertEmail(input);
    expect(built.text).toContain('preliminary NOAA');
    expect(built.text).toContain('not a forecast, warning, or real-time radar detection');
    expect(built.subject).toContain('1.50” hail');
  });

  it('deep-links to the market, layer, seven-day window, and event center', () => {
    const built = buildStormAlertEmail(input);
    expect(built.text).toContain(
      '/admin/map?market_id=2&storm=hail&days=7&lat=44.98&lng=-93.27&zoom=12'
    );
  });

  it('escapes names in HTML and marks escalation in the subject', () => {
    const built = buildStormAlertEmail({
      ...input,
      recipientName: '<Taylor>',
      marketName: 'A&B',
      kind: 'escalation',
    });
    expect(built.html).not.toContain('<Taylor>');
    expect(built.html).toContain('&lt;Taylor&gt;');
    expect(built.html).toContain('A&amp;B');
    expect(built.subject).toMatch(/^Severity increased/);
  });

  it('describes unmeasured wind without inventing a speed', () => {
    const built = buildStormAlertEmail({ ...input, type: 'wind', peakValue: null });
    expect(built.text).toContain('speed unmeasured');
    expect(built.text).not.toContain('null mph');
  });
});
