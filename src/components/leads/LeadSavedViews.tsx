'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Ellipsis, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LEAD_VIEW_NAME_MAX_LENGTH,
  hasLeadQueueFilters,
  leadQueueParamsFromDefinition,
  leadQueueSignature,
  leadQueueSort,
  leadViewDefinitionFromQueue,
  type LeadQueueParams,
  type LeadSavedView,
} from '@/lib/leads/work-queue';

interface LeadSavedViewsProps {
  currentParams: LeadQueueParams;
  selectedViewId: string;
  onApply: (params: LeadQueueParams, viewId?: string | null) => void;
}

type NameDialogMode = 'create' | 'rename' | null;

export function LeadSavedViews({
  currentParams,
  selectedViewId,
  onApply,
}: LeadSavedViewsProps) {
  const [views, setViews] = useState<LeadSavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogMode>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const selectedView = views.find((view) => view.id === selectedViewId) ?? null;
  const currentSignature = leadQueueSignature(currentParams);
  const selectedSignature = selectedView
    ? leadQueueSignature(leadQueueParamsFromDefinition(selectedView.definition))
    : null;
  const modified = Boolean(selectedView && currentSignature !== selectedSignature);
  const hasCustomState = hasLeadQueueFilters(currentParams)
    || leadQueueSort(currentParams).sort !== 'created_at'
    || leadQueueSort(currentParams).order !== 'desc';

  const selectValue = selectedView
    ? selectedView.id
    : hasCustomState
      ? '__custom'
      : '__all';

  const loadViews = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch('/api/admin/leads/views');
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not load saved views');
      setViews(data.views ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  const sortedViews = useMemo(
    () => [...views].sort((a, b) => a.name.localeCompare(b.name)),
    [views]
  );

  function openNameDialog(mode: Exclude<NameDialogMode, null>) {
    setName(mode === 'rename' ? selectedView?.name ?? '' : '');
    setNameDialog(mode);
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const creating = nameDialog === 'create';
      const response = await fetch(
        creating ? '/api/admin/leads/views' : `/api/admin/leads/views/${selectedView?.id}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            creating
              ? { name: trimmed, definition: leadViewDefinitionFromQueue(currentParams) }
              : { name: trimmed }
          ),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not save view');
      const saved = data.view as LeadSavedView;
      setViews((current) => {
        const remaining = current.filter((view) => view.id !== saved.id);
        return [...remaining, saved];
      });
      setNameDialog(null);
      if (creating) onApply(currentParams, saved.id);
      toast.success(creating ? 'View saved' : 'View renamed');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not save view');
    } finally {
      setSaving(false);
    }
  }

  async function updateDefinition() {
    if (!selectedView) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/leads/views/${selectedView.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: leadViewDefinitionFromQueue(currentParams) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not update view');
      const saved = data.view as LeadSavedView;
      setViews((current) => current.map((view) => (view.id === saved.id ? saved : view)));
      toast.success('View updated');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not update view');
    } finally {
      setSaving(false);
    }
  }

  async function deleteView() {
    if (!selectedView) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/leads/views/${selectedView.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not delete view');
      setViews((current) => current.filter((view) => view.id !== selectedView.id));
      setDeleteOpen(false);
      onApply(currentParams, null);
      toast.success('View deleted');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not delete view');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <Button variant="outline" className="h-11" onClick={() => void loadViews()}>
        <RefreshCw />
        Retry saved views
      </Button>
    );
  }

  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <Select
          value={selectValue}
          disabled={loading}
          onValueChange={(value) => {
            if (!value || value === '__custom') return;
            if (value === '__all') {
              onApply({}, null);
              return;
            }
            const view = views.find((item) => item.id === value);
            if (view) onApply(leadQueueParamsFromDefinition(view.definition), view.id);
          }}
        >
          <SelectTrigger className="min-w-0 rounded-none border-0 border-b bg-transparent px-0 shadow-none data-[size=default]:h-11 sm:w-[180px]" aria-label="Saved view">
            <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue>
              {loading
                ? 'Loading views…'
                : selectedView
                  ? `${selectedView.name}${modified ? ' · Modified' : ''}`
                  : hasCustomState
                    ? 'Custom view'
                    : 'All leads'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all" className="min-h-11">All leads</SelectItem>
            {!selectedView && hasCustomState && (
              <SelectItem value="__custom" className="min-h-11" disabled>Custom view</SelectItem>
            )}
            {sortedViews.map((view) => (
              <SelectItem key={view.id} value={view.id} className="min-h-11">{view.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {modified && (
          <Button variant="secondary" className="h-11" disabled={saving} onClick={() => void updateDefinition()}>
            <Save />
            <span className="hidden lg:inline">Update</span>
          </Button>
        )}

        <Button
          variant="outline"
          className="h-11"
          disabled={loading}
          onClick={() => openNameDialog('create')}
        >
          <Plus />
          <span className="hidden lg:inline">Save view</span>
          <span className="sr-only lg:hidden">Save current view</span>
        </Button>

        {selectedView && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Manage ${selectedView.name}`}
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="min-h-11" onClick={() => openNameDialog('rename')}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 />
                Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog open={nameDialog !== null} onOpenChange={(open) => !open && setNameDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{nameDialog === 'rename' ? 'Rename saved view' : 'Save current view'}</DialogTitle>
            <DialogDescription>
              {nameDialog === 'rename'
                ? 'Use a short name your team workflow makes easy to recognize.'
                : 'This saves the current filters and sort order for your account.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lead-view-name">View name</Label>
            <Input
              id="lead-view-name"
              value={name}
              maxLength={LEAD_VIEW_NAME_MAX_LENGTH}
              className="h-11"
              autoFocus
              placeholder="Hot leads in Arizona"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() && !saving) void saveName();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" disabled={saving} onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button className="h-11" disabled={saving || !name.trim()} onClick={() => void saveName()}>
              {saving ? 'Saving…' : nameDialog === 'rename' ? 'Rename' : 'Save view'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{selectedView?.name}”?</DialogTitle>
            <DialogDescription>
              This removes the shortcut only. It does not change or delete any leads.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" disabled={saving} onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="h-11" disabled={saving} onClick={() => void deleteView()}>
              {saving ? 'Deleting…' : 'Delete view'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
