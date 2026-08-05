'use client';

import { HardDrive, Trash2, WifiOff, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes, formatAge, packagedLeadCount } from '@/lib/offline/territory-package';
import type { OfflineTerritoryEntry } from '@/lib/offline/useOfflineTerritories';

interface OfflineStoragePanelProps {
  entries: OfflineTerritoryEntry[];
  totalBytes: number;
  online: boolean;
  storageError: boolean;
  onRemove: (territoryId: string) => void;
  onRemoveAll: () => void;
}

/**
 * What this device is holding offline.
 *
 * Shows size and age per territory because those are the two things a rep
 * decides on: whether it is worth the space, and whether it is old enough to
 * need refreshing before heading out.
 *
 * Renders nothing when nothing is downloaded — an empty storage panel on every
 * visit is clutter, and the download controls live on the territory cards where
 * the decision is actually made.
 */
export function OfflineStoragePanel({
  entries,
  totalBytes,
  online,
  storageError,
  onRemove,
  onRemoveAll,
}: OfflineStoragePanelProps) {
  if (storageError) {
    return (
      <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium">Offline storage unavailable</p>
          <p className="text-xs text-muted-foreground">
            This browser is blocking local storage, often private browsing. Territories
            cannot be downloaded, and results recorded without signal may not be kept.
          </p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">
          {entries.length} territor{entries.length === 1 ? 'y' : 'ies'} on this device
        </span>
        <span className="text-xs text-muted-foreground">{formatBytes(totalBytes)}</span>
        {!online && (
          <span className="ml-auto flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
            <WifiOff className="h-3.5 w-3.5" />
            offline
          </span>
        )}
      </div>

      {entries.map(({ pkg, bytes, ageMs, stale }) => (
        <div key={pkg.territoryId} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{pkg.name}</p>
            <p className="text-xs text-muted-foreground">
              {packagedLeadCount(pkg)} door{packagedLeadCount(pkg) === 1 ? '' : 's'} · {formatBytes(bytes)} ·{' '}
              {/* Stale is a prompt, not a block: the houses are still right,
                  what may be missing is a door a colleague knocked this morning. */}
              <span className={stale ? 'text-amber-600 dark:text-amber-500' : undefined}>
                {formatAge(ageMs)}
                {stale ? ' — refresh when you have signal' : ''}
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(pkg.territoryId)}
            aria-label={`Remove ${pkg.name} from this device`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {entries.length > 1 && (
        <div className="px-3 py-2">
          <Button variant="ghost" size="sm" onClick={onRemoveAll}>
            Remove all downloads
          </Button>
        </div>
      )}
    </div>
  );
}
