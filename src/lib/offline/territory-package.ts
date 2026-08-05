/**
 * A territory downloaded for offline canvassing.
 *
 * The rep taps Download while they still have signal, and everything needed to
 * work that territory with none — the boundary, the doors, their own identity —
 * is written to the device. Nothing is fetched lazily: a package that needs the
 * network to be useful is not an offline package.
 *
 * Map tiles are deliberately NOT included. OpenStreetMap's terms forbid bulk
 * downloading them, and a paid provider was not worth it for the first version.
 * Offline, the map draws the territory outline, the doors and the rep's own
 * position on a plain background. That is enough to know which house is next
 * and where you are relative to it; streets come back with signal.
 */

/**
 * Bumped whenever the stored shape changes.
 *
 * A package written by an older build is discarded rather than migrated. It is
 * a cache of server data, so throwing it away costs one re-download — whereas
 * feeding a stale shape to the execution screen would show a rep the wrong
 * doors, which is the failure worth preventing.
 */
export const PACKAGE_SCHEMA_VERSION = 1;

/** Older than this and the package is shown as stale, though still usable. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export interface PackagedLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address_street: string | null;
  address_city: string | null;
  latitude: number;
  longitude: number;
  status: string | null;
  priority: string | null;
  phone: string | null;
  do_not_knock?: boolean | null;
  is_dnc?: boolean | null;
  last_knock_at?: string | null;
  last_disposition?: string | null;
  knock_count?: number | null;
  follow_up_date?: string | null;
}

export interface TerritoryPackage {
  schemaVersion: number;
  territoryId: string;
  name: string;
  boundary: [number, number][];
  leads: PackagedLead[];
  /** Who downloaded it, so another rep signing in cannot read it. */
  repId: string;
  downloadedAt: string;
}

export function buildTerritoryPackage(input: {
  territoryId: string;
  name: string;
  boundary: [number, number][];
  leads: PackagedLead[];
  repId: string;
  downloadedAt: string;
}): TerritoryPackage {
  return { schemaVersion: PACKAGE_SCHEMA_VERSION, ...input };
}

/**
 * Whether a stored package can still be used.
 *
 * Ownership is part of validity, not a separate check. Phones get shared and
 * accounts get switched, and a package is a snapshot of leads someone was
 * authorised to see at download time — showing it to whoever signs in next
 * would leak exactly the data the visibility rules exist to scope.
 */
export function isUsablePackage(pkg: unknown, repId: string): pkg is TerritoryPackage {
  if (!pkg || typeof pkg !== 'object') return false;
  const p = pkg as Partial<TerritoryPackage>;
  if (p.schemaVersion !== PACKAGE_SCHEMA_VERSION) return false;
  if (typeof p.territoryId !== 'string' || !p.territoryId) return false;
  if (!Array.isArray(p.leads) || !Array.isArray(p.boundary)) return false;
  if (p.repId !== repId) return false;
  return true;
}

/**
 * Rough size on disk.
 *
 * Measured from the JSON encoding rather than tracked separately: the number is
 * shown to a rep deciding whether to download over cellular, where "about 400
 * KB" and "about 4 MB" are the only distinction that matters. Exactness would
 * cost more than it is worth.
 */
export function estimatePackageBytes(pkg: TerritoryPackage): number {
  try {
    // Byte length, not string length — addresses and names are not all ASCII.
    return new TextEncoder().encode(JSON.stringify(pkg)).length;
  } catch {
    return 0;
  }
}

export function totalStorageBytes(packages: TerritoryPackage[]): number {
  return packages.reduce((sum, p) => sum + estimatePackageBytes(p), 0);
}

/** "412 KB" / "1.4 MB" — sized for a rep glancing at it, not for accounting. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return '1 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * How stale a package is, as something a rep can act on.
 *
 * Stale does not mean unusable. A twelve-hour-old package still lists the right
 * houses; what it may miss is a door a colleague knocked this morning. Saying
 * "downloaded 14 hours ago" lets the rep decide whether to refresh, which is
 * better than silently refusing to open it.
 */
export function packageFreshness(
  pkg: TerritoryPackage,
  now: number
): { ageMs: number; stale: boolean } {
  const downloaded = Date.parse(pkg.downloadedAt);
  if (Number.isNaN(downloaded)) return { ageMs: Infinity, stale: true };
  const ageMs = Math.max(0, now - downloaded);
  return { ageMs, stale: ageMs > STALE_AFTER_MS };
}

/** "just now" / "3 hours ago" / "2 days ago". */
export function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return 'unknown';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
