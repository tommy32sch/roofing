import type { OutboxEntry } from './outbox';
import type { TerritoryPackage } from './territory-package';

/**
 * IndexedDB adapter for offline data.
 *
 * IndexedDB rather than localStorage because this has to survive a locked
 * phone, a backgrounded tab and a browser reclaiming memory — localStorage is
 * synchronous, small, and cleared more eagerly by mobile Safari under pressure.
 * A lost field result is the failure this whole feature exists to prevent.
 *
 * Reads fail soft because a temporary browser-storage problem must not crash
 * the map. Writes return an explicit boolean: the UI may only tell a rep their
 * result is saved after IndexedDB has committed the transaction.
 *
 * Two stores, with deliberately different failure meanings. The outbox holds
 * work that exists ONLY on the device until it syncs, so losing it loses a
 * rep's afternoon. Packages are a cache of server data, so losing one costs a
 * re-download and nothing else.
 */

const DB_NAME = 'roof-leads-offline';
/** v2 added the packages store. v1 databases upgrade in place, keeping the outbox. */
const DB_VERSION = 2;
const STORE_OUTBOX = 'outbox';
const STORE_PACKAGES = 'packages';

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Guarded rather than recreated: a rep upgrading from v1 mid-shift must
      // keep every queued result they have not synced yet.
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PACKAGES)) {
        db.createObjectStore(STORE_PACKAGES, { keyPath: 'territoryId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Another tab holding an old version open would otherwise hang forever.
    request.onblocked = () => resolve(null);
  });
}

async function read<T>(
  storeName: string,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    let request: IDBRequest<T>;
    try {
      request = run(db.transaction(storeName, 'readonly').objectStore(storeName));
    } catch {
      db.close();
      resolve(null);
      return;
    }
    request.onsuccess = () => {
      resolve(request.result);
      db.close();
    };
    request.onerror = () => {
      resolve(null);
      db.close();
    };
  });
}

/**
 * Resolve true only after the write transaction commits.
 *
 * IDBRequest success is not enough: the surrounding transaction can still
 * abort (for example on quota exhaustion) after that event.
 */
async function write(
  storeName: string,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      db.close();
      resolve(ok);
    };

    try {
      const transaction = db.transaction(storeName, 'readwrite');
      run(transaction.objectStore(storeName));
      transaction.oncomplete = () => finish(true);
      transaction.onerror = () => finish(false);
      transaction.onabort = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

// --- Outbox: work that exists only on this device until it syncs -------------

export async function readAll(): Promise<OutboxEntry[] | null> {
  return read<OutboxEntry[]>(STORE_OUTBOX, (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
}

export async function put(entry: OutboxEntry): Promise<boolean> {
  return write(STORE_OUTBOX, (s) => s.put(entry));
}

export async function remove(id: string): Promise<boolean> {
  return write(STORE_OUTBOX, (s) => s.delete(id));
}

export async function clear(): Promise<boolean> {
  return write(STORE_OUTBOX, (s) => s.clear());
}

// --- Packages: a cache of server data, safe to lose and re-download ----------

export async function readPackages(): Promise<TerritoryPackage[] | null> {
  return read<TerritoryPackage[]>(STORE_PACKAGES, (s) => s.getAll() as IDBRequest<TerritoryPackage[]>);
}

export async function readPackage(territoryId: string): Promise<TerritoryPackage | null> {
  return read<TerritoryPackage>(STORE_PACKAGES, (s) => s.get(territoryId) as IDBRequest<TerritoryPackage>);
}

export async function putPackage(pkg: TerritoryPackage): Promise<boolean> {
  return write(STORE_PACKAGES, (s) => s.put(pkg));
}

export async function removePackage(territoryId: string): Promise<boolean> {
  return write(STORE_PACKAGES, (s) => s.delete(territoryId));
}

export async function clearPackages(): Promise<boolean> {
  return write(STORE_PACKAGES, (s) => s.clear());
}
