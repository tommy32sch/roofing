export type SettingsSectionId =
  | 'company'
  | 'markets'
  | 'lead-rules'
  | 'mapping'
  | 'notifications';

export interface SettingsSection {
  id: SettingsSectionId;
  href: string;
  label: string;
  description: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'company',
    href: '/admin/settings/company',
    label: 'Company',
    description: 'The name shown in the workspace and in outbound mail.',
  },
  {
    id: 'markets',
    href: '/admin/settings/markets',
    label: 'Markets',
    description: 'Offices and the city or state used to place street-only addresses.',
  },
  {
    id: 'lead-rules',
    href: '/admin/settings/lead-rules',
    label: 'Lead rules',
    description: 'Default status, priority, and roof replacement price.',
  },
  {
    id: 'mapping',
    href: '/admin/settings/mapping',
    label: 'Mapping',
    description: 'Fallback map region and the optional house-level geocoder key.',
  },
  {
    id: 'notifications',
    href: '/admin/settings/notifications',
    label: 'Notifications',
    description: 'Storm-alert thresholds, recipients, and email delivery status.',
  },
];

export const SETTINGS_INDEX_HREF = '/admin/settings';
export const SETTINGS_DEFAULT_HREF = '/admin/settings/company';

export function settingsSectionFromPath(pathname: string): SettingsSection | null {
  if (pathname === SETTINGS_INDEX_HREF) return SETTINGS_SECTIONS[0];
  return SETTINGS_SECTIONS.find((section) => (
    pathname === section.href || pathname.startsWith(`${section.href}/`)
  )) ?? null;
}

export function settingsNavLocation(pathname: string): { section: string; label: string } | null {
  if (!pathname.startsWith(SETTINGS_INDEX_HREF)) return null;
  const current = settingsSectionFromPath(pathname);
  return {
    section: 'Operations',
    label: current ? `Settings · ${current.label}` : 'Settings',
  };
}
