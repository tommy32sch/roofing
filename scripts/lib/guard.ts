/**
 * Guard against pointing a script at the production database by accident.
 *
 * Dev and prod used to share one database, so any test script ran against real
 * customer data. Each env file now declares which database it targets via
 * APP_DB_ENV, and destructive scripts refuse to run unless that says
 * `development` — or the operator explicitly passes --allow-prod.
 *
 * Import and call assertSafeTarget() at the top of any script that writes.
 */

const MASK = (url: string) => url.replace(/(https:\/\/)([a-z]{4})[a-z0-9]*(\.)/i, '$1$2•••••$3');

export interface GuardOptions {
  /** True when the script deletes or overwrites data — the strict path. */
  destructive?: boolean;
  /** Shown in the confirmation banner so it's obvious what is about to run. */
  action?: string;
}

export function assertSafeTarget(options: GuardOptions = {}): void {
  const { destructive = true, action = 'this script' } = options;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbEnv = (process.env.APP_DB_ENV || '').trim().toLowerCase();
  const allowProd = process.argv.includes('--allow-prod');

  if (!url) {
    console.error('✖ NEXT_PUBLIC_SUPABASE_URL is not set — refusing to run.');
    process.exit(1);
  }

  console.log(`\n  target database : ${MASK(url)}`);
  console.log(`  APP_DB_ENV      : ${dbEnv || '(not set)'}`);
  console.log(`  action          : ${action}\n`);

  if (!destructive) return;

  if (dbEnv === 'development') return; // safe: a throwaway copy

  if (allowProd) {
    console.warn('  ⚠  Running a destructive script against a NON-development database');
    console.warn('     because --allow-prod was passed. Make sure you have a backup.\n');
    return;
  }

  console.error('✖ Refusing to run.');
  console.error('');
  console.error(`  ${action} modifies data, and this database is not marked as development.`);
  console.error('');
  console.error('  If you meant to target your dev database, point the env file you are');
  console.error('  using at it and set APP_DB_ENV=development.');
  console.error('');
  console.error('  If you really do mean production, re-run with --allow-prod and take a');
  console.error('  backup first.');
  console.error('');
  process.exit(1);
}
