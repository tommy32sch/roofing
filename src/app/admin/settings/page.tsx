'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { AppSettings } from '@/types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [defaultStatus, setDefaultStatus] = useState('new');
  const [defaultPriority, setDefaultPriority] = useState('medium');
  const [regridApiKey, setRegridApiKey] = useState('');
  const [autoEnrich, setAutoEnrich] = useState(false);
  const [testingRegrid, setTestingRegrid] = useState(false);
  const [savingRegrid, setSavingRegrid] = useState(false);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.settings) {
          setSettings(data.settings);
          setCompanyName(data.settings.company_name || '');
          setDefaultStatus(data.settings.default_lead_status || 'new');
          setDefaultPriority(data.settings.default_lead_priority || 'medium');
          setRegridApiKey(data.settings.regrid_api_key || '');
          setAutoEnrich(data.settings.auto_enrich_enabled || false);
        }
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName.trim(),
          default_lead_status: defaultStatus,
          default_lead_priority: defaultPriority,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Settings saved');
        setSettings(data.settings);
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company_name">Company Name</Label>
            <Input
              id="company_name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Roof Leads"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Default Lead Status</Label>
              <Select value={defaultStatus} onValueChange={(v) => v && setDefaultStatus(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Lead Priority</Label>
              <Select value={defaultPriority} onValueChange={(v) => v && setDefaultPriority(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Regrid Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regrid Property Enrichment</CardTitle>
          <CardDescription>
            Automatically enrich leads with property data (sqft, lot size, beds/baths, assessed value, owner info) using the Regrid API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="regrid_api_key">Regrid API Key</Label>
            <Input
              id="regrid_api_key"
              type="password"
              value={regridApiKey}
              onChange={(e) => setRegridApiKey(e.target.value)}
              placeholder="Enter your Regrid API token"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="auto_enrich"
              checked={autoEnrich}
              onCheckedChange={setAutoEnrich}
              disabled={!regridApiKey}
            />
            <Label htmlFor="auto_enrich" className="cursor-pointer">
              Auto-enrich new leads on creation/import
            </Label>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                setSavingRegrid(true);
                try {
                  const res = await fetch('/api/admin/settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      regrid_api_key: regridApiKey.trim(),
                      auto_enrich_enabled: autoEnrich,
                    }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    toast.success('Regrid settings saved');
                    setSettings(data.settings);
                  } else {
                    toast.error(data.error || 'Failed to save');
                  }
                } catch {
                  toast.error('Failed to save Regrid settings');
                } finally {
                  setSavingRegrid(false);
                }
              }}
              disabled={savingRegrid}
            >
              {savingRegrid ? 'Saving...' : 'Save Regrid Settings'}
            </Button>
            <Button
              variant="outline"
              disabled={!regridApiKey || testingRegrid}
              onClick={async () => {
                setTestingRegrid(true);
                try {
                  const res = await fetch('/api/admin/integrations/regrid', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: regridApiKey.trim() }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    toast.success(data.message);
                  } else {
                    toast.error(data.message || data.error || 'Connection failed');
                  }
                } catch {
                  toast.error('Failed to test connection');
                } finally {
                  setTestingRegrid(false);
                }
              }}
            >
              {testingRegrid ? 'Testing...' : 'Test Connection'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
