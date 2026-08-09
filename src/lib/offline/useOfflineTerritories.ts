'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  readPackages,
  putPackage,
  removePackage,
  clearPackages,
} from './store';
import {
  isUsablePackage,
  estimatePackageBytes,
  totalStorageBytes,
  packageFreshness,
  type TerritoryPackage,
} from './territory-package';
import { useAppShell } from '@/components/providers/app-shell-provider';

/**
 * Territories a rep has taken offline.
 *
 * Owns the whole lifecycle — what is downloaded, how big it is, how old, and
 * removing it — so the territory list and the storage screen cannot disagree
 * about what is on the device.
 *
 * Packages belonging to a different account are filtered out on read rather
 * than deleted. A shared phone is the normal case in this business: two reps
 * take turns, and wiping the other one's download every time somebody signs in
 * would mean neither of them ever has data when they need it.
 */

export interface OfflineTerritoryEntry {
  pkg: TerritoryPackage;
  bytes: number;
  ageMs: number;
  stale: boolean;
}

export function useOfflineTerritories(repId: string | null) {
  const { connection } = useAppShell();
  const [entries, setEntries] = useState<OfflineTerritoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);

  const refresh = useCallback(async () => {
    if (!repId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    const stored = await readPackages();
    if (stored === null) {
      // Null means IndexedDB itself was unavailable, which is different from
      // "nothing downloaded" and worth telling the rep about.
      setStorageError(true);
      setEntries([]);
      setLoading(false);
      return;
    }
    setStorageError(false);
    const now = Date.now();
    setEntries(
      stored
        .filter((p) => isUsablePackage(p, repId))
        .map((pkg) => ({
          pkg,
          bytes: estimatePackageBytes(pkg),
          ...packageFreshness(pkg, now),
        }))
        .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
    );
    setLoading(false);
  }, [repId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Fetch a territory's work set and store it.
   *
   * The local date goes to the server because "due today" is a question only
   * the device can answer — the rep's timezone is the one that decides which
   * follow-ups are overdue, not the server's.
   */
  const download = useCallback(
    async (territoryId: string): Promise<{ ok: boolean; error?: string }> => {
      setDownloading(territoryId);
      try {
        const today = new Date();
        const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const res = await fetch(
          `/api/admin/territories/${territoryId}/package?date=${localDate}`
        );
        const body = await res.json();
        if (!body?.success || !body.package) {
          return { ok: false, error: body?.error ?? 'Could not download this territory' };
        }
        const written = await putPackage(body.package as TerritoryPackage);
        if (!written) {
          // Almost always the storage quota. Saying so beats a generic failure,
          // because the fix — remove another territory — is something the rep
          // can actually do from this screen.
          return { ok: false, error: 'Could not save to this device. Free up space and try again.' };
        }
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server' };
      } finally {
        setDownloading(null);
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (territoryId: string) => {
      await removePackage(territoryId);
      await refresh();
    },
    [refresh]
  );

  const removeAll = useCallback(async () => {
    await clearPackages();
    await refresh();
  }, [refresh]);

  const isDownloaded = useCallback(
    (territoryId: string) => entries.some((e) => e.pkg.territoryId === territoryId),
    [entries]
  );

  return {
    entries,
    loading,
    downloading,
    online: connection.online,
    storageError,
    totalBytes: totalStorageBytes(entries.map((e) => e.pkg)),
    download,
    remove,
    removeAll,
    isDownloaded,
    refresh,
  };
}
