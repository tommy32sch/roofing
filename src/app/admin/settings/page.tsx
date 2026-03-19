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

  // Email import state
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [allowedEmails, setAllowedEmails] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailLogs, setEmailLogs] = useState<{ id: string; sender_email: string; subject: string | null; attachment_name: string | null; leads_imported: number; duplicates_skipped: number; errors: string[] | null; created_at: string; lead_sources?: { display_name: string } }[]>([]);

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
          setEmailEnabled(data.settings.email_import_enabled || false);
          setAllowedEmails((data.settings.allowed_sender_emails || []).join('\n'));
        }
      })
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));

    // Fetch email import logs
    fetch('/api/admin/integrations/email-logs')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setEmailLogs(data.logs);
      })
      .catch(() => {});
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

      {/* Email Import */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email-to-Import (Gmail + Apps Script)</CardTitle>
          <CardDescription>
            Automatically import CSV exports from HailTrace, PropStream, etc. via a free Gmail account and Google Apps Script. Sources are auto-detected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="email_enabled"
              checked={emailEnabled}
              onCheckedChange={setEmailEnabled}
            />
            <Label htmlFor="email_enabled" className="cursor-pointer">
              Enable email import
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="allowed_emails">Allowed Sender Emails</Label>
            <textarea
              id="allowed_emails"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={allowedEmails}
              onChange={(e) => setAllowedEmails(e.target.value)}
              placeholder={"user@example.com\n@hailtrace.com\n@propstream.com"}
            />
            <p className="text-xs text-muted-foreground">
              One per line. Use @domain.com to allow all emails from a domain. Leave empty to allow all senders.
            </p>
          </div>

          <Button
            onClick={async () => {
              setSavingEmail(true);
              try {
                const emails = allowedEmails
                  .split('\n')
                  .map(e => e.trim())
                  .filter(Boolean);
                const res = await fetch('/api/admin/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email_import_enabled: emailEnabled,
                    allowed_sender_emails: emails,
                  }),
                });
                const data = await res.json();
                if (data.success) {
                  toast.success('Email import settings saved');
                  setSettings(data.settings);
                } else {
                  toast.error(data.error || 'Failed to save');
                }
              } catch {
                toast.error('Failed to save email settings');
              } finally {
                setSavingEmail(false);
              }
            }}
            disabled={savingEmail}
          >
            {savingEmail ? 'Saving...' : 'Save Email Settings'}
          </Button>

          {/* Setup Guide */}
          <div className="space-y-3 pt-2 border-t">
            <h4 className="text-sm font-medium">Setup Guide (Free)</h4>
            <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Create a Gmail account for imports (e.g., <strong>yourcompany.leads@gmail.com</strong>)</li>
              <li>Create an API key in the <a href="/admin/integrations" className="underline text-primary">Integrations</a> page</li>
              <li>Open <a href="https://script.google.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">Google Apps Script</a> and create a new project</li>
              <li>Paste the script below, fill in your URL and API key</li>
              <li>Set a time-based trigger to run every 5 minutes</li>
              <li>Forward your HailTrace/PropStream/etc export emails to your Gmail</li>
            </ol>

            <div className="space-y-2">
              <Label className="text-xs">Google Apps Script Code</Label>
              <div className="relative">
                <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre">{`// === CONFIGURATION ===
var WEBHOOK_URL = '${typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'}/api/webhooks/email';
var API_KEY = 'YOUR_API_KEY_HERE'; // From Integrations page
var LABEL_TO_PROCESS = 'to-import';
var LABEL_DONE = 'imported';

function processEmails() {
  var toProcess = GmailApp.getUserLabelByName(LABEL_TO_PROCESS);
  var done = GmailApp.getUserLabelByName(LABEL_DONE);
  if (!toProcess) { toProcess = GmailApp.createLabel(LABEL_TO_PROCESS); }
  if (!done) { done = GmailApp.createLabel(LABEL_DONE); }

  var threads = toProcess.getThreads(0, 10);
  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      var attachments = msg.getAttachments();
      var csvAttachments = [];

      for (var k = 0; k < attachments.length; k++) {
        var att = attachments[k];
        if (att.getName().toLowerCase().endsWith('.csv')) {
          csvAttachments.push({
            name: att.getName(),
            content: Utilities.base64Encode(att.getBytes())
          });
        }
      }

      if (csvAttachments.length > 0) {
        var payload = {
          sender: msg.getFrom(),
          subject: msg.getSubject(),
          attachments: csvAttachments
        };

        var options = {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-api-key': API_KEY },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };

        var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
        Logger.log('Import result: ' + response.getContentText());
      }
    }
    threads[i].removeLabel(toProcess);
    threads[i].addLabel(done);
  }
}`}</pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => {
                    const code = document.querySelector('.bg-muted pre')?.textContent;
                    if (code) {
                      navigator.clipboard.writeText(code);
                      toast.success('Script copied to clipboard');
                    }
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                In Gmail, create a filter: emails from HailTrace/PropStream/etc automatically get the &quot;to-import&quot; label. The script checks every 5 minutes and imports any CSV attachments.
              </p>
            </div>
          </div>

          {/* Recent email import logs */}
          {emailLogs.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              <h4 className="text-sm font-medium text-muted-foreground">Recent Imports</h4>
              <div className="space-y-1">
                {emailLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="flex items-center justify-between text-xs border rounded px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{log.attachment_name || log.subject || 'No subject'}</p>
                      <p className="text-muted-foreground truncate">{log.sender_email}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-green-600 dark:text-green-400">{log.leads_imported} imported</p>
                      {log.duplicates_skipped > 0 && (
                        <p className="text-muted-foreground">{log.duplicates_skipped} dupes</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
