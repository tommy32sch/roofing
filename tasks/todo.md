# Markets (AZ / MN offices)

Goal: split leads by market/office so each rep works their own book, and so
per-office numbers can be read separately instead of one blended total.

Key constraint found before building: **615 of 616 leads have no city or state**
(the PHX storm list imported street-only). Market therefore CANNOT be derived
from the address — it is set explicitly at import and stored on the lead.

Decisions (confirmed with owner):
- Home market, switchable: each user has a home office; Leads/Map/reporting
  default to it; anyone can switch to another market or "All markets".
- Market also splits reporting (Dashboard, Performance, Analytics).

## Schema
- [x] `015_markets.sql`: `markets` table (name + per-market geo defaults),
      `leads.market_id`, `admin_users.market_id`, indexes
- [x] Seed Arizona + Minnesota
- [x] Backfill all existing leads -> Arizona (in the migration; NOT yet run)

## Server
- [x] `market_id` filter on leads, geo, stats, performance, analytics routes
- [x] `/api/admin/markets` (list; admin-only create/update)
- [x] `/api/admin/auth/me` returns the user's home `market_id`
- [x] Import applies the chosen market to every row
- [x] Geocoding falls back to the LEAD'S market city/state, not the app-wide
      singleton (a street-only MN lead currently geocodes into Arizona)

## UI
- [x] Shared market picker, defaulting to home market
- [x] Leads page + Map filter
- [x] Dashboard / Performance / Analytics filter
- [x] Import: market selector (defaults to home market)
- [x] Settings: manage markets
- [x] Users: assign a home market
- [x] Lead detail: show / change market

## Verify
- [x] Tests for market resolution + filter plumbing
- [x] typecheck / build / lint / full suite

## Review

Built on branch `feat/markets`. **Deliberately not merged** — migration 015 is
not applied yet (verified against the live DB with a real row read plus a
control query, per tasks/lessons.md). Merging first would break the import
insert and the users list, both of which name `market_id` directly.

What shipped:
- `markets` table with per-market geocoding regions; `leads.market_id`,
  `admin_users.market_id`.
- Server resolves the market per request: explicit `?market_id`, else the
  caller's home office, `market_id=all` to opt out. Wired into leads, geo,
  stats, performance and analytics.
- Pickers on Leads, Map, Dashboard, Performance, Analytics; required market
  selector on Import; manage-offices card in Settings; home market on Users;
  market shown on the lead detail Property card.
- Geocoding is now per-market, fixing a latent bug: with one app-wide region a
  street-only Minnesota address would have resolved into Arizona.

Deliberate choices:
- Home market is a DEFAULT, not an access boundary. Changing it does not revoke
  sessions the way a role change does. Real per-office access control would
  belong in middleware next to the role checks.
- `market_id` is admin-only on lead PATCH — moving a lead between offices
  changes whose book it lands in.
- The home market is NOT read inside `getAuthenticatedAdmin`, though it would
  save a query: a failed lookup there fails closed and would log every user out
  in the window before the migration is applied. `marketFilterFor` fails soft
  instead, so a missing column means "no filter", not "no leads".
- Pickers hide themselves when fewer than two markets exist, so a single-office
  company never sees a dropdown that can only say one thing.

Verified: 158 tests (8 new for market resolution), typecheck, build all pass.
Lint errors went 2 -> 1; the one remaining is pre-existing and unrelated (an
`any` in the email webhook route).

Not done / follow-ups:
- Calendar and Activity are not market-filtered yet.
- Existing users all have a null home market, so nothing is scoped until you
  assign offices on the Users page. That is intentional — the rollout can't
  hide anyone's leads.

## Freehand territory drawing (map)

Territory selection accepted only one vertex per click, so outlining a
neighbourhood meant a dozen deliberate taps and a shape that never quite
followed the streets.

- `src/lib/leads/draw.ts` — `isDrag`, `shouldCapture`, `perpendicularDistance`,
  `simplifyPath` (Ramer–Douglas–Peucker). 22 tests.
- `DrawLayer` in `LeadMap.tsx` — one pointer gesture, two shapes: a press that
  travels past 6px traces a freehand lasso and REPLACES the shape; a press that
  doesn't appends a single corner, so click-to-place is untouched.
- Map page: `onDrawPath`, a Clear button, `Finish (n)` showing the vertex count,
  and Finish disabled below 3 points.

Deliberate choices:
- `map.dragging.disable()` for the duration of draw mode, restored on cleanup.
  Leaflet owns drag-to-pan and the two gestures are the same input.
- Thinned twice: nothing closer than 5px is captured, then RDP collapses the
  rest on pointerup. A 240-event circle lands at 17 vertices.
- Tolerance is derived from the current map scale, so 4 screen pixels means the
  same amount of detail at every zoom. A fixed value in degrees would erase a
  whole neighbourhood when zoomed out.
- `MAX_CAPTURE_POINTS = 2000`. Simplification is O(n²) on a path where every
  point is a genuine corner — measured, a 20,000-point zigzag takes 10.6s while
  a 20,000-point smooth drag takes 7ms. Real drags are smooth; this is a valve.
- Vertex dots only render at ≤12 points. Dotting a freehand trace buries it.
- Pointer capture wrapped in try/catch: it throws NotFoundError when the pointer
  isn't active, and the release sat ahead of the commit, so a pointercancel
  would have thrown the shape away.

Verified in the browser: a freehand drag produced a 17-vertex polygon with the
map pane transform unchanged (no panning), taps still place one corner each and
2px of hand-shake is not read as a drag, a drag replaced a hand-placed 4-point
shape rather than appending to it (17, not 21), Finish selected 615 leads and
opened the assign bar, and panning works again after leaving draw mode.

363 tests, typecheck and build pass. Lint unchanged at 1 pre-existing error.

## Mobile freehand drawing (map) — fixed

Freehand territory drawing worked with a mouse but not on touch: every finger
drag committed a single corner vertex instead of tracing a lasso. Root-caused
and implemented by Codex (gpt-5.6-sol, xhigh effort); reviewed and verified here.

Three causes, not one:
- `pointercancel` shared the `pointerup` handler, which treats a gesture that
  never travelled 6px as a deliberate tap. On touch the browser claims the
  gesture before that threshold and cancels the pointer — so every drag placed a
  corner.
- The container had no `touch-action: none`, which is what let the browser claim
  it. Leaflet normally supplies this via `leaflet-touch-drag`, but
  `map.dragging.disable()` removes that class — and draw mode disables dragging,
  so the guard vanished exactly when it was needed.
- The parent passes inline arrow callbacks, so every captured move re-rendered,
  changed the effect's identities, and tore down + rebound the pointer listeners
  MID-GESTURE, dropping pointer capture. This affected the mouse path too and had
  gone unnoticed.

Changes:
- `draw.ts` — pure `classifyDrawGestureEnd(freehand, cancelled)`.
- `LeadMap.tsx` — inline `touch-action: none` for the duration (restored after);
  `pointercancel` split from `pointerup`, with a cancelled freehand preview
  rolled back to the pre-gesture outline; `touchZoom` and Safari `tapHold`
  disabled alongside dragging and each restored only if it had been enabled;
  primary `pointerId` tracked so a second finger can't hijack a trace; listeners
  held across rerenders behind a latest-props ref.
- `draw.test.ts` — four simulated pointer sequences: drag commits a path, tap
  commits one point, cancel before threshold commits nothing, cancel mid-drag
  commits nothing.

Verified: 394 tests, typecheck, eslint (unchanged at 1 pre-existing error), and a
real Turbopack `npm run build` — Codex's sandbox had blocked the Google font
fetch and could only compile via `--webpack`, so that was re-run here. Deployment
confirmed by reading the served chunk on the live site: the map bundle now
contains `touchAction` and `tapHold`, neither of which existed in the old code.
**Confirmed working on the owner's phone** — that was the only real proof, since
jsdom has no touch.

Housekeeping: Codex wrote an `AGENTS.md` (its own conventions file) that was a
byte-identical copy of `CLAUDE.md`. Replaced with a symlink so the two cannot
drift.

## Project README

Replace the default Next.js README with documentation that explains what Roof
Leads is, who uses it, how the roofing workflow fits together, and how to run
the application safely.

- [x] Document the product purpose, users, workflow, and major capabilities
- [x] Document the stack, integrations, repository structure, and commands
- [x] Add local setup, Supabase schema/admin setup, and environment variables
- [x] Call out the shared-production-database risk and Vercel deployment order
- [x] Verify every documented path and command against the current repository

Review:
- Replaced the stock create-next-app copy with a product and operator guide.
- Kept optional services and role/market boundaries explicit rather than
  presenting them as hard requirements or access isolation.
- Documented that the local JSON backup is incomplete: it omits five newer
  tables and Supabase Storage, so production work still needs a real database
  backup.
- Verified both relative links, all ten documented npm scripts, the local `tsx`
  binary, `git diff --check`, 394 tests, and TypeScript.

## Saved territories

Goal: turn the map's temporary freehand selection into persistent,
market-scoped canvassing territories without changing historical lead
assignment or the existing explicit bulk-assignment workflow.

Decisions:
- Territory ownership describes who canvasses the geography; it does not
  silently rewrite `leads.assigned_setter_id`.
- Lead membership is calculated from coordinates, so newly imported or
  geocoded leads appear automatically and no territory/lead join can become
  stale.
- All authenticated roles can see active territories in their selected market;
  only admins can create, edit, assign, archive, or restore them.
- Active same-market overlaps require an explicit admin override. Shared edges
  or vertices are allowed.
- Territories are archived rather than hard-deleted.

### Data and geometry
- [x] Add migration `019_saved_territories.sql` with polygon, market, owner,
      color, bounding box, audit fields, indexes, checks, and RLS
- [x] Add reusable polygon validation, bounding-box, containment, and overlap
      helpers with unit coverage for concave and invalid shapes
- [x] Regenerate `supabase/schema.sql` and include territories in the backup

### API
- [x] Add authenticated territory list/create endpoint with market scoping
- [x] Add admin-only update/archive/restore endpoint
- [x] Validate owners, markets, geometry, colors, duplicate names, and overlap
      conflicts server-side
- [x] Add route tests for permissions, validation, collision override, and
      archive/restore behavior

### Map
- [x] Render saved territory outlines beneath lead pins
- [x] Save a completed freehand/tap polygon with name, owner, and color
- [x] Preserve selection of the currently shown leads inside the saved polygon
      so the existing bulk-assignment flow remains available
- [x] Add a responsive territory list with ownership, select, edit, archive,
      and restore controls
- [x] Keep territory outlines readable alongside storm reports/zones
- [ ] Verify desktop and mobile drawing, persistence, selection, editing,
      role behavior, collisions, and archive/restore

### Verification and review
- [x] Run focused tests, full test suite, typecheck, lint, build, schema build,
      and `git diff --check`
- [x] Confirm the production schema state before any deployment
- [x] Record shipped behavior, deliberate deferrals, and verification evidence

Review:
- Saved market-scoped polygons now survive reloads, carry an optional
  setter/admin owner, use a storm-safe cool palette, and render between weather
  data and lead pins. A rep's own outline is emphasized.
- Admins can create with drag or taps even when no leads exist; edit details or
  the boundary; archive/restore; explicitly override intentional overlaps; and
  select the currently filtered leads inside for the existing bulk-assignment
  flow. Territory ownership never rewrites sales attribution.
- Geometry is normalized and validated once on the server. Membership includes
  boundary points; overlap checks detect crossings and containment while
  allowing shared borders.
- Verification: 28 focused territory tests, 418 full tests, TypeScript,
  territory-scoped ESLint, regenerated 19-migration schema, diff check, and a
  production build all pass. Full repository lint remains noisy because it
  traverses generated `.next` files in old `.claude/worktrees`, plus the known
  pre-existing email-webhook `any`.
- Migration 019 is now present in live Supabase and a direct `territories` read
  succeeds. Authenticated browser acceptance remains pending until the code is
  deployed and a signed-in session is available.

## Storm alerts

Goal: notify explicitly subscribed team members when new qualifying NOAA hail
or wind reports land near one of their markets, without generating one message
per point report or claiming preliminary reports are real-time warnings.

Decisions:
- Refresh NOAA's current report day plus the previous two days. The current
  daily file grows and late/corrected reports can appear after the first read.
- Group reports into one event per market, storm type, and NOAA report date.
  Additional reports update the event; email again only when a standard
  severity band increases.
- Persist in-app notifications and delivery attempts before sending email.
  Ingestion and event creation must survive Resend being unavailable.
- Recipients opt in per market. Merely deploying the migration sends nothing,
  and every market rule starts disabled.
- Match reports to a configurable radius around the market center. Defaults:
  50 miles, hail at least 1 inch, wind at least 58 mph.
- Alerts are labelled "preliminary NOAA storm reports." Forecast warnings,
  radar, SMS, and web push are deferred.

### Ingestion and data
- [x] Add migration `020_storm_alerts.sql` for ingestion state, market rules,
      subscriptions, events, report hits, delivery outbox, and read state
- [x] Extract recent NOAA refresh into a reusable idempotent service
- [x] Add a `CRON_SECRET`-protected route, an overlap lock, lookback processing,
      and persisted failure/success health
- [x] Add Vercel cron configuration appropriate for the production plan

### Matching and delivery
- [x] Match reports to enabled markets with Haversine distance and inclusive
      thresholds
- [x] Group/dedupe by market, type, and report date; escalate only at higher
      severity bands
- [x] Queue explicit recipients and retry failed email deliveries without
      duplicating successful sends
- [x] Add a preliminary-data-safe email with a map deep link

### Product UI
- [x] Add admin settings for enablement, radius, hail/wind thresholds, and
      recipient subscriptions
- [x] Add a header bell with unread count and recent subscribed storm events
- [x] Mark alerts read and deep-link into the correct market, storm layer,
      date window, and event center
- [x] Show NOAA refresh health/configuration errors in Settings

### Verification and review
- [x] Test date lookback, ingestion precedence, thresholds, distance boundary,
      grouping, severity escalation, dedupe, retries, permissions, and reads
- [x] Run full tests, typecheck, scoped lint, build, schema build, and diff check
- [x] Confirm live migrations and required environment variables before deploy
- [x] Record shipped behavior, deliberate deferrals, and verification evidence

Review:
- A protected free-plan cron now refreshes NOAA/SPC once daily at 14:00 UTC
  (morning in Arizona). It refreshes the current report day plus the previous
  two, persists ingestion health, matches enabled market radii, and stores one
  preliminary event per market/type/report date before attempting email.
- Notifications are explicit-subscription only. Rules default disabled, and
  enabling requires a market center plus at least one recipient. The in-app
  event survives missing Resend credentials or delivery failures; the email
  outbox claims work atomically, retries with stable provider idempotency keys,
  and cancels unsent work after a rule is disabled or a recipient unsubscribes.
- A whole refresh queues at most one notification per event. If several new
  points arrive together, recipients get one initial message at the final
  aggregate severity rather than an initial message followed immediately by an
  escalation. Later report-day updates notify again only when the standard
  severity band rises.
- Admin Settings exposes market radius/threshold/recipient controls and NOAA
  health. Subscribed users get an unread bell; opening an alert records a read
  and focuses the correct market, storm type, seven-day layer, and event center
  on the map. All copy identifies the source as preliminary NOAA reports, not a
  warning, forecast, or real-time radar.
- Verification: 444 tests, TypeScript, changed-file ESLint, regenerated
  20-migration schema, `git diff --check`, valid `vercel.json`, and a production
  Turbopack build with all three storm-alert APIs plus the cron route pass.
- Migrations 019 and 020 are now present in live Supabase. Direct reads of all
  eight territory/storm-alert tables succeed; ingestion state has both seeded
  rows, and there are zero enabled alert rules. The owner added
  `CRON_SECRET` to production Vercel and confirmed the free plan, so the schedule
  was changed to once daily. Resend configuration is still unconfirmed; no
  external email was performed.
