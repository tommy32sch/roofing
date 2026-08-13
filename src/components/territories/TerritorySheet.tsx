'use client';

import {
  Archive,
  CalendarClock,
  MapPinned,
  Pencil,
  Play,
  RotateCcw,
  ScanLine,
  UserRound, Download, Check, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useOfflineTerritories } from '@/lib/offline/useOfflineTerritories';
import { OfflineStoragePanel } from './OfflineStoragePanel';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { TerritoryExecutionSummary } from '@/lib/territories/execution';
import type { Territory } from '@/types';

const STATUS_PRESENTATION: Record<
  TerritoryExecutionSummary['state'],
  { label: string; className: string }
> = {
  empty: {
    label: 'Empty',
    className: 'bg-muted text-muted-foreground',
  },
  not_started: {
    label: 'Not started',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  active: {
    label: 'Active',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  },
  stalled: {
    label: 'Stalled',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  complete: {
    label: 'Complete',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
  },
};

function sortTerritories(
  territories: Territory[],
  isAdmin: boolean,
  currentUserId: string | null,
  progressByTerritory: Record<string, TerritoryExecutionSummary>
) {
  return territories
    .map((territory, originalIndex) => ({ territory, originalIndex }))
    .sort((a, b) => {
      if (isAdmin) {
        const aStalled =
          !a.territory.archived_at &&
          progressByTerritory[a.territory.id]?.state === 'stalled';
        const bStalled =
          !b.territory.archived_at &&
          progressByTerritory[b.territory.id]?.state === 'stalled';

        return Number(bStalled) - Number(aStalled) || a.originalIndex - b.originalIndex;
      }

      const aOwned =
        !!currentUserId && a.territory.owner_user_id === currentUserId;
      const bOwned =
        !!currentUserId && b.territory.owner_user_id === currentUserId;

      return Number(bOwned) - Number(aOwned) || a.originalIndex - b.originalIndex;
    })
    .map(({ territory }) => territory);
}

interface TerritorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  territories: Territory[];
  leadCounts: Record<string, number>;
  progressByTerritory: Record<string, TerritoryExecutionSummary>;
  progressLoading: boolean;
  loading: boolean;
  isAdmin: boolean;
  canExecute: boolean;
  currentUserId: string | null;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  onSelectLeads?: (territory: Territory) => void;
  onEdit: (territory: Territory) => void;
  onEditBoundary: (territory: Territory) => void;
  onArchiveChange: (territory: Territory, archived: boolean) => void;
  onResume: (territory: Territory) => void;
  pendingTerritoryId?: string | null;
}

export function TerritorySheet({
  open,
  onOpenChange,
  territories,
  leadCounts,
  progressByTerritory,
  progressLoading,
  loading,
  isAdmin,
  canExecute,
  currentUserId,
  showArchived,
  onShowArchivedChange,
  onSelectLeads,
  onEdit,
  onEditBoundary,
  onArchiveChange,
  onResume,
  pendingTerritoryId = null,
}: TerritorySheetProps) {
  const visible = sortTerritories(
    territories.filter((territory) => showArchived || !territory.archived_at),
    isAdmin,
    currentUserId,
    progressByTerritory
  );
  const offline = useOfflineTerritories(currentUserId);
  const activeCount = territories.filter((territory) => !territory.archived_at).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(92vw,28rem)] p-4 sm:max-w-md">
        <SheetHeader className="p-0">
          <SheetTitle>Territories</SheetTitle>
          <SheetDescription>
            {activeCount} active area{activeCount !== 1 ? 's' : ''}. Resume field work or use
            the existing assignment workflow for shown leads.
          </SheetDescription>
        </SheetHeader>

        {/* What is already on the device. Renders nothing until something is
            downloaded, so it does not clutter the common case. */}
        {canExecute && (
          <OfflineStoragePanel
            entries={offline.entries}
            totalBytes={offline.totalBytes}
            online={offline.online}
            storageError={offline.storageError}
            onRemove={(id) => void offline.remove(id)}
            onRemoveAll={() => void offline.removeAll()}
          />
        )}

        {isAdmin && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(checked) => onShowArchivedChange(checked === true)}
            />
            Show archived
          </label>
        )}

        <div className="flex-1 space-y-2 overflow-y-auto">
          {loading && (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              Loading territories...
            </p>
          )}
          {!loading && visible.length === 0 && (
            <div className="rounded-md border border-dashed p-5 text-center">
              <MapPinned className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isAdmin ? 'No territories yet' : 'No territories assigned to you'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAdmin
                  ? 'Close this panel and choose New territory to draw the first one.'
                  : 'An admin can draw and assign territories from this map.'}
              </p>
            </div>
          )}

          {visible.map((territory) => {
            const archived = !!territory.archived_at;
            const ownedByCurrentUser =
              !!currentUserId && territory.owner_user_id === currentUserId;
            const count = leadCounts[territory.id] ?? 0;
            const progress = progressByTerritory[territory.id];
            const status = progress ? STATUS_PRESENTATION[progress.state] : null;
            return (
              <div
                key={territory.id}
                className={`rounded-md border p-3 ${archived ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1 h-4 w-4 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: territory.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{territory.name}</p>
                      {ownedByCurrentUser && !archived && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Yours
                        </span>
                      )}
                      {isAdmin && !archived && status && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      )}
                      {archived && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <UserRound className="h-3 w-3" />
                      {territory.owner_name ?? 'Unassigned'}
                      <span aria-hidden>·</span>
                      {count} shown lead{count !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {!archived && canExecute && (
                  <div className="mt-3 rounded-md bg-muted/45 p-2.5">
                    {progress ? (
                      <>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium">
                            {progress.coverage_percent}% worked
                          </span>
                          <span className="text-muted-foreground">
                            {progress.total_leads} address{progress.total_leads !== 1 ? 'es' : ''}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background"
                          role="progressbar"
                          aria-label={`${territory.name} coverage`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress.coverage_percent}
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{
                              width: `${Math.min(100, Math.max(0, progress.coverage_percent))}%`,
                            }}
                          />
                        </div>
                        <dl className="mt-2 grid grid-cols-5 gap-1 text-center">
                          <div title="Appointments">
                            <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                              Appts
                            </dt>
                            <dd className="text-xs font-semibold">{progress.progress.appointment}</dd>
                          </div>
                          <div title="Follow-ups">
                            <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                              Follow-up
                            </dt>
                            <dd className="text-xs font-semibold">{progress.progress.follow_up}</dd>
                          </div>
                          <div title="Contacted">
                            <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                              Contacted
                            </dt>
                            <dd className="text-xs font-semibold">{progress.progress.contacted}</dd>
                          </div>
                          <div title="Knocked">
                            <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                              Knocked
                            </dt>
                            <dd className="text-xs font-semibold">{progress.progress.knocked}</dd>
                          </div>
                          <div title="Unworked">
                            <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                              Unworked
                            </dt>
                            <dd className="text-xs font-semibold">{progress.progress.unworked}</dd>
                          </div>
                        </dl>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <RotateCcw className="h-3 w-3" />
                            {progress.revisits.due} revisit{progress.revisits.due !== 1 ? 's' : ''} due
                          </span>
                          {progress.revisits.needs_schedule > 0 && (
                            <span className="flex items-center gap-1">
                              <CalendarClock className="h-3 w-3" />
                              {progress.revisits.needs_schedule} need
                              {progress.revisits.needs_schedule === 1 ? 's' : ''} scheduling
                            </span>
                          )}
                          {progress.blocked_leads > 0 && (
                            <span>
                              {progress.blocked_leads} not actionable
                            </span>
                          )}
                          {isAdmin && (
                            <span>
                              {progress.last_field_activity_at
                                ? `Last field activity ${formatDistanceToNow(
                                    new Date(progress.last_field_activity_at),
                                    { addSuffix: true }
                                  )}`
                                : 'No field activity yet'}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {progressLoading ? 'Loading progress...' : 'Progress unavailable'}
                      </p>
                    )}
                  </div>
                )}

                {!archived && canExecute && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        onResume(territory);
                        onOpenChange(false);
                      }}
                    >
                      <Play className="mr-1 h-4 w-4" />
                      {progress?.never_started ? 'Start Work' : 'Resume Work'}
                    </Button>
                    {/* Downloading needs signal, so the control is disabled
                        offline rather than hidden — a rep who forgot to
                        download should see why, not wonder where it went. */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offline.downloading !== null || !offline.online}
                      onClick={async () => {
                        const result = await offline.download(territory.id);
                        if (result.ok) toast.success(`${territory.name} saved for offline use`);
                        else toast.error(result.error ?? 'Could not download this territory');
                      }}
                      title={
                        !offline.online
                          ? 'Downloading needs a connection'
                          : offline.isDownloaded(territory.id)
                            ? 'Downloaded — tap to refresh with the latest doors'
                            : 'Save this territory for working without signal'
                      }
                      aria-label={
                        offline.isDownloaded(territory.id)
                          ? `Refresh ${territory.name} offline copy`
                          : `Download ${territory.name} for offline use`
                      }
                    >
                      {offline.downloading === territory.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : offline.isDownloaded(territory.id) ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                )}

                {!archived && onSelectLeads && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => {
                      onSelectLeads(territory);
                      onOpenChange(false);
                    }}
                  >
                    <ScanLine className="h-4 w-4 mr-1" />
                    Select {count} shown lead{count !== 1 ? 's' : ''}
                  </Button>
                )}

                {isAdmin && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {!archived && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(territory)}
                          disabled={pendingTerritoryId != null}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Details
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onEditBoundary(territory);
                            onOpenChange(false);
                          }}
                          disabled={pendingTerritoryId != null}
                        >
                          <ScanLine className="h-3.5 w-3.5 mr-1" />
                          Boundary
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={archived ? 'col-span-2' : 'col-span-2 text-muted-foreground'}
                      onClick={() => onArchiveChange(territory, !archived)}
                      disabled={pendingTerritoryId != null}
                    >
                      {archived ? (
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <Archive className="h-3.5 w-3.5 mr-1" />
                      )}
                      {pendingTerritoryId === territory.id
                        ? archived
                          ? 'Restoring...'
                          : 'Archiving...'
                        : archived
                          ? 'Restore'
                          : 'Archive'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
