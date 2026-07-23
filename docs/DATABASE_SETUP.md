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

Read-only, takes seconds, writes a timestamped JSON of every table to
`backups/` (gitignored — it contains PII, password hashes and API keys).

**Run it before:** bulk deletes, migrations, backfills, or any script run with
`--allow-prod`. Production is the only copy of this data, so a backup is the
difference between "undo" and "gone".

### 2. The guard blocks accidental writes

`.env.local` is labelled `APP_DB_ENV=production`, so data-modifying scripts in
`scripts/` refuse to run unless explicitly overridden with `--allow-prod`.

**What the guard does not cover:** ad-hoc one-off scripts and direct queries.
Those hit whatever `.env.local` points at, which is production. The habit of
running `npm run backup` first is what actually protects you there.

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
