import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from './sections';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const nav = read('src/components/settings/settings-nav.tsx');
const layout = read('src/app/admin/(app)/settings/layout.tsx');
const company = read('src/app/admin/(app)/settings/company/page.tsx');
const leadRules = read('src/app/admin/(app)/settings/lead-rules/page.tsx');
const mapping = read('src/app/admin/(app)/settings/mapping/page.tsx');
const integrations = read('src/app/admin/(app)/integrations/page.tsx');

describe('settings visual contracts', () => {
  it('uses a work rail of five sections instead of one card stack', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      'company',
      'markets',
      'lead-rules',
      'mapping',
      'notifications',
    ]);
    expect(nav).toContain('lg:flex-col');
    expect(nav).toContain('min-h-11');
    expect(layout).not.toContain('<Card');
    expect(company).not.toContain('<Card');
    expect(leadRules).not.toContain('<Card');
    expect(mapping).not.toContain('<Card');
  });

  it('keeps primary save and nav targets at 44 px', () => {
    expect(read('src/components/settings/settings-section.tsx')).toContain('min-h-11');
    expect(company).toContain('min-h-11');
    expect(leadRules).toContain('min-h-11');
    expect(mapping).toContain('min-h-11');
  });

  it('hides long setup code behind an expandable panel on Integrations', () => {
    expect(integrations).toContain('<SetupCodePanel');
    expect(integrations).not.toContain('Google Apps Script Code');
    expect(read('src/components/integrations/setup-code-panel.tsx')).toContain('<details');
    expect(read('src/components/integrations/email-import-panel.tsx')).toContain('<SetupCodePanel');
  });
});
