# Database environments

## Current state (decided 2026-07-23)

**One database serves both the live site and local development.** The free
Supabase tier allows two projects and both are already in use, so a separate
dev project isn't available right now.

That is a known, accepted tradeoff. Two things mitigate it:

### 1. Back up before anything destructive

```bash
npm run backup
```

Read-only against Supabase, writes a timestamped directory under `backups/`
containing every application table plus every object in the private
`lead-photos` Storage bucket. The directory is gitignored because it contains
PII, password hashes, API keys, and customer photos.

**Run it before:** bulk deletes, migrations, backfills, or any script run with
`--allow-prod`. Production is the only copy of this data, so a backup is the
difference between "undo" and "gone".

### 2. The guard blocks accidental writes

`.env.local` is labelled `APP_DB_ENV=production`, so data-modifying scripts in
`scripts/` refuse to run unless explicitly overridden with `--allow-prod`.

**What the guard does not cover:** ad-hoc one-off scripts and direct queries.
Those hit whatever `.env.local` points at, which is production. The habit of
running `npm run backup` first is what actually protects you there.

## Local safety-export format

Each successful `npm run backup` creates `backups/backup-<timestamp>/` with:

- `manifest.json` — format version, completeness status, table counts, Storage
  bucket settings, original object keys, local artifact paths, and SHA-256
  checksums.
- `database.json` — rows for every application table, in a deliberate
  parent-first table order.
- `storage/lead-photos/objects/` — downloaded private photo bytes. Local names
  are hashes rather than untrusted Storage keys; `manifest.json` is the mapping
  needed to restore each original key.

The command applies owner-only permissions to the backup root, each backup
directory, and every artifact. That protects against other local accounts; it
does not replace full-disk encryption or secure off-device storage.

Older single-file `backup-*.json` exports contain database rows only and predate
lead-photo backup support.

The table manifest is checked against every `CREATE TABLE` in the numbered
migrations by the automated test suite. Adding a table without choosing its
restore position makes the test fail. A run with any table or object error is
renamed `*.incomplete`, records its errors in the manifest, and exits non-zero;
do not treat it as restorable. An interrupted process may leave an
`*.in-progress` directory, which is also not a usable backup.

The export is intentionally not described as full disaster recovery. REST reads
and Storage downloads cannot form one transaction, and the export does not
capture database roles, Supabase Auth users, project configuration, or other
buckets. Use Supabase-managed database backups for the PostgreSQL recovery
point and this export for application rows and private lead-photo bytes.

## Manual restore model

There is deliberately no automatic restore command. A restore should be a
reviewed recovery operation against a new or otherwise explicitly chosen
project:

1. Require `manifest.json` to say `"status": "complete"` and verify each
   artifact's SHA-256 checksum before sending data anywhere.
2. Recreate the schema from the numbered migrations (or the generated
   `supabase/schema.sql`) before loading `database.json` in its manifest order.
   Foreign keys, identity sequences, triggers, and conflicts must be handled by
   a restore plan written for the target database. Omit database-generated
   columns such as `leads.address_dedupe_key` from inserts; do not blindly replay
   rows into a live project.
3. Create `lead-photos` as a **private** bucket using the settings captured in
   the manifest. For each Storage entry, upload `localPath` to its
   `originalPath` only after verifying its checksum.
4. Validate row counts and photo availability in the recovered application
   before changing traffic or credentials.

Because rows and objects can change while the read-only export is running, use
the Supabase database recovery point closest to the export and reconcile photo
metadata against the Storage manifest during a real recovery.

### When to revisit

Move to a separate database if a project slot frees up, or by running Supabase
locally (free and unlimited, needs Docker). Everything needed for the switch is
already prepared — see below.

---

## Setting up a separate dev database (when available)

## Why

The live site and local development shared a single Supabase database. That
meant every test, script, and experiment ran against real customer data — real
homeowner names, addresses and phone numbers — with nothing between a mistake
and the only copy of that data.

The fix is two databases:

| | Used by | Contains | If you break it |
|---|---|---|---|
| **Production** | the live site on Vercel | real leads and users | serious |
| **Development** | `npm run dev` and local scripts | fake/sample data | nothing lost |

Production credentials live **only** in the Vercel dashboard. Nothing on your
laptop points at production.

---

## One-time setup

### 1. Create the development Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**
2. Name it something obvious, e.g. `roof-leads-dev`
3. Pick any region and a database password (save it somewhere)
4. Wait ~2 minutes for it to finish provisioning

The free tier covers this — it's a second project, not a paid add-on.

### 2. Create the tables

1. In the **new** project, open **SQL Editor** → **New query**
2. Paste the entire contents of [`supabase/schema.sql`](../supabase/schema.sql)
3. Click **Run**

That file is every migration concatenated in order, so it produces the same
structure as production, with no data. Regenerate it any time with:

```bash
npm run schema:build
```

### 3. Point your laptop at the new project

In the **new** project: **Settings → API**, then copy three values into
`.env.local`, replacing what's there now:

```bash
APP_DB_ENV=development
NEXT_PUBLIC_SUPABASE_URL=https://<your-dev-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev anon/publishable key>
SUPABASE_SERVICE_ROLE_KEY=<dev service_role/secret key>
```

Leave `JWT_SECRET` and the Upstash values as they are.

> Before overwriting, keep your production values somewhere safe (a password
> manager). You will not need them day to day, and they remain set in Vercel.

### 4. Create a login for the dev database

The new database has no users, so nothing can log in yet:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=your-dev-password \
  npx tsx --env-file=.env.local scripts/seed-admin.ts
```

### 5. Confirm the separation

```bash
npm run dev
```

Log in with the credentials from step 4. You should see an **empty** lead list.
That emptiness is the proof: you are no longer looking at production.

---

## Day-to-day

- `npm run dev` and every local script now hit the **development** database.
- The live site is unaffected — Vercel keeps its own environment variables.
- Adding sample data to dev is free; delete and recreate it however you like.

### Adding a new migration

1. Add the numbered `.sql` file under `supabase/migrations/`
2. Run it in the **dev** project's SQL editor and check the feature works
3. Only then run it in the **production** project
4. `npm run schema:build` to refresh `schema.sql`

Applying to dev first is the point: production stops being where you find out a
migration was wrong.

---

## The safety guard

Scripts that modify data call `assertSafeTarget()` and **refuse to run** unless
`APP_DB_ENV=development`:

```
✖ Refusing to run.
  ... modifies data, and this database is not marked as development.
```

Each run prints the database it is about to touch, so you always see the target
before anything happens.

If you genuinely need to run one against production, take a backup first and
pass the explicit override:

```bash
npx tsx --env-file=.env.production.local scripts/geocode-leads.ts --allow-prod
```

Keep production values in `.env.production.local` (gitignored) rather than
`.env.local`, so reaching for production is always a deliberate act.
