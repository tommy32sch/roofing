'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SetupCodePanel } from '@/components/integrations/setup-code-panel';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { emailImportAppsScript } from '@/lib/integrations/email-import-script';
import type { EmailImportLog } from '@/types';

export function EmailImportPanel({
  enabled,
  allowedEmails,
  logs,
  onSaved,
}: {
  enabled: boolean;
  allowedEmails: string[];
  logs: EmailImportLog[];
  onSaved: (next: { enabled: boolean; allowedEmails: string[] }) => void;
}) {
  const [importEnabled, setImportEnabled] = useState(enabled);
  const [senders, setSenders] = useState(allowedEmails.join('\n'));
  const [saving, setSaving] = useState(false);
  const script = useMemo(
    () => emailImportAppsScript(typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'),
    [],
  );

  async function save() {
    setSaving(true);
    try {
      const emails = senders.split('\n').map((entry) => entry.trim()).filter(Boolean);
      const response = await fetch('/api/admin/integrations/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: importEnabled,
          allowed_sender_emails: emails,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to save email import');
      }
      onSaved({
        enabled: data.configuration?.enabled === true,
        allowedEmails: Array.isArray(data.configuration?.allowedSenderEmails)
          ? data.configuration.allowedSenderEmails
          : emails,
      });
      toast.success('Email import settings saved');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Failed to save email import');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="email-import" className="space-y-4 border-t border-border/70 pt-6">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Inbound mail
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Email import</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Import CSV attachments from a labelled Gmail inbox through Google Apps Script.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id="email_enabled"
          checked={importEnabled}
          onCheckedChange={setImportEnabled}
        />
        <Label htmlFor="email_enabled" className="cursor-pointer">
          Enable email import
        </Label>
      </div>
      <div className="space-y-2">
        <Label htmlFor="allowed_emails">Allowed sender emails</Label>
        <textarea
          id="allowed_emails"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={senders}
          onChange={(event) => setSenders(event.target.value)}
          placeholder={'user@example.com\n@hailtrace.com\n@propstream.com'}
        />
        <p className="text-xs text-muted-foreground">
          One address or @domain.com rule per line. Leave empty to allow any authenticated sender.
        </p>
      </div>
      <Button className="min-h-11" onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save email import'}
      </Button>
      <SetupCodePanel
        title="Google Apps Script"
        summary="Create an Integrations API key, paste this script into script.google.com, then run it on a five-minute trigger. In Gmail, label HailTrace or PropStream mail as to-import."
        code={script}
      />
      {logs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Recent email imports</h3>
          <div className="divide-y border">
            {logs.slice(0, 10).map((log) => (
              <div key={log.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{log.attachment_name || log.subject || 'No subject'}</p>
                  <p className="truncate text-muted-foreground">{log.sender_email}</p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className="text-status-complete">{log.leads_imported} imported</p>
                  {log.duplicates_skipped > 0 && (
                    <p className="text-muted-foreground">{log.duplicates_skipped} dupes</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
