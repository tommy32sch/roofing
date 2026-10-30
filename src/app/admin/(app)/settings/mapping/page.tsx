'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DataErrorState } from '@/components/layout/data-error-state';
import { SecretField } from '@/components/settings/secret-field';
import { useSettingsDirty } from '@/components/settings/settings-dirty';
import { SettingsSaveBar, SettingsSectionHeading } from '@/components/settings/settings-section';
import { usePublicSettings } from '@/components/settings/use-public-settings';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

export default function MappingSettingsPage() {
  const { setSectionDirty } = useSettingsDirty();
  const { settings, setSettings, loading, error, load } = usePublicSettings();
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [geocodeKey, setGeocodeKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setCity(settings.default_geo_city ?? '');
    setState(settings.default_geo_state ?? '');
    setGeocodeKey('');
  }, [settings]);

  const changed = useMemo(() => {
    if (!settings) return [];
    const fields: string[] = [];
    if ((settings.default_geo_city ?? '') !== city) fields.push('Default city');
    if ((settings.default_geo_state ?? '') !== state) fields.push('Default state');
    if (geocodeKey.trim()) fields.push('Geocoder key');
    return fields;
  }, [city, geocodeKey, settings, state]);

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
          default_geo_city: city.trim(),
          default_geo_state: state.trim(),
          ...(geocodeKey.trim() ? { geocode_api_key: geocodeKey.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data.settings) {
        throw new Error(data?.error || 'Failed to save mapping settings');
      }
      setSettings(data.settings);
      setGeocodeKey('');
      toast.success('Mapping settings saved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to save mapping settings');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setClearing(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_geocode_api_key: true }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success || !data.settings) {
        throw new Error(data?.error || 'Failed to remove the geocoder key');
      }
      setSettings(data.settings);
      setGeocodeKey('');
      toast.success('Geocoder key removed');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to remove the geocoder key');
    } finally {
      setClearing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeading title="Mapping" description="Loading mapping settings…" />
        <Skeleton className="h-36 w-full rounded-none" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-4">
        <SettingsSectionHeading
          title="Mapping"
          description="Fallback map region and the optional house-level geocoder key."
        />
        <DataErrorState title="Mapping settings did not load" description={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSectionHeading
        title="Mapping"
        description="Fallback city and state for leads with no market, plus the optional house-level geocoder."
      />
      <SecretField
        id="geocode_api_key"
        label="Geocoder API key"
        description="Used only when OpenStreetMap and the US Census cannot place a house. Leave blank to use the free sources alone."
        configured={settings.geocode_configured}
        value={geocodeKey}
        onChange={setGeocodeKey}
        onClear={() => void clearKey()}
        clearing={clearing}
        disabled={saving}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="geo_city">Default city</Label>
          <Input
            id="geo_city"
            className="min-h-11"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="Phoenix"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="geo_state">Default state</Label>
          <Input
            id="geo_state"
            className="min-h-11"
            value={state}
            onChange={(event) => setState(event.target.value)}
            placeholder="AZ"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A lead in a market uses that market&apos;s region first. Regrid property enrichment is
        configured in{' '}
        <Link href="/admin/integrations#regrid" className="underline">
          Integrations
        </Link>
        .
      </p>
      <SettingsSaveBar
        changed={changed}
        saving={saving}
        label="Save mapping"
        onSave={() => void save()}
      />
    </div>
  );
}
