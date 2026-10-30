'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SettingsDirtyProvider } from '@/components/settings/settings-dirty';
import { SettingsNav } from '@/components/settings/settings-nav';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsDirtyProvider>
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Company, offices, lead rules, mapping, and notifications."
        />
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <SettingsNav />
          <div className="min-w-0 pt-4 lg:pt-0">{children}</div>
        </div>
      </div>
    </SettingsDirtyProvider>
  );
}
