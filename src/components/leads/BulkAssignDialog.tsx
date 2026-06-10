'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UserRole } from '@/types';

interface DialogUser {
  id: string;
  name: string;
  role: UserRole;
}

interface AssignmentSummary {
  user_id: string | null;
  name: string | null;
  count: number;
  total_value: number;
}

interface BulkAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onAssigned: () => void;
}

export function BulkAssignDialog({ open, onOpenChange, leadIds, onAssigned }: BulkAssignDialogProps) {
  const [users, setUsers] = useState<DialogUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [role, setRole] = useState<'setter' | 'closer'>('setter');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [unassign, setUnassign] = useState(false);
  const [strategy, setStrategy] = useState<'count' | 'value'>('count');
  const [preview, setPreview] = useState<AssignmentSummary[] | null>(null);
  const [previewSkipped, setPreviewSkipped] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && !usersLoaded) {
      fetch('/api/admin/users')
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setUsers(data.users);
          setUsersLoaded(true);
        })
        .catch(() => toast.error('Failed to load users'));
    }
  }, [open, usersLoaded]);

  const eligibleUsers = users.filter((u) => u.role === role || u.role === 'admin');
  const isDistribute = !unassign && selectedUserIds.length >= 2;
  const canSubmit = unassign || selectedUserIds.length >= 1;

  function resetChoices(nextRole?: 'setter' | 'closer') {
    if (nextRole) setRole(nextRole);
    setSelectedUserIds([]);
    setUnassign(false);
    setPreview(null);
  }

  function toggleUser(id: string, checked: boolean) {
    setSelectedUserIds((prev) => (checked ? [...prev, id] : prev.filter((u) => u !== id)));
    setPreview(null);
  }

  function buildPayload(dryRun: boolean) {
    if (unassign) {
      return { mode: 'single', role, lead_ids: leadIds, user_id: null, dry_run: dryRun };
    }
    if (selectedUserIds.length === 1) {
      return { mode: 'single', role, lead_ids: leadIds, user_id: selectedUserIds[0], dry_run: dryRun };
    }
    return { mode: 'distribute', role, lead_ids: leadIds, user_ids: selectedUserIds, strategy, dry_run: dryRun };
  }

  async function submit(dryRun: boolean) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/leads/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(dryRun)),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Assignment failed');
        return;
      }
      if (dryRun) {
        setPreview(data.assignments);
        setPreviewSkipped(data.skipped);
      } else {
        const summary = (data.assignments as AssignmentSummary[])
          .map((a) => `${a.name ?? 'Unassigned'}: ${a.count}`)
          .join(' · ');
        toast.success(`${data.updated} lead${data.updated !== 1 ? 's' : ''} updated`, {
          description: summary,
        });
        resetChoices();
        onAssigned();
      }
    } catch {
      toast.error('Assignment failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Assign {leadIds.length} lead{leadIds.length !== 1 ? 's' : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Assign as</Label>
            <Select value={role} onValueChange={(v) => v && resetChoices(v as 'setter' | 'closer')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="setter">Setter</SelectItem>
                <SelectItem value="closer">Closer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Assign to</Label>
            <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
              {eligibleUsers.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  {usersLoaded ? `No ${role}s found. Add users first.` : 'Loading...'}
                </p>
              )}
              {eligibleUsers.map((u) => (
                <label
                  key={u.id}
                  className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 ${unassign ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <Checkbox
                    checked={selectedUserIds.includes(u.id)}
                    onCheckedChange={(checked) => toggleUser(u.id, checked === true)}
                    disabled={unassign}
                  />
                  <span>{u.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground capitalize">{u.role}</span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-3 px-1 py-1 text-sm cursor-pointer">
              <Checkbox
                checked={unassign}
                onCheckedChange={(checked) => {
                  setUnassign(checked === true);
                  setSelectedUserIds([]);
                  setPreview(null);
                }}
              />
              <span>Unassign (clear current {role})</span>
            </label>
          </div>

          {isDistribute && (
            <div className="space-y-2">
              <Label>Split between {selectedUserIds.length} reps</Label>
              <Select
                value={strategy}
                onValueChange={(v) => {
                  if (v) {
                    setStrategy(v as 'count' | 'value');
                    setPreview(null);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">Evenly by # of leads</SelectItem>
                  <SelectItem value="value">Balanced by est. roof value</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {preview && (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Rep</th>
                    <th className="px-3 py-2 font-medium text-right">Leads</th>
                    <th className="px-3 py-2 font-medium text-right">Est. value</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((a, i) => (
                    <tr key={a.user_id ?? i} className="border-b last:border-0">
                      <td className="px-3 py-2">{a.name ?? 'Unassigned'}</td>
                      <td className="px-3 py-2 text-right">{a.count}</td>
                      <td className="px-3 py-2 text-right">${a.total_value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewSkipped > 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground border-t">
                  {previewSkipped} selected lead{previewSkipped !== 1 ? 's' : ''} no longer exist and will be skipped.
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Existing {role} assignments on selected leads will be overwritten.
          </p>
        </div>

        <DialogFooter>
          {isDistribute && (
            <Button variant="outline" onClick={() => submit(true)} disabled={submitting || !canSubmit}>
              Preview split
            </Button>
          )}
          <Button onClick={() => submit(false)} disabled={submitting || !canSubmit}>
            {submitting ? 'Assigning...' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
