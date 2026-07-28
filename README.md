# Roof Leads

Roof Leads is a mobile-first field sales CRM for roofing companies. It turns
property lists and severe-weather data into an organized workflow for
canvassing, appointments, proposals, and sold jobs across multiple offices.

The application is built for the whole roofing sales team:

- **Setters and canvassers** find territories, work doors, record outcomes, and
  schedule follow-ups and appointments.
- **Closers** work the pipeline from the appointment stage through sold or lost.
- **Admins** manage leads, markets, users, integrations, assignments, and
  company-wide reporting.

## Product workflow

```text
Storm and property data
        ↓
Import, normalize, deduplicate, and enrich leads
        ↓
Select territories and assign setters or closers
        ↓
Knock doors, contact homeowners, and schedule follow-ups
        ↓
Book inspections and adjuster appointments
        ↓
Track proposals, roof value, and sold revenue
        ↓
Measure performance by rep, source, upload, and market
```

## Core capabilities

### Lead acquisition and organization

- Manual lead creation plus CSV and Excel imports
- Authenticated JSON webhooks and Gmail/Google Apps Script email imports
- Automatic source detection and attribution by user, webhook, or import batch
- Phone normalization, duplicate review, and Do Not Call handling
- Optional Regrid property enrichment and OpenStreetMap Nominatim geocoding
- Explicit market assignment for incomplete or street-only lead data

### Field operations

- A **Today** screen for appointments, follow-ups, and callbacks
- Mobile lead actions for calling, texting, navigation, and follow-up scheduling
- Leaflet/OpenStreetMap lead map with status and priority filtering
- NOAA hail and wind history, severity markers, and age-labelled storm zones
- Opt-in market storm alerts with configurable radius and severity thresholds,
  in-app unread notifications, email delivery, and map deep links
- Saved, market-scoped canvassing territories with ownership, overlap warnings,
  freehand drawing, and explicit bulk assignment of the leads inside
- Door-knock dispositions, knock history, do-not-knock protection, and callbacks
- Private damage-photo storage with short-lived signed URLs

### Pipeline and reporting

- Roofing pipeline from `new` through `sold` or `lost`
- Separate setter and closer assignments
- Inspection and adjuster appointments with conflict warnings and calendar files
- Week and month calendars
- Deal values and property-based estimated roof replacement values
- Dashboard, activity feed, team performance, and won-customer demographics
- Reporting and lead books filterable by office/market; a home market is a
  default, not an access boundary

## Technology

| Area | Implementation |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| UI | Tailwind CSS, Base UI/shadcn components, Lucide icons |
| Database and storage | Supabase PostgreSQL and private Supabase Storage |
| Authentication | Signed JWT cookies and bcrypt password hashes |
| Maps | Leaflet, React Leaflet, and OpenStreetMap |
| External data | NOAA storm reports, Regrid parcels, Nominatim geocoding |
| Email | Resend notifications and ICS calendar attachments |
| Rate limiting | Upstash Redis with an in-memory fallback |
| Import processing | PapaParse and SheetJS |
| Testing | Vitest, TypeScript, and ESLint |
| Hosting | Vercel, deployed from `main` |

## Local setup

### Prerequisites

- Node.js 20.9 or newer
- npm
- A Supabase project

### 1. Install dependencies

```bash
npm ci
```

### 2. Create the database

Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor of an empty
Supabase project. It contains all numbered migrations in order.

For lead damage photos, also create a **private** Supabase Storage bucket named
`lead-photos`.

### 3. Configure the environment

```bash
cp .env.example .env.local
```

Fill in the required values:

| Variable | Purpose |
| --- | --- |
| `APP_DB_ENV` | Labels the database as `development` or `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service key |
| `JWT_SECRET` | Secret used to sign login sessions; use at least 32 characters |
| `CRON_SECRET` | Protects the scheduled NOAA refresh and alert route |

Optional integrations:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Adds lead links to closer notification emails |
| `UPSTASH_REDIS_REST_URL` | Durable, shared rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash authentication |
| `RESEND_API_KEY` | Appointment and subscribed storm-alert email |
| `RESEND_FROM_EMAIL` | Verified sender identity |
| `RESEND_REPLY_TO` | Homeowner reply destination |
| `APP_TIME_ZONE` | Human-readable appointment timezone |

Regrid credentials and email-import settings are managed from the application's
admin Settings page rather than from environment variables.

### 4. Create the first admin

The seed script refuses to write unless the target is labelled as development,
or production access is explicitly acknowledged.

```bash
ADMIN_EMAIL=you@example.com \
ADMIN_PASSWORD='choose-a-strong-password' \
ADMIN_NAME='Your Name' \
npx tsx --env-file=.env.local scripts/seed-admin.ts
```

### 5. Start the application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root path redirects to
the authenticated admin application.

## Database safety

Read [`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md) before modifying data or
applying a migration.

This installation currently uses the live Supabase database for both the
deployed application and local development. Treat `.env.local` as production
unless you have positively verified otherwise. Before a risky production
operation, take a real Supabase/database backup and optionally create the local
JSON safety export:

```bash
# Confirm APP_DB_ENV and the target URL before any write.
npm run backup
```

The backup command is read-only and writes a timestamped JSON export under the
gitignored `backups/` directory. It exports every application table, but it is
still **not a complete disaster-recovery backup** because it does not copy
objects from Supabase Storage. The export contains homeowner PII, password
hashes, and integration credentials; store it securely.

Several data-modifying scripts use a safety guard and refuse non-development
targets unless `--allow-prod` is passed deliberately. Confirm each script before
running it: the storm backfill, ad hoc scripts, and direct database queries are
not protected by that guard.

### Schema changes

1. Add a numbered migration under `supabase/migrations/`.
2. Test it against a development database whenever one is available.
3. Back up production.
4. Apply the migration in Supabase before deploying code that depends on it.
5. Regenerate the complete bootstrap schema with `npm run schema:build`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm start` | Run the production build |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm run lint` | Run ESLint |
| `npm run schema:build` | Rebuild `supabase/schema.sql` from migrations |
| `npm run backup` | Export the script's configured tables to local JSON |
| `npm run storms` | Upsert the default two-year NOAA storm window |
| `npm run storms -- --days 7` | Refresh a shorter NOAA storm window |

Additional maintenance scripts live under `scripts/`, including guarded lead
geocoding and estimated-roof-value backfills. Review the target and guard
behavior before running any of them.

## Repository structure

```text
src/app/admin/       Authenticated pages for daily work and administration
src/app/api/         Admin APIs plus inbound integration webhooks
src/components/      Shared UI, lead workflows, maps, and market controls
src/lib/             Auth, lead rules, integrations, notifications, and utilities
supabase/migrations/ Ordered PostgreSQL migrations
supabase/schema.sql  Complete schema for bootstrapping an empty project
scripts/             Backups, schema generation, seeding, and backfills
docs/                Operational documentation
tasks/               Project work logs and lessons learned
```

## Deployment

Production is hosted on Vercel and deploys from the GitHub `main` branch.

Before pushing a schema-dependent change, verify that the required migration is
already present in the live Supabase database. After pushing, wait for the
Vercel build to finish and verify a build-specific behavior or asset on the
deployed site; an authentication response alone does not prove that the new
build is serving.

### Scheduled storm alerts

`vercel.json` invokes the protected storm-alert refresh once daily at 14:00 UTC
(morning in Arizona). This schedule fits Vercel's free-plan cron limit. Set
`CRON_SECRET` in Vercel before deployment; the route rejects requests when the
secret is missing or does not match.

The job refreshes NOAA's current preliminary daily hail and wind reports plus
the previous two days, then groups qualifying points into one event per market,
storm type, and report date. Applying the migration alone cannot send anything:
every market rule starts disabled and recipients must be explicitly selected in
Admin Settings. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are needed only for
email delivery; persisted in-app alerts continue to work without them.
