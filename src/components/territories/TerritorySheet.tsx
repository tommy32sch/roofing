'use client';

import { Archive, MapPinned, Pencil, RotateCcw, ScanLine, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Territory } from '@/types';

interface TerritorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  territories: Territory[];
  leadCounts: Record<string, number>;
  loading: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  onSelectLeads?: (territory: Territory) => void;
  onEdit: (territory: Territory) => void;
  onEditBoundary: (territory: Territory) => void;
  onArchiveChange: (territory: Territory, archived: boolean) => void;
  pendingTerritoryId?: string | null;
}

export function TerritorySheet({
  open,
  onOpenChange,
  territories,
  leadCounts,
  loading,
  isAdmin,
  currentUserId,
  showArchived,
  onShowArchivedChange,
  onSelectLeads,
  onEdit,
  onEditBoundary,
  onArchiveChange,
  pendingTerritoryId = null,
}: TerritorySheetProps) {
  const visible = territories.filter((territory) => showArchived || !territory.archived_at);
  const activeCount = territories.filter((territory) => !territory.archived_at).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(92vw,28rem)] p-4 sm:max-w-md">
        <SheetHeader className="p-0">
          <SheetTitle>Territories</SheetTitle>
          <SheetDescription>
            {activeCount} active area{activeCount !== 1 ? 's' : ''}. Select shown leads when
            you are ready to use the existing assignment workflow.
          </SheetDescription>
        </SheetHeader>

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
              <p className="text-sm font-medium">No territories yet</p>
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
