'use client';

import { MarketsCard } from '@/components/markets/markets-card';
import { useSettingsDirty } from '@/components/settings/settings-dirty';
import { SettingsSectionHeading } from '@/components/settings/settings-section';

export default function MarketsSettingsPage() {
  const { setSectionDirty } = useSettingsDirty();
  return (
    <div className="space-y-6">
      <SettingsSectionHeading
        title="Markets"
        description="Offices and the city or state used to place street-only addresses."
      />
      <MarketsCard onDirtyChange={setSectionDirty} />
    </div>
  );
}
