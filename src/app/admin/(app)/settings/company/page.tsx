'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DataErrorState } from '@/components/layout/data-error-state';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { useSettingsDirty } from '@/components/settings/settings-dirty';
import { SettingsSaveBar, SettingsSectionHeading } from '@/components/settings/settings-section';
import { usePublicSettings } from '@/components/settings/use-public-settings';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { changedFieldLabels } from '@/lib/settings/public-settings';

export default function CompanySettingsPage() {
  const { refresh } = useAppShell();
  const { setSectionDirty } = useSettingsDirty();
  const { settings, setSettings, loading, error, load } = usePublicSettings();
  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setCompanyName(settings.company_name);
  }, [settings]);

  const changed = useMemo(
    () => changedFieldLabels(
      { company_name: settings?.company_name ?? '' },
      { company_name: companyName },
      { company_name: 'Company name' },
    ),
    [companyName, settings],
  );

  useEffect(() => {
    setSectionDirty(changed.length > 0, changed.join(', '));
  }, [changed, setSectionDirty]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: companyName.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data.settings) {
        throw new Error(data?.error || 'Failed to save company settings');
      }
      setSettings(data.settings);
      refresh();
      toast.success('Company settings saved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to save company settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeading title="Company" description="Loading company settings…" />
        <Skeleton className="h-11 w-full rounded-none" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeading
          title="Company"
          description="The name shown in the workspace and in outbound mail."
        />
        <DataErrorState title="Company settings did not load" description={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSectionHeading
        title="Company"
        description="The name shown in the workspace and in outbound mail."
      />
      <div className="space-y-2">
        <Label htmlFor="company_name">Company name</Label>
        <Input
          id="company_name"
          className="min-h-11"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          placeholder="Peak Roofing"
        />
      </div>
      <SettingsSaveBar
        changed={changed}
        saving={saving}
        label="Save company"
        onSave={() => void save()}
      />
    </div>
  );
}
