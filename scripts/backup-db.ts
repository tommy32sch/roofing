/**
 * Back up every table to a timestamped JSON file.
 *
 *   npm run backup
 *
 * Development and production currently share one database, so production is the
 * only copy of the real data. Run this before anything destructive — a bulk
 * delete, a migration, a backfill, or any script run with --allow-prod.
 *
 * Read-only: it never writes to the database, so it is always safe to run.
 * Output goes to backups/ (gitignored) because the dump contains password
 * hashes and API keys as well as customer PII.
 *
 * Restore is deliberately manual — see docs/DATABASE_SETUP.md. Blindly replaying
 * a dump is how one bad backup becomes two lost datasets.
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Ordered parent-first, so a manual restore can insert without breaking FKs.
const TABLES = [
  'app_settings',
  'admin_users',
  'lead_sources',
  'tags',
  'integration_api_keys',
  'leads',
  'lead_activities',
  'lead_appointments',
  'lead_tags',
  'email_import_logs',
  'webhook_logs',
];

const PAGE = 1000;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const masked = url.replace(/(https:\/\/)([a-z]{4})[a-z0-9]*(\.)/i, '$1$2•••••$3');
  console.log(`\n  backing up : ${masked}`);
  console.log(`  APP_DB_ENV : ${process.env.APP_DB_ENV || '(not set)'}\n`);

  const dump: Record<string, unknown[]> = {};
  const counts: Record<string, number | string> = {};
  let failed = 0;

  for (const table of TABLES) {
    const rows: unknown[] = [];
    let missing = false;
    // Page explicitly — a plain select silently caps at 1000 rows.
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
      if (error) {
        if (/does not exist|schema cache|not find the table/i.test(error.message)) {
          missing = true;
        } else {
          counts[table] = `ERROR: ${error.message}`;
          failed++;
        }
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (missing) {
      counts[table] = 'skipped (table not present)';
      continue;
    }
    if (typeof counts[table] === 'string') continue; // errored above
    dump[table] = rows;
    counts[table] = rows.length;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(process.cwd(), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `backup-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ takenAt: new Date().toISOString(), database: masked, tables: dump }, null, 2)
  );

  for (const [t, c] of Object.entries(counts)) console.log(`  ${String(c).padStart(6)}  ${t}`);
  console.log(`\n  saved: backups/${file.split('/').pop()}`);
  console.log('  (contains PII, password hashes and API keys — gitignored, keep it safe)\n');

  if (failed > 0) {
    console.error(`  ${failed} table(s) failed — treat this backup as INCOMPLETE.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
