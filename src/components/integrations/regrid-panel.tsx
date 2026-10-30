'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { SecretField } from '@/components/settings/secret-field';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function RegridPanel({
  configured,
  autoEnrich,
  onConfiguredChange,
}: {
  configured: boolean;
  autoEnrich: boolean;
  onConfiguredChange: (next: { configured: boolean; autoEnrich: boolean }) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(autoEnrich);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function save() {
    if (!configured && !apiKey.trim()) {
      toast.error('Enter a Regrid API key');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/admin/integrations/regrid', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_enrich_enabled: enabled,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to save Regrid settings');
      }
      onConfiguredChange({
        configured: data.configuration?.secretStored !== false,
        autoEnrich: data.configuration?.autoEnrichEnabled === true,
      });
      setApiKey('');
      toast.success('Regrid settings saved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to save Regrid settings');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const response = await fetch('/api/admin/integrations/regrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Connection failed');
      }
      toast.success(data.message || 'Connection successful');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to test connection');
    } finally {
      setTesting(false);
    }
  }

  async function clearKey() {
    setClearing(true);
    try {
      const response = await fetch('/api/admin/integrations/regrid', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_api_key: true }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to remove the Regrid key');
      }
      onConfiguredChange({ configured: false, autoEnrich: false });
      setEnabled(false);
      setApiKey('');
      toast.success('Regrid key removed');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to remove the Regrid key');
    } finally {
      setClearing(false);
    }
  }

  return (
    <section id="regrid" className="space-y-4 border-t border-border/70 pt-6">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Property data
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Regrid</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Enrich leads with parcel data such as roof area, beds, and owner name.
        </p>
      </div>
      <SecretField
        id="regrid_api_key"
        label="Regrid API key"
        description="Paste the token from your Regrid account. It is stored on the server and is never shown again."
        configured={configured}
        value={apiKey}
        onChange={setApiKey}
        onClear={() => void clearKey()}
        clearing={clearing}
        disabled={saving}
      />
      <div className="flex items-center gap-3">
        <Switch
          id="auto_enrich"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!configured && !apiKey.trim()}
        />
        <Label htmlFor="auto_enrich" className="cursor-pointer">
          Auto-enrich new leads on create and import
        </Label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save Regrid'}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={(!configured && !apiKey.trim()) || testing}
          onClick={() => void testConnection()}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
      </div>
    </section>
  );
}
