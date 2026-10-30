import { describe, expect, it } from 'vitest';
import {
  changedFieldLabels,
  publicSettingsFromRow,
  roofPriceUnchanged,
  settingsPatchFromBody,
} from './public-settings';
import { settingsNavLocation, settingsSectionFromPath } from './sections';

const storedRow = {
  id: 'default',
  company_name: 'Peak Roofing',
  default_lead_status: 'new',
  default_lead_priority: 'medium',
  regrid_api_key: 'rg_live_super_secret',
  geocode_api_key: 'geo_live_super_secret',
  auto_enrich_enabled: true,
  roof_price_per_square: 400,
  default_geo_city: 'Phoenix',
  default_geo_state: 'AZ',
  email_import_enabled: true,
  allowed_sender_emails: ['@hailtrace.com'],
  updated_at: '2026-08-18T12:00:00.000Z',
};

describe('public settings', () => {
  it('never puts stored API keys on the public settings object', () => {
    const settings = publicSettingsFromRow(storedRow);
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toContain('rg_live_super_secret');
    expect(serialized).not.toContain('geo_live_super_secret');
    expect(settings).toMatchObject({
      company_name: 'Peak Roofing',
      geocode_configured: true,
      regrid_configured: true,
      default_geo_city: 'Phoenix',
    });
    expect(settings).not.toHaveProperty('regrid_api_key');
    expect(settings).not.toHaveProperty('geocode_api_key');
  });

  it('treats blank stored secrets as not configured', () => {
    const settings = publicSettingsFromRow({
      ...storedRow,
      regrid_api_key: '   ',
      geocode_api_key: null,
    });
    expect(settings.regrid_configured).toBe(false);
    expect(settings.geocode_configured).toBe(false);
  });

  it('rejects Regrid and email-import fields so Settings cannot be a second save path', () => {
    for (const field of [
      'regrid_api_key',
      'auto_enrich_enabled',
      'email_import_enabled',
      'allowed_sender_emails',
    ]) {
      const result = settingsPatchFromBody({ [field]: 'x' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/Integrations/);
      }
    }
  });

  it('leaves a stored geocoder key unchanged when the replacement field is empty', () => {
    const result = settingsPatchFromBody({
      default_geo_city: 'Tempe',
      geocode_api_key: '',
    });
    expect(result).toEqual({
      ok: true,
      updates: { default_geo_city: 'Tempe' },
    });
  });

  it('replaces or clears the geocoder key only when asked', () => {
    expect(settingsPatchFromBody({ geocode_api_key: '  new-key  ' })).toEqual({
      ok: true,
      updates: { geocode_api_key: 'new-key' },
    });
    expect(settingsPatchFromBody({ clear_geocode_api_key: true })).toEqual({
      ok: true,
      updates: { geocode_api_key: null },
    });
  });

  it('validates status, priority, and roof price', () => {
    expect(settingsPatchFromBody({ default_lead_status: 'hot' }).ok).toBe(false);
    expect(settingsPatchFromBody({ default_lead_priority: 'urgent' }).ok).toBe(false);
    expect(settingsPatchFromBody({ roof_price_per_square: -1 }).ok).toBe(false);
    expect(settingsPatchFromBody({ roof_price_per_square: '' })).toEqual({
      ok: true,
      updates: { roof_price_per_square: null },
    });
  });

  it('names only the fields that actually changed', () => {
    expect(
      changedFieldLabels(
        { company_name: 'Peak', city: 'Phoenix' },
        { company_name: 'Summit', city: 'Phoenix' },
        { company_name: 'Company name', city: 'Default city' },
      ),
    ).toEqual(['Company name']);
  });

  it('treats a blank roof-price draft as equal to a null saved price', () => {
    expect(roofPriceUnchanged(null, '')).toBe(true);
    expect(roofPriceUnchanged(400, '400')).toBe(true);
    expect(roofPriceUnchanged(400, '425')).toBe(false);
  });
});

describe('settings sections', () => {
  it('maps nested settings paths to a stable section', () => {
    expect(settingsSectionFromPath('/admin/settings')?.id).toBe('company');
    expect(settingsSectionFromPath('/admin/settings/lead-rules')?.id).toBe('lead-rules');
    expect(settingsSectionFromPath('/admin/settings/notifications')?.label).toBe('Notifications');
    expect(settingsNavLocation('/admin/settings/mapping')).toEqual({
      section: 'Operations',
      label: 'Settings · Mapping',
    });
  });
});
