/**
 * Back up every application table and private Storage object.
 *
 *   npm run backup
 *
 * Development and production currently share one database, so production is
 * the only copy of the real data. Run this before anything destructive — a
 * bulk delete, a migration, a backfill, or any script run with --allow-prod.
 *
 * This script is read-only with respect to Supabase: it only selects rows and
 * lists/downloads Storage objects. It writes a versioned backup directory under
 * backups/ (gitignored) containing database.json, private photo bytes, and a
 * manifest with the original object paths and SHA-256 checksums.
 *
 * Restore remains deliberately manual — see docs/DATABASE_SETUP.md. Blindly
 * replaying a dump is how one bad backup becomes two lost datasets.
 */

import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  BACKUP_STORAGE_BUCKETS,
  BACKUP_TABLES,
  storageObjectLocalPath,
} from './lib/backup-manifest';

const TABLE_PAGE = 1000;
const STORAGE_PAGE = 100;
const FORMAT_VERSION = 1;

type TableResult = {
  name: string;
  status: 'backed_up' | 'not_present' | 'error';
  rowCount?: number;
  error?: string;
};

type ListedStorageObject = {
  id: string;
  path: string;
  createdAt: string | null;
  updatedAt: string | null;
  listedSizeBytes: number | null;
  listedContentType: string | null;
};

type StorageObjectResult = {
  originalPath: string;
  localPath: string;
  storageId: string;
  sizeBytes: number;
  sha256: string;
  contentType: string | null;
  storageCreatedAt: string | null;
  storageUpdatedAt: string | null;
};

type StorageBucketResult = {
  name: string;
  status: 'backed_up' | 'error';
  public?: boolean;
  fileSizeLimit?: number | null;
  allowedMimeTypes?: string[] | null;
  listedObjectCount: number;
  backedUpObjectCount: number;
  objects: StorageObjectResult[];
  errors: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function absoluteArtifactPath(backupDir: string, relativePath: string): string {
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe backup artifact path: ${relativePath}`);
  }
  return join(backupDir, ...segments);
}

async function exportTable(
  supabase: SupabaseClient,
  table: string
): Promise<{ result: TableResult; rows?: unknown[] }> {
  const rows: unknown[] = [];

  // Page explicitly — a plain select silently caps at 1000 rows.
  for (let from = 0; ; from += TABLE_PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + TABLE_PAGE - 1);
    if (error) {
      if (/does not exist|schema cache|not find the table/i.test(error.message)) {
        return { result: { name: table, status: 'not_present' } };
      }
      return { result: { name: table, status: 'error', error: error.message } };
    }

    rows.push(...(data ?? []));
    if (!data || data.length < TABLE_PAGE) break;
  }

  return { result: { name: table, status: 'backed_up', rowCount: rows.length }, rows };
}

async function listStorageObjects(
  supabase: SupabaseClient,
  bucket: string,
  prefix = ''
): Promise<ListedStorageObject[]> {
  const objects: ListedStorageObject[] = [];
  const storage = supabase.storage.from(bucket);

  for (let offset = 0; ; offset += STORAGE_PAGE) {
    const { data, error } = await storage.list(prefix, {
      limit: STORAGE_PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`could not list ${bucket}/${prefix}: ${error.message}`);

    for (const item of data) {
      const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        objects.push(...(await listStorageObjects(supabase, bucket, objectPath)));
        continue;
      }

      objects.push({
        id: item.id,
        path: objectPath,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        listedSizeBytes:
          typeof item.metadata?.size === 'number' ? item.metadata.size : null,
        listedContentType:
          typeof item.metadata?.mimetype === 'string' ? item.metadata.mimetype : null,
      });
    }

    if (data.length < STORAGE_PAGE) break;
  }

  return objects;
}

async function exportStorageBucket(
  supabase: SupabaseClient,
  bucket: string,
  backupDir: string
): Promise<StorageBucketResult> {
  const result: StorageBucketResult = {
    name: bucket,
    status: 'backed_up',
    listedObjectCount: 0,
    backedUpObjectCount: 0,
    objects: [],
    errors: [],
  };

  const { data: bucketConfig, error: bucketError } = await supabase.storage.getBucket(bucket);
  if (bucketError) {
    result.status = 'error';
    result.errors.push(`could not read bucket configuration: ${bucketError.message}`);
    return result;
  }

  result.public = bucketConfig.public;
  result.fileSizeLimit = bucketConfig.file_size_limit ?? null;
  result.allowedMimeTypes = bucketConfig.allowed_mime_types ?? null;

  let listed: ListedStorageObject[];
  try {
    listed = await listStorageObjects(supabase, bucket);
  } catch (error) {
    result.status = 'error';
    result.errors.push(errorMessage(error));
    return result;
  }

  listed.sort((left, right) => left.path.localeCompare(right.path));
  result.listedObjectCount = listed.length;
  const localPaths = new Set<string>();

  for (const object of listed) {
    try {
      const { data, error } = await supabase.storage.from(bucket).download(object.path);
      if (error) throw new Error(error.message);
      if (!data) throw new Error('download returned no data');

      const bytes = Buffer.from(await data.arrayBuffer());
      if (object.listedSizeBytes !== null && bytes.length !== object.listedSizeBytes) {
        throw new Error(
          `size changed while backing up (listed ${object.listedSizeBytes}, downloaded ${bytes.length})`
        );
      }

      const localPath = storageObjectLocalPath(bucket, object.path);
      if (localPaths.has(localPath)) throw new Error(`duplicate local path: ${localPath}`);
      localPaths.add(localPath);

      const absolutePath = absoluteArtifactPath(backupDir, localPath);
      mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
      chmodSync(dirname(absolutePath), 0o700);
      writeFileSync(absolutePath, bytes, { mode: 0o600 });

      result.objects.push({
        originalPath: object.path,
        localPath,
        storageId: object.id,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        contentType: data.type || object.listedContentType,
        storageCreatedAt: object.createdAt,
        storageUpdatedAt: object.updatedAt,
      });
      result.backedUpObjectCount++;
    } catch (error) {
      result.status = 'error';
      result.errors.push(`${object.path}: ${errorMessage(error)}`);
    }
  }

  return result;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key);
  const masked = url.replace(/(https:\/\/)([a-z]{4})[a-z0-9]*(\.)/i, '$1$2•••••$3');
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const backupsDir = join(process.cwd(), 'backups');
  const workingDir = join(backupsDir, `backup-${stamp}.in-progress`);
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  chmodSync(backupsDir, 0o700);
  mkdirSync(workingDir, { recursive: false, mode: 0o700 });

  console.log(`\n  backing up : ${masked}`);
  console.log(`  APP_DB_ENV : ${process.env.APP_DB_ENV || '(not set)'}\n`);

  const databaseTables: Record<string, unknown[]> = {};
  const tableResults: TableResult[] = [];
  const errors: string[] = [];

  for (const table of BACKUP_TABLES) {
    const { result, rows } = await exportTable(supabase, table);
    tableResults.push(result);
    if (rows) databaseTables[table] = rows;
    if (result.status === 'error') errors.push(`${table}: ${result.error}`);
  }

  const databaseJson = JSON.stringify(
    { formatVersion: FORMAT_VERSION, takenAt: startedAt, database: masked, tables: databaseTables },
    null,
    2
  );
  const databasePath = 'database.json';
  writeFileSync(absoluteArtifactPath(workingDir, databasePath), databaseJson, { mode: 0o600 });

  const storageResults: StorageBucketResult[] = [];
  for (const bucket of BACKUP_STORAGE_BUCKETS) {
    const result = await exportStorageBucket(supabase, bucket, workingDir);
    storageResults.push(result);
    errors.push(...result.errors.map((error) => `${bucket}: ${error}`));
  }

  const completedAt = new Date().toISOString();
  const status = errors.length === 0 ? 'complete' : 'incomplete';
  const manifest = {
    formatVersion: FORMAT_VERSION,
    status,
    startedAt,
    completedAt,
    database: masked,
    artifacts: {
      database: {
        localPath: databasePath,
        sizeBytes: Buffer.byteLength(databaseJson),
        sha256: sha256(databaseJson),
      },
    },
    tables: tableResults,
    storage: storageResults,
    errors,
  };
  writeFileSync(
    absoluteArtifactPath(workingDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 }
  );

  const finalDir = join(
    backupsDir,
    status === 'complete' ? `backup-${stamp}` : `backup-${stamp}.incomplete`
  );
  renameSync(workingDir, finalDir);

  for (const table of tableResults) {
    const summary =
      table.status === 'backed_up'
        ? String(table.rowCount).padStart(6)
        : table.status === 'not_present'
          ? 'skipped (table not present)'
          : `ERROR: ${table.error}`;
    console.log(`  ${summary}  ${table.name}`);
  }
  for (const bucket of storageResults) {
    console.log(
      `  ${String(bucket.backedUpObjectCount).padStart(6)}  storage:${bucket.name}` +
        (bucket.status === 'error' ? ` (${bucket.errors.length} error(s))` : '')
    );
    if (bucket.public) {
      console.warn(`  WARNING: storage:${bucket.name} is public; it is expected to be private.`);
    }
  }

  console.log(`\n  saved: backups/${finalDir.split('/').pop()}`);
  console.log(
    '  (contains PII, password hashes, API keys, and customer photos — keep it encrypted and private)\n'
  );

  if (errors.length > 0) {
    console.error(`  ${errors.length} item(s) failed — this backup is INCOMPLETE.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
