import type { OutboxEntry } from './outbox';

/**
 * IndexedDB adapter for the outbox.
 *
 * IndexedDB rather than localStorage because this has to survive a locked
 * phone, a backgrounded tab and a browser reclaiming memory — localStorage is
 * synchronous, small, and cleared more eagerly by mobile Safari under pressure.
 * A lost knock is the failure this whole feature exists to prevent.
 *
 * Reads fail soft because a temporary browser-storage problem must not crash
 * the map. Writes return an explicit boolean: the UI may only tell a rep their
 * knock is saved after IndexedDB has committed the transaction.
 */

const DB_NAME = 'roof-leads-offline';
const DB_VERSION = 1;
const STORE = 'outbox';

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Another tab holding an old version open would otherwise hang forever.
    request.onblocked = () => resolve(null);
  });
}

async function read<T>(
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    let request: IDBRequest<T>;
    try {
      request = run(db.transaction(STORE, 'readonly').objectStore(STORE));
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

export async function readAll(): Promise<OutboxEntry[] | null> {
  return read<OutboxEntry[]>((s) => s.getAll() as IDBRequest<OutboxEntry[]>);
}

/**
 * Resolve true only after the write transaction commits.
 *
 * IDBRequest success is not enough: the surrounding transaction can still
 * abort (for example on quota exhaustion) after that event.
 */
async function write(run: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
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
      const transaction = db.transaction(STORE, 'readwrite');
      run(transaction.objectStore(STORE));
      transaction.oncomplete = () => finish(true);
      transaction.onerror = () => finish(false);
      transaction.onabort = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

export async function put(entry: OutboxEntry): Promise<boolean> {
  return write((s) => s.put(entry));
}

export async function remove(id: string): Promise<boolean> {
  return write((s) => s.delete(id));
}

export async function clear(): Promise<boolean> {
  return write((s) => s.clear());
}
