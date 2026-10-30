import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const settingsRoute = read('src/app/api/admin/settings/route.ts');
const settingsPage = read('src/app/admin/(app)/settings/page.tsx');
const settingsLayout = read('src/app/admin/(app)/settings/layout.tsx');
const companyPage = read('src/app/admin/(app)/settings/company/page.tsx');
const marketsPage = read('src/app/admin/(app)/settings/markets/page.tsx');
const leadRulesPage = read('src/app/admin/(app)/settings/lead-rules/page.tsx');
const mappingPage = read('src/app/admin/(app)/settings/mapping/page.tsx');
const notificationsPage = read('src/app/admin/(app)/settings/notifications/page.tsx');
const integrationsPage = read('src/app/admin/(app)/integrations/page.tsx');
const regridPanel = read('src/components/integrations/regrid-panel.tsx');
const emailPanel = read('src/components/integrations/email-import-panel.tsx');
const middleware = read('src/middleware.ts');
const regridRoute = read('src/app/api/admin/integrations/regrid/route.ts');
const publicSettings = read('src/lib/settings/public-settings.ts');
const dirtyGuard = read('src/components/settings/settings-dirty.tsx');

describe('settings administration contracts', () => {
  it('opens a stable nested section from /admin/settings', () => {
    expect(settingsPage).toContain('redirect(SETTINGS_DEFAULT_HREF)');
    expect(settingsLayout).toContain('<SettingsNav');
    expect(settingsLayout).toContain('<SettingsDirtyProvider>');
    expect(read('src/components/settings/settings-nav.tsx')).toContain('aria-label="Settings sections"');
    for (const page of [companyPage, marketsPage, leadRulesPage, mappingPage, notificationsPage]) {
      expect(page).toContain('SettingsSectionHeading');
    }
  });

  it('keeps Regrid and email import on Integrations, not Settings', () => {
    const settingsSources = [companyPage, marketsPage, leadRulesPage, mappingPage, notificationsPage].join('\n');
    expect(settingsSources).not.toContain('/api/admin/integrations/regrid');
    expect(settingsSources).not.toContain('/api/admin/integrations/email');
    expect(settingsSources).not.toContain('Email-to-Import');
    expect(integrationsPage).toContain('<RegridPanel');
    expect(integrationsPage).toContain('<EmailImportPanel');
    expect(regridPanel).toContain("fetch('/api/admin/integrations/regrid'");
    expect(emailPanel).toContain("fetch('/api/admin/integrations/email'");
    expect(settingsSources).not.toContain('regrid_api_key:');
  });

  it('never returns stored secrets from the settings API', () => {
    expect(settingsRoute).toContain('publicSettingsFromRow');
    expect(settingsRoute).toContain('settingsPatchFromBody');
    expect(mappingPage).toContain('<SecretField');
    expect(mappingPage).not.toContain('settings.geocode_api_key');
    expect(regridPanel).toContain('<SecretField');
    expect(regridPanel).not.toContain('settings.regrid_api_key');
    expect(publicSettings).toContain('SETTINGS_INTEGRATION_FIELDS');
  });

  it('warns before unsaved settings are discarded', () => {
    expect(dirtyGuard).toContain("addEventListener('beforeunload'");
    expect(dirtyGuard).toContain('Leave without saving?');
    expect(companyPage).toContain('setSectionDirty');
    expect(leadRulesPage).toContain('setSectionDirty');
    expect(mappingPage).toContain('setSectionDirty');
    expect(marketsPage).toContain('onDirtyChange={setSectionDirty}');
    expect(notificationsPage).toContain('onDirtyChange={setSectionDirty}');
  });

  it('keeps settings and integrations admin-only and rejects a second Regrid save path', () => {
    expect(middleware).toContain("'/admin/settings'");
    expect(middleware).toContain("'/admin/integrations'");
    expect(settingsRoute.match(/role !== 'admin'/g)?.length).toBe(2);
    expect(regridRoute).toContain('clear_api_key');
    expect(settingsRoute).toContain('settingsPatchFromBody(body)');
  });
});
