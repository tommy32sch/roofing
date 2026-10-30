'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DataErrorState } from '@/components/layout/data-error-state';
import { useSettingsDirty } from '@/components/settings/settings-dirty';
import { SettingsSaveBar, SettingsSectionHeading } from '@/components/settings/settings-section';
import { usePublicSettings } from '@/components/settings/use-public-settings';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { roofPriceDraft, roofPriceUnchanged } from '@/lib/settings/public-settings';
import { LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS } from '@/types';

export default function LeadRulesSettingsPage() {
  const { setSectionDirty } = useSettingsDirty();
  const { settings, setSettings, loading, error, load } = usePublicSettings();
  const [status, setStatus] = useState('new');
  const [priority, setPriority] = useState('medium');
  const [roofPrice, setRoofPrice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setStatus(settings.default_lead_status);
    setPriority(settings.default_lead_priority);
    setRoofPrice(roofPriceDraft(settings.roof_price_per_square));
  }, [settings]);

  const changed = useMemo(() => {
    if (!settings) return [];
    const fields: string[] = [];
    if (status !== settings.default_lead_status) fields.push('Default status');
    if (priority !== settings.default_lead_priority) fields.push('Default priority');
    if (!roofPriceUnchanged(settings.roof_price_per_square, roofPrice)) fields.push('Roof price');
    return fields;
  }, [priority, roofPrice, settings, status]);

  useEffect(() => {
    setSectionDirty(changed.length > 0, changed.join(', '));
  }, [changed, setSectionDirty]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_lead_status: status,
          default_lead_priority: priority,
          roof_price_per_square: roofPrice.trim(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data.settings) {
        throw new Error(data?.error || 'Failed to save lead rules');
      }
      setSettings(data.settings);
      toast.success('Lead rules saved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to save lead rules');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeading title="Lead rules" description="Loading lead rules…" />
        <Skeleton className="h-28 w-full rounded-none" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeading
          title="Lead rules"
          description="Default status, priority, and roof replacement price."
        />
        <DataErrorState title="Lead rules did not load" description={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSectionHeading
        title="Lead rules"
        description="Default status, priority, and roof replacement price for new leads."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Default lead status</Label>
          <Select value={status} onValueChange={(value) => value && setStatus(value)}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Default lead priority</Label>
          <Select value={priority} onValueChange={(value) => value && setPriority(value)}>
            <SelectTrigger className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="roof_price_per_square">Base price per square ($)</Label>
        <Input
          id="roof_price_per_square"
          className="min-h-11"
          type="number"
          min="0"
          step="25"
          value={roofPrice}
          onChange={(event) => setRoofPrice(event.target.value)}
          placeholder="400"
        />
        <p className="text-xs text-muted-foreground">
          Asphalt-shingle baseline per 100 sq ft of roof. Metal, tile, and slate scale from this.
          Leave blank to use the default of about $400 per square.
        </p>
      </div>
      <SettingsSaveBar
        changed={changed}
        saving={saving}
        label="Save lead rules"
        onSave={() => void save()}
      />
    </div>
  );
}
