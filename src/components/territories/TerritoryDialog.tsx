'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TERRITORY_COLORS } from '@/lib/territories/constants';
import type { Territory, UserRole } from '@/types';

interface TerritoryUser {
  id: string;
  name: string;
  role: UserRole;
  market_id: number | null;
}

interface TerritoryConflict {
  id: string;
  name: string;
  owner_name: string | null;
}

interface TerritoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId: number;
  boundary: [number, number][];
  shownLeadCount: number;
  territory?: Territory | null;
  onSaved: (territory: Territory) => void;
}

const UNASSIGNED = 'unassigned';

export function TerritoryDialog({
  open,
  onOpenChange,
  marketId,
  boundary,
  shownLeadCount,
  territory = null,
  onSaved,
}: TerritoryDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TERRITORY_COLORS[0]);
  const [ownerId, setOwnerId] = useState(UNASSIGNED);
  const [users, setUsers] = useState<TerritoryUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<TerritoryConflict[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(territory?.name ?? '');
    setColor(territory?.color ?? TERRITORY_COLORS[0]);
    setOwnerId(territory?.owner_user_id ?? UNASSIGNED);
    setConflicts([]);
  }, [open, territory]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUsersLoading(true);
    fetch('/api/admin/users')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.success) setUsers(data.users ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load territory owners');
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const eligibleUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          (user.role === 'setter' || user.role === 'admin') &&
          (user.market_id == null || user.market_id === marketId)
      ),
    [marketId, users]
  );

  async function submit(allowOverlap: boolean) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Give this territory a name');
      return;
    }

    setSaving(true);
    setConflicts([]);
    try {
      const editing = !!territory;
      const res = await fetch(
        editing ? `/api/admin/territories/${territory.id}` : '/api/admin/territories',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            color,
            owner_user_id: ownerId === UNASSIGNED ? null : ownerId,
            boundary,
            ...(editing ? {} : { market_id: marketId }),
            allow_overlap: allowOverlap,
          }),
        }
      );
      const data = await res.json();
      if (res.status === 409 && Array.isArray(data.conflicts)) {
        setConflicts(data.conflicts);
        return;
      }
      if (!data.success) {
        toast.error(data.error || `Failed to ${editing ? 'update' : 'save'} territory`);
        return;
      }
      toast.success(editing ? 'Territory updated' : 'Territory saved');
      onSaved(data.territory);
    } catch {
      toast.error(`Failed to ${territory ? 'update' : 'save'} territory`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{territory ? 'Edit territory' : 'Save territory'}</DialogTitle>
          <DialogDescription>
            This area currently contains {shownLeadCount} shown lead
            {shownLeadCount !== 1 ? 's' : ''}. Ownership describes who canvasses the area and
            does not reassign those leads.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="territory-name">Name</Label>
            <Input
              id="territory-name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mesa East"
            />
          </div>

          <div className="space-y-2">
            <Label>Owner</Label>
            <Select
              value={ownerId}
              onValueChange={(value) => {
                if (value) {
                  setOwnerId(value);
                }
              }}
            >
              <SelectTrigger aria-label="Territory owner">
                <SelectValue>{ownerId === UNASSIGNED
                  ? 'Unassigned'
                  : eligibleUsers.find((user) => user.id === ownerId)?.name ?? territory?.owner_name ?? 'Select owner'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {eligibleUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} · {user.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {usersLoading && <p className="text-xs text-muted-foreground">Loading team...</p>}
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {TERRITORY_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Use territory color ${option}`}
                  aria-pressed={color === option}
                  onClick={() => {
                    setColor(option);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background shadow-sm ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    backgroundColor: option,
                    boxShadow: color === option ? `0 0 0 2px ${option}` : undefined,
                  }}
                >
                  {color === option && <Check className="h-4 w-4 text-white drop-shadow" />}
                </button>
              ))}
            </div>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="font-medium">This area overlaps an active territory.</p>
                  {conflicts.map((conflict) => (
                    <p key={conflict.id}>
                      {conflict.name}
                      {conflict.owner_name ? ` · ${conflict.owner_name}` : ' · Unassigned'}
                    </p>
                  ))}
                  <p>Save anyway only if the overlap is intentional.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => submit(conflicts.length > 0)} disabled={saving || !name.trim()}>
            {saving
              ? 'Saving...'
              : conflicts.length > 0
                ? 'Save with overlap'
                : territory
                  ? 'Save changes'
                  : 'Save territory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
