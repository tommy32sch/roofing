'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Key, Plus, Trash2, Webhook, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { IntegrationApiKey, WebhookLog, LeadSource } from '@/types';

export default function IntegrationsPage() {
  const [keys, setKeys] = useState<IntegrationApiKey[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySource, setNewKeySource] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/inbound`
    : '';

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [keysRes, logsRes, sourcesRes] = await Promise.all([
        fetch('/api/admin/integrations'),
        fetch('/api/admin/integrations/logs'),
        fetch('/api/admin/leads/sources'),
      ]);

      const keysData = await keysRes.json();
      const logsData = await logsRes.json();
      const sourcesData = await sourcesRes.json();

      if (keysData.success) setKeys(keysData.keys);
      if (logsData.success) setLogs(logsData.logs);
      if (sourcesData.success) setSources(sourcesData.sources);
    } catch {
      toast.error('Failed to load integration data');
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    if (!newKeyName.trim()) {
      toast.error('Name is required');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          source_id: newKeySource ? parseInt(newKeySource) : null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setNewKeyValue(data.key.api_key);
        toast.success('API key created');
        loadData();
      } else {
        toast.error(data.error || 'Failed to create key');
      }
    } catch {
      toast.error('Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function deleteKey(keyId: string) {
    if (!confirm('Deactivate this API key? Any webhooks using it will stop working.')) return;

    try {
      const res = await fetch(`/api/admin/integrations/${keyId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('API key deactivated');
        loadData();
      } else {
        toast.error(data.error || 'Failed to deactivate key');
      }
    } catch {
      toast.error('Failed to deactivate key');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Integrations</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-lg" />
          <div className="h-48 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-muted-foreground">Manage webhook integrations and API keys</p>
        </div>
      </div>

      {/* Webhook URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            Webhook URL
          </CardTitle>
          <CardDescription>
            Use this URL to receive leads from external services like BatchLeads, HailTrace, etc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
              {webhookUrl}
            </code>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(webhookUrl)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Send a POST request with JSON body and include your API key in the <code className="bg-muted px-1 rounded">x-api-key</code> header.
          </p>
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
            <CardDescription>Each key auto-tags leads with a source</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setNewKeyName('');
              setNewKeySource('');
              setNewKeyValue(null);
            }
          }}>
            <DialogTrigger>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                Create Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              {newKeyValue ? (
                <>
                  <DialogHeader>
                    <DialogTitle>API Key Created</DialogTitle>
                    <DialogDescription>
                      Copy this key now. It will not be shown again.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
                        {newKeyValue}
                      </code>
                      <Button variant="outline" size="sm" onClick={() => copyToClipboard(newKeyValue)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => { setDialogOpen(false); setNewKeyValue(null); }}>
                      Done
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                    <DialogDescription>
                      Generate a new API key for webhook integrations.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="key-name">Name</Label>
                      <Input
                        id="key-name"
                        placeholder="e.g., BatchLeads Webhook"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="key-source">Auto-tag source (optional)</Label>
                      <Select value={newKeySource} onValueChange={(v) => setNewKeySource(v || '')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a source..." />
                        </SelectTrigger>
                        <SelectContent>
                          {sources.map((source) => (
                            <SelectItem key={source.id} value={String(source.id)}>
                              {source.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button onClick={createKey} disabled={creating}>
                      {creating ? 'Creating...' : 'Create Key'}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No API keys yet. Create one to start receiving webhook data.
            </p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{key.name}</span>
                      <Badge variant={key.is_active ? 'default' : 'secondary'}>
                        {key.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <code className="bg-muted px-1 rounded">{key.api_key}</code>
                      {key.lead_sources && (
                        <span>Source: {key.lead_sources.display_name}</span>
                      )}
                      {key.last_used_at && (
                        <span>Last used: {new Date(key.last_used_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  {key.is_active && (
                    <Button variant="ghost" size="sm" onClick={() => deleteKey(key.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Webhook Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Webhook Activity
          </CardTitle>
          <CardDescription>Last 50 webhook calls</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No webhook activity yet.
            </p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{log.source_name || 'Unknown'}</span>
                      <span className="text-muted-foreground">
                        via {log.integration_api_keys?.name || 'Unknown key'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="text-green-600 dark:text-green-400">
                        +{log.leads_imported} imported
                      </span>
                      {log.duplicates_skipped > 0 && (
                        <span className="text-yellow-600 dark:text-yellow-400">
                          {log.duplicates_skipped} duplicates
                        </span>
                      )}
                      {log.errors && log.errors.length > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {log.errors.length} errors
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Setup Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold mb-1">BatchLeads &quot;Push to CRM&quot;</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Create an API key above with &quot;BatchLeads&quot; as the source</li>
              <li>In BatchLeads, go to Settings &rarr; Webhooks</li>
              <li>Add a new webhook with your Webhook URL above</li>
              <li>Add the API key in the custom header as <code className="bg-muted px-1 rounded">x-api-key</code></li>
              <li>Map the fields and save</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold mb-1">cURL Example</h3>
            <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap">
{`curl -X POST ${webhookUrl || 'https://your-app.vercel.app/api/webhooks/inbound'} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '[{"first_name":"John","last_name":"Doe","phone":"555-123-4567","address":"123 Main St","city":"Dallas","state":"TX","zip":"75201"}]'`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
