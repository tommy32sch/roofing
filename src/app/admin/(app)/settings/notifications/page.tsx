'use client';

import { useSettingsDirty } from '@/components/settings/settings-dirty';
import { SettingsSectionHeading } from '@/components/settings/settings-section';
import { StormAlertsCard } from '@/components/storms/StormAlertsCard';

export default function NotificationsSettingsPage() {
  const { setSectionDirty } = useSettingsDirty();
  return (
    <div className="space-y-6">
      <SettingsSectionHeading
        title="Notifications"
        description="Storm-alert thresholds, recipients, and email delivery status."
      />
      <StormAlertsCard onDirtyChange={setSectionDirty} />
    </div>
  );
}
