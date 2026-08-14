import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_STORAGE_BUCKETS,
  BACKUP_TABLES,
  storageObjectLocalPath,
} from './backup-manifest';

function applicationTablesCreatedByMigrations(): string[] {
  const migrationDir = join(process.cwd(), 'supabase', 'migrations');
  const tables = new Set<string>();
  const createTable =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;

  for (const filename of readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationDir, filename), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '');

    for (const match of sql.matchAll(createTable)) tables.add(match[1].toLowerCase());
  }

  return [...tables].sort();
}

describe('backup manifest', () => {
  it('covers every application table created by the migrations', () => {
    const manifestTables = [...BACKUP_TABLES].sort();
    const schemaTables = applicationTablesCreatedByMigrations();
    const manifestTableSet = new Set<string>(manifestTables);
    const schemaTableSet = new Set<string>(schemaTables);

    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
    expect({
      missingFromManifest: schemaTables.filter((table) => !manifestTableSet.has(table)),
      absentFromSchema: manifestTables.filter((table) => !schemaTableSet.has(table)),
    }).toEqual({ missingFromManifest: [], absentFromSchema: [] });
  });

  it('maps hostile object keys to deterministic traversal-safe local paths', () => {
    const localPath = storageObjectLocalPath(
      'lead-photos',
      '../../outside/../customer roof photo.jpg'
    );

    expect(localPath).toMatch(/^storage\/lead-photos\/objects\/[a-f0-9]{2}\/[a-f0-9]{64}$/);
    expect(localPath).not.toContain('..');
    expect(storageObjectLocalPath('lead-photos', '../../outside/../customer roof photo.jpg'))
      .toBe(localPath);
  });

  it('includes every private application bucket', () => {
    expect(BACKUP_STORAGE_BUCKETS).toEqual(['lead-photos', 'lead-imports']);
  });
});
