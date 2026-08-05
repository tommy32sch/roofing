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

## Restore map boundary assignment

Regression: adding persistent saved territories replaced the original temporary
boundary-selection workflow. In “All Markets,” New Territory is correctly
disabled because saved territories are market-scoped, but that left no way to
draw around leads and send them into the existing bulk-assignment bar.

- [x] Separate drawing intent into temporary lead selection vs saved territory
- [x] Restore Draw Area wherever mapped leads match the current filters
- [x] Keep New Territory constrained to one selected market
- [x] Restore the original Finish → select leads → Assign workflow
- [x] Add regression coverage for All Markets and empty-market behavior
- [x] Run focused/full tests, TypeScript, lint, build, and diff checks
- [ ] Deploy and verify the production control state

Review:
- Root cause: the persistent territory action inherited the original drawing
  button's position but not its purpose. Because saved territories require one
  market, “All Markets” disabled the only remaining drawing entry point.
- The map now exposes two explicit actions. Draw Area selects filtered leads
  inside a temporary polygon and opens the existing assignment workflow; New
  Territory saves a reusable market-scoped boundary.
- Their prerequisites deliberately differ: Draw Area needs mapped leads but can
  work across All Markets; New Territory needs one market but can be drawn
  before that office has any leads.
- Verification before deploy: 53 focused drawing/territory tests, 447 full
  tests, TypeScript, changed-file ESLint, `git diff --check`, and a production
  Turbopack build pass.

## Activate Resend in production

Goal: rebuild production after the owner added the Resend environment
variables, then verify that the deployed app recognizes email delivery as
configured.

- [x] Confirm the repository is clean and `main` matches `origin/main`
- [x] Trigger a fresh Vercel production deployment
- [x] Confirm the production deployment completed successfully
- [x] Verify the authenticated Settings page reports email as configured

Review:
- Commit `b38e3d8` was pushed to `main`; Vercel reported a successful production
  deployment and the production login route returned HTTP 200 from Vercel.
- The authenticated production Settings page now reports "Email delivery is
  configured," confirming both required Resend variables are visible to the
  deployed application.
- Arizona alerts are enabled with `poopsybelle@gmail.com` subscribed. No
  scheduled NOAA check has succeeded yet, so end-to-end delivery remains
  separate from configuration verification.

## Resend test email and storm marker interaction

Goal: provide a safe admin-only end-to-end Resend check and restore hail/wind
marker details on hover and click.

### Test email
- [x] Add an authenticated, admin-only, rate-limited test-email endpoint
- [x] Send only to the configured safe recipient and return provider errors safely
- [x] Add a Settings button with pending, success, and failure feedback
- [x] Cover authentication, authorization, rate limiting, and provider results

### Storm map
- [x] Reproduce the production failure and identify the blocking canvas layer
- [x] Put interactive vector layers on one shared canvas in explicit hit order
- [x] Add hover details with size/speed and report date
- [x] Verify marker hover/click while leads and territories remain interactive

### Verification and deployment
- [x] Run focused tests, full tests, TypeScript, lint, build, and diff checks
- [x] Deploy production and send one controlled test email
- [x] Verify the live map and Settings test control

Review:
- Root cause confirmed in production: `preferCanvas` created separate full-map
  canvases for storms, territories, and lead pins. The higher lead canvas
  received every pointer before the storm canvas, even where no lead was drawn.
- The map now keeps interactive vectors on one performant canvas and uses
  deliberate draw/hit order: zones, territory fills, storm points, lead pins,
  then the active draft. Storm points have both hover Tooltips and click
  Popups containing size/speed and date.
- The new test endpoint is admin-only, permits three attempts per user per hour,
  creates no storm event, and contacts no configured storm subscriber.
- Pre-deploy verification: 455 tests, TypeScript, changed-file ESLint,
  production Turbopack build, and `git diff --check` pass.
- Production commit `a41ce62` deployed successfully. The live map has one shared
  canvas; the wind marker's hover and click details both work, and a lead pin
  still opens normally.
- The deployed Settings control made one test attempt to the signed-in admin.
  Resend rejected it before delivery because `RESEND_FROM_EMAIL` is not in a
  valid `email@example.com` or `Name <email@example.com>` format. The temporary
  test-only mode below supersedes that production-sender attempt.

## Temporary Resend test-only mode

Goal: use Resend's free onboarding sender for a controlled connection test
without implying that production team delivery works.

- [x] Add `RESEND_EMAIL_MODE=test` and the account-owner test recipient to
  Vercel Production
- [x] Add explicit disabled, test, and production capability resolution
- [x] Enforce the configured test recipient and Resend onboarding sender
- [x] Block normal storm and appointment delivery in test mode
- [x] Expose the mode and test recipient through the Settings API
- [x] Show a test-only Settings banner with an explicit recipient
- [x] Update test-email copy so it confirms only the Resend connection
- [x] Run focused and full verification
- [x] Deploy and confirm the test-only Settings banner
- [x] Send one controlled test and verify it in the Resend log

Production email remains intentionally outstanding:

- Verify a sending domain owned by the company in Resend
- Replace `RESEND_FROM_EMAIL` with an address on that verified domain
- Change `RESEND_EMAIL_MODE` from `test` to `production`
- Re-test storm and appointment delivery to real recipients

Verification before deployment:

- 15 focused email/settings contract tests and 463 full tests pass
- TypeScript and changed-file ESLint pass
- The production Turbopack build and `git diff --check` pass
- Test mode coverage proves normal storm and appointment calls never reach
  Resend, while the connection test uses only the configured owner recipient
  and `Roof Leads <onboarding@resend.dev>`

Rollout review:

- Production commit `f271b8f` deployed successfully with
  `RESEND_EMAIL_MODE=test` and `RESEND_TEST_EMAIL=tommy32sch@gmail.com`
- The live Settings page shows “Email delivery is in test-only mode,” the fixed
  recipient, and the warning that real storm and appointment email is disabled
- One controlled Settings test returned success for `tommy32sch@gmail.com`
- Resend recorded “Roof Leads Resend connection test” as opened
- In-app storm alerts remain active; production email remains blocked until the
  owned-domain steps above are completed

## Combined storm swath and report view

Goal: let roofers see the full storm swath and its individual NOAA touchdown
reports together without losing report details or map interactivity.

- [x] Make Zones additive so turning it on keeps every storm report dot visible
- [x] Draw the swath beneath report dots with a lighter, readable fill
- [x] Keep isolated reports visible outside any generated swath
- [x] Keep swath labels, report hover details, and click popups above map marks
- [x] Keep severity and age legends accurate in the combined view
- [x] Preserve the shared-canvas hit order for territories, reports, and leads
- [x] Add regression coverage for combined rendering and information layering
- [x] Run focused/full tests, TypeScript, lint, build, and diff checks
- [x] Deploy and verify the combined Minnesota hail view in production

Pre-deploy review:

- Zones now draws only the generated swath polygons; the normal sorted report
  loop always draws every dot above them, so isolated reports stay visible once
  and overlapping dots retain pointer priority
- React-Leaflet was placing nested information overlays in the custom
  `map-data` pane, allowing its Canvas to paint above them. Tooltips and popups
  now explicitly use Leaflet's higher `tooltipPane` and `popupPane`
- Swath clustering and report sorting are memoized so unrelated lead-selection
  renders do not repeat the potentially quadratic clustering work
- 75 focused map tests and 467 full tests pass, along with TypeScript,
  changed-file ESLint, the production Turbopack build, and `git diff --check`

Production review:

- Commit `3df99ae` deployed successfully and Vercel reported Ready
- Minnesota hail with the two-year window and Zones enabled visibly shows the
  translucent swath, its dark age labels, all loaded severity dots, and
  isolated dots outside the generated swath at the same time
- The live legend keeps report severity and report age visible and adds the
  separate swath-age ramp only while Zones is enabled
- The live Leaflet DOM contains exactly one Canvas. `map-data` is z-index 350,
  its zone labels are in `tooltipPane` at 650, and click cards target
  `popupPane` at 700, so information renders above every vector mark

## House-number visibility under lead dots

Goal: retain lead markers while revealing the basemap house number underneath
at close, door-level zoom.

- [x] Measure the current dot footprint where OSM house numbers appear
- [x] Keep normal lead visibility at neighborhood zoom
- [x] Switch lead dots to a mostly hollow status ring at house-level zoom
- [x] Preserve a stronger selected and restricted-lead outline
- [x] Keep popup, territory, and storm interaction behavior unchanged
- [x] Add pure regression coverage for zoom, selection, and knock-recency cases
- [x] Run focused/full tests, TypeScript, lint, build, and diff checks
- [x] Deploy and visually verify a real lead over address-level basemap detail

Pre-deployment review:
- OSM address labels begin appearing at zoom 17 in the live Phoenix lead area.
- Below zoom 17, lead dots retain their existing size, fill, and white outline.
- At zoom 17+, ordinary leads become 7px, 10%-filled status rings; recently
  knocked leads fade to 4% while remaining clickable.
- Selected, do-not-knock, and DNC leads retain the existing 3px ring precedence.
- Verification passed: 42 focused tests, 474 full tests, TypeScript, changed-file
  ESLint, production build, and `git diff --check`.

Production review:
- Vercel marked commit `f7c45c8` Ready in Production.
- At zoom 17 in the live Phoenix lead area, 167 visible leads render as mostly
  hollow status rings and the OSM house numbers remain readable through them.
- Clicking the deployed Canvas still opened Terry Russell's lead card, including
  the address, knock actions, selection control, and lead-detail link.

## Appointment reminders

Goal: cut no-shows. A booked appointment nobody turns up to costs a closer a
round trip and cools the lead. Reps first; homeowner reminders ship in the same
release but stay switched off until the owner enables them.

Design decisions:
- ONE daily cron. Vercel Hobby only permits daily schedules, so the job runs at
  14:00 UTC — 07:00 in Phoenix, 09:00 in Minneapolis — and sends BOTH the
  day-before notice (appointments tomorrow, market-local) and the morning-of
  notice (appointments later today). No sub-hourly precision is attempted.
- Timezone comes from a new `markets.timezone` column, not inferred from the
  state code — Arizona has no DST and Minnesota does, and a state code stops
  working the moment a market opens in a split-timezone state.
- Dedupe key includes the appointment's scheduled_at, so rescheduling an
  appointment correctly re-arms its reminders instead of being suppressed as
  already-sent.
- Delivery uses the existing `sendEmail`, which fails closed unless
  RESEND_EMAIL_MODE=production. Reminders therefore send nothing until email is
  taken out of test mode — same posture as storm alerts.

- [x] Migration 021: markets.timezone, reminder settings, delivery ledger
- [x] Pure scheduling logic + tests (which reminders are due, market-local)
- [x] Reminder email builder + tests
- [x] Cron route with auth + lock, mirroring the storm-alert job
- [x] vercel.json schedule
- [x] Verify end to end against the live DB

Verified end to end against the live database (two temporary appointments,
created and removed afterwards):
- Unauthenticated 401; authorized run 200.
- The appointment ~4h out queued `morning_of`; the one ~28h out queued
  `day_before`. Both correct in Phoenix local time.
- Recipient was the rep (`csimmons@mytacheny.com`). NO homeowner row was created
  even though that lead has an email on file — `notify_homeowners` defaults
  false, which is the consent gate working.
- Re-running queued 0 and skipped 2: idempotent, as the unique dedupe_key
  intends.
- Rescheduling one appointment retired its stale reminder as
  `skipped — appointment changed` and armed a fresh one at the new time. Nobody
  is told the wrong hour.
- Delivery reported `not_configured` rather than failing: `sendEmail` fails
  closed, so reminders queue but send nothing until Resend leaves test mode.
- 519 tests, typecheck, lint (unchanged at the 1 pre-existing error), build.

## Offline knock capture

A canvasser walks a street with patchy signal. Today a failed knock POST shows
a toast and the knock is gone — the rep has already moved to the next door and
will not retype it. Territories, knock recency and the Today queue all quietly
degrade from the missing rows.

Three problems, not one:
- Durability: the knock must survive a failed request, a locked phone and a
  closed tab. An in-memory retry is not enough.
- Timestamp truth: `knocked_at` currently defaults to server NOW(). A knock
  taken at 10:05 and synced at 11:30 would claim 11:30, which corrupts knock
  recency — the thing the map colours doors by.
- Idempotency: a flaky connection retries. Without a stable client id the same
  door records twice and knock_count inflates.

Scope now: the durable outbox. A service worker for cold-starting the app with
no signal is a separate, larger piece and is NOT included — with the app already
open, which is the canvassing case, the outbox is what prevents loss.

- [x] Recover the interrupted Claude Code draft and audit its failure modes
- [x] Migration 022: add `client_id` and one atomic, idempotent knock-recording RPC
- [x] Make IndexedDB writes prove transaction completion instead of failing soft
- [x] Scope queued work to the authenticated rep and gate draining on identity
- [x] Retry transient/auth failures indefinitely; retain and surface permanent failures
- [x] Remove the crash window that can strand a persisted `sending` entry
- [x] Make the knock route validate time/idempotency and delegate one atomic DB write
- [x] Optimistically update the pin, knock count, DNK state, and pipeline status
- [x] Show pending/failed work and support an explicit retry
- [x] Add regression coverage for storage, restart, auth, dedupe, and optimistic state
- [x] Regenerate `supabase/schema.sql`, run focused/full verification, and review the diff
- [x] Back up and migrate the live DB before deploying dependent code
- [x] Deploy and verify the live queue, duplicate replay, and atomic state in production
- [x] Verify reconnect/manual retry bypasses backoff with regression coverage

Pre-deployment review:
- A queue row remains `pending` until a normal 2xx response; no in-flight state
  is persisted, so closing or locking the phone cannot strand it.
- IndexedDB writes resolve success only on transaction commit. Unavailable or
  aborted storage is shown as an error instead of a false “saved” confirmation.
- Queue rows carry the originating admin id, and the API rejects a replay under
  another account. Auth failures remain queued and retry after sign-in.
- Transient failures retry indefinitely with capped backoff. Permanent payload
  failures remain in IndexedDB, appear in the map toolbar, and can be retried.
- Scheduled polling respects backoff, while reconnect and the explicit retry
  control bypass it so a rep never taps “retry now” and sees a silent no-op.
- `record_lead_knock` locks one lead row and atomically inserts the event,
  increments the count, preserves timestamp ordering and sticky DNK state, moves
  pipeline status only forward, and writes both timeline activities.
- Server leads are overlaid with all queued events, so pin recency, knock count,
  callback controls, DNK protection, and pipeline colour update immediately and
  remain optimistic after a refetch or page reload.
- Verification passed: 54 focused offline/knock tests, 573 full tests,
  TypeScript, changed-file ESLint, production build, schema regeneration, and
  `git diff --check`.
- Live migration applied successfully. Supabase's OpenAPI schema now exposes
  `record_lead_knock`.
- A controlled live smoke test proved a new write, duplicate replay, client-id
  conflict detection, atomic lead state and atomic activity history. Its
  temporary lead and cascading test rows were removed immediately afterward.
- Read-only production backup saved to
  `backups/backup-2026-07-29T16-08-21-483Z.json` before the remaining migration.

Production review:
- Vercel deployed commit `964edeb` to Production and reported Ready in 43s.
  The signed-in map loaded all 616 real leads with drawing controls available.
- A one-lead temporary market exercised the shipped map UI and IndexedDB outbox:
  Callback was accepted, the popup advanced optimistically to Contacted with
  knock recency and follow-up controls, the queue settled, and Supabase held
  exactly one knock plus both atomic timeline activities.
- The deployed API returned 201 for a new client id, 200 for its exact replay,
  and 409 when that id was reused for different work.
- The temporary market, leads, knocks and activities from both production smoke
  tests were deleted, and the map was restored to the 616 real leads.

## Map knock and cold-call results

Every authenticated role should be able to open a lead pin, choose whether they
knocked or cold-called, and record a structured result without leaving the map.
Safety flags remain channel-specific: Do Not Knock blocks future knock actions,
and Do Not Call blocks future call actions.

- [x] Replace the legacy knock choices with the nine requested result options
- [x] Add structured cold-call results and append-only call history
- [x] Keep lead summaries, safety flags, pipeline status and timeline activity atomic
- [x] Extend the durable map outbox to both knocks and cold calls
- [x] Add a compact mobile-friendly channel/result picker to every role's map popup
- [x] Prompt for follow-up timing after Go Back or Call Back results
- [x] Cover result validation, derived lead state, offline replay and role availability
- [x] Regenerate the schema snapshot and run focused/full verification

Review:
- Every authenticated role gets two clear pin actions, Knocked and Cold called,
  followed by a bottom sheet with the exact requested result lists and 44px
  touch targets. Do Not Knock and Do Not Call disable only their own channel.
- Existing queued knocks remain compatible. One owner-scoped IndexedDB outbox
  now routes knocks and cold calls, applies both optimistically, and preserves
  pending work through weak or lost data service.
- Migration 023 extends knock outcomes additively and adds append-only
  `lead_calls`, latest-call summaries, sticky Do Not Call state, idempotent
  client IDs, atomic lead/timeline updates, RLS and service-role-only RPCs.
- Appointment and Contract Signed results are recorded first, then hand off to
  the existing appointment-time or won-lead details workflow rather than
  bypassing required business data. Setters can record Contract Signed but an
  admin or closer must finish the won-lead workflow.
- Verified: 53 test files / 608 tests, TypeScript, changed-file ESLint,
  regenerated 23-migration schema, `git diff --check`, and a production
  Turbopack build.
- Migration 023 is live in Supabase. Read-only table/field checks succeeded,
  and both result RPCs accepted their new types against a nonexistent lead
  without creating test rows.
- Vercel deployed application commit `de958ee` to Production and reported
  Ready. The production app responded normally and enforced its signed-in map
  redirect; the authenticated map controls were not exercised against real
  leads during this rollout.

## Dashboard contact activity tracking

Make door knocks and cold calls measurable without separating the totals from
the leads they came from. Reps should see their own work; admins should be able
to review the team or one account.

- [x] Add secure Today / Week / Month knock and cold-call aggregation
- [x] Add dashboard totals, account filtering, and recent lead-linked results
- [x] Show lifetime knock/call summaries and structured history on each lead
- [x] Cover period boundaries, role scoping, API/UI contracts, and error states
- [x] Run focused/full verification, deploy `main`, and verify Production

Pre-deployment review:
- Reps are server-enforced to their own activity. Admins default to All Team and
  can select one account; the existing market selector scopes the same totals.
- Today, Week and Month use device-local calendar boundaries so Vercel's UTC
  clock cannot move a rep into tomorrow during their afternoon.
- Each period shows independent door-knock and cold-call totals plus the 20 most
  recent results, with result, account, time, address and a direct lead link.
- Lead Overview now shows lifetime totals, latest result/account and a
  chronological structured history for both channels.
- No migration is required. Read-only live Supabase queries confirmed both
  tables and their lead/account joins support the reporting shape.
- Verification passed: 55 test files / 615 tests, TypeScript, changed-file
  ESLint, `git diff --check`, and a network-enabled production build.

## Future: complete offline operation

Allow a rep to launch and canvass from a completely closed app without an
internet connection. Offline content must be downloaded while online first;
areas and leads that were never downloaded cannot be available offline.

- [x] Make the app installable and cache its shell with a service worker
- [x] Add a "Download territory for offline use" workflow
- [x] Store downloaded territory, lead and rep-identity data in IndexedDB
- [ ] Replace the public OpenStreetMap tile endpoint for offline map packages — DEFERRED
      by owner decision 2026-08-04. Offline shows pins, territory outline and the rep's GPS
      dot on a plain background; streets return with signal. Revisit only if reps report the
      blank basemap is a problem, since the alternatives are a paid provider or self-hosting.
- [x] Show download size, last-updated time, storage usage and removal controls
- [ ] Extend sync to any additional offline actions beyond knocks — knock and call results
      already queue; appointments and lead edits do not
- [ ] Test cold launch, reconnect and storage limits on a real iOS and Android device —
      verified in a desktop production build only (worker registers and activates, shell
      cached, zero API responses cached)

## Future: create walk-up leads from the map

Let a rep add a house that was not already a lead, record the first knock, and
see the new pin immediately without leaving the canvassing map.

- [x] Add an explicit "Add house" map mode with tap placement
- [x] Resolve the selected coordinates to an address (Geocodio reverse, Nominatim fallback)
- [x] Let the rep confirm or correct the address before saving
- [x] Support address-only leads when the homeowner's name is unknown
- [x] Warn when a nearby coordinate already belongs to a lead (30m radius)
- [x] Capture the initial knock result, notes and any contact details in one sheet
- [x] Create the lead, first knock and activity history in one request — see note below
- [x] Add the new pin and knock state to the map immediately

**Note on atomicity.** The lead and knock are created in one request but not one
transaction. The knock goes through the same `record_lead_knock` RPC the lead page uses,
so derived state cannot drift; if it fails the lead is deliberately KEPT and the response
reports `knockRecorded: false`. Discarding a lead the rep just entered while standing at a
door, to preserve a technicality, would be the worse failure. A true transaction would
need a new DB function wrapping both.
- [ ] Extend the offline outbox so a new lead and its first knock can sync together — BLOCKED on "Future: complete offline operation", which has not been started

Production review:
- Committed and pushed as `57a6da7`; the work was complete but had been left
  uncommitted, so none of it had reached the live site.
- `/api/admin/contact-activity` returns 401 unauthenticated on
  roofing-ebon.vercel.app, confirming the new route deployed and is auth-gated.

## Per-rep performance analytics

Goal: measure setters and closers on the work each of them actually does, ahead
of rollout. Deepens Performance rather than adding rep numbers to Analytics —
Analytics stays customer demographics, and a third surface showing rep figures
would eventually disagree with the other two.

Blocking finding, recorded before building: `assigned_setter_id` and
`assigned_closer_id` were NULL on all 616 leads, there were 0 sold deals, and
`lead_appointments` had no outcome column — so three of the four requested metric
families had nothing to compute and no-show rate was impossible. The assignment
wiring itself is sound (bulk-assign and the lead detail dropdowns both write the
columns Performance reads), so the numbers populate as soon as leads are
assigned at rollout.

- [x] Migration 024: appointment outcome, outcome_at, outcome_by
- [x] Outcome recording on the appointment PATCH route, with authorization
- [x] Pure metrics module covering activity, funnel, revenue, follow-through
- [x] Leaderboard with per-rep trend on expand
- [x] Period selector using device-local boundaries
- [x] Verify against seeded data, then restore the database

Deliberate choices:
- Every rate returns null, rendered as an em dash, when its denominator is
  empty. "No data yet" and "zero percent" are different facts, and rendering
  them identically makes a brand-new rep look like the worst on the board.
- Close rate divides by appointments actually RUN, not by assigned leads —
  dividing by assignments punishes a closer for leads that never reached an
  appointment, which is the setter's half of the job.
- No-show rate excludes cancellations from the denominator. A homeowner who
  calls ahead is a different event from one who leaves a closer on a doorstep,
  and including them would let a rep improve the rate by cancelling anything
  they expected to lose.
- Activity is attributed to whoever DID it, not to the lead's assignee, so a rep
  covering someone else's territory is credited rather than invisible.
- Time-to-first-knock searches all time, not the window. Windowing it would
  report the first knock inside the window as if it were the first ever.
- Trend weeks with no activity are emitted as zeros. A closed-up gap in a chart
  implies continuous work that did not happen.
- Only an admin may overwrite an outcome someone else recorded; a rep can set
  and correct their own. An outcome is a judgement about their own work.

Verification, against seeded data then reverted:
- API returned knocks 5, calls 3, setter leads 4, appts set 3, set rate 75%,
  close rate 50%, revenue $18,500, avg deal $18,500, rev/appt $9,250,
  appts booked 4, completed 2, no-shows 1, no-show rate 33%, lead→1st knock 8d.
  Every figure matched hand calculation.
- No-show rate came out 33% (1 of 3 decided) rather than 25% (1 of 4), proving
  cancellations are excluded.
- A window in the far past zeroed activity and returned a null no-show rate
  rather than 0%.
- Trend returned 12 weeks with 11 emitted as explicit zeros.
- Signed in as a setter, only that rep's row was returned — role scoping is
  server-side.
- UI: leaderboard row, expanded detail grid and three sparklines all rendered.
- Database restored to its exact prior state afterwards: 0 assignments, 0 sold,
  4 knocks, 3 appointments.
- 686 tests, typecheck, lint unchanged at the 1 pre-existing error, build.

Also fixed: migration 023 was used twice — Codex added `023_contact_results.sql`
while this session was away and mine collided. Renamed to
`024_appointment_outcomes.sql` and regenerated `schema.sql`. The live database
was unaffected; only the file ordering was wrong.

## Exact placement for the last 12 leads — CASS-backed geocoder

### The problem, precisely

12 leads sit on street-level pins because neither free source holds their house:

| Cluster | Leads | Evidence |
|---|---|---|
| E Flowing Spg 5503–5584 | 8 | Census address range for that street starts at 5700; all 8 are below it |
| E Valley View Dr 5918–5950 | 4 | Nominatim returns `category=highway`; Census has no record |

Already tried and ruled out: free-form Nominatim, Census with the city name,
USPS suffix expansion, and street-centroid interpolation (rejected — it produces
confident wrong pins, the failure that put 37 leads 33 miles away).

Their ZIP+4 codes split cleanly by parity — `-8079` odd, `-8080` even, i.e.
opposite sides of the street. USPS clearly holds these addresses at a
granularity OSM and TIGER do not, which is the case for a CASS-backed provider.

### Provider

Geocodio first: US-only (matches the app), 2,500/day free, **no credit card**,
and it blends USPS data with other sources. Smarty is the fallback if Geocodio
misses — CASS-certified, built directly from the USPS address file, so it is the
most likely to hold new-build addresses, but its free tier is smaller.

Explicitly NOT LocationIQ, Geoapify or Photon: all OSM-derived, so they inherit
the exact gap being solved. A generous free tier is worthless if the data is the
same data.

### Design

A third tier on the existing chain, consulted only when the previous answer is
below house-level — the precision plumbing added in 698cec9 is the seam:

    Nominatim  ->  Census  ->  CASS provider
       (free)      (free)      (keyed, optional)

- `src/lib/integrations/geocode-cass.ts`, written against a provider-agnostic
  interface so swapping Geocodio for Smarty is a config change, not a rewrite.
- Key lives in `app_settings`, mirroring `regrid_api_key`: editable in Settings
  by an admin, no redeploy to rotate, never in the bundle.
- Absent key = today's behaviour exactly. The feature must be additive, because
  the app has to keep working for anyone who never configures it.
- Cost is negligible by construction: the third tier only runs when the first two
  fail to place a house, which today is 12 addresses out of 967.

### Steps

- [x] Owner: create a Geocodio account, paste the key into Settings
- [x] VALIDATION GATE — query the 12 known-bad addresses directly, before any
      wiring. If they do not resolve house-level, stop and try Smarty instead.
      No integration work until the data is proven to exist.
- [x] `geocode-cass.ts` + tests: request shape, response parsing, accuracy-code
      handling, failure returns null rather than throwing
- [x] Extend the chain; a keyless install must be byte-identical in behaviour
- [x] Settings UI field + a "test connection" button, matching Regrid's pattern
- [x] `npm run backup`, then clear and re-geocode ONLY those 12
- [x] Verify: 12 distinct coordinates, all within the correct block, and the
      odd/even ZIP+4 split lands on opposite sides of the street
- [x] Confirm the app-wide stacked count reaches 0
- [x] Deploy and re-verify on production — 967 mapped, 0 unmapped, 0 stacked

### Risks

- The provider may not have them either. The validation gate exists so this is
  discovered in one minute, before any code is written.
- A paid dependency creeping into the critical path. Mitigated by keeping it
  optional and last in the chain.
- Repair scope creep. Only the 12 get cleared, identified by explicit id list —
  the same discipline that kept the 37-lead repair from touching anything else.

### Rollback

`npm run backup` first; every previous coordinate saved to a rollback file, as
with the earlier repairs. Removing the key reverts behaviour immediately without
a deploy.

### Not in scope

Storing precision per lead so the UI can mark approximate pins. Worth doing, but
it is a schema change and a separate decision.

### Result

Gate passed 12/12: every address returned accuracy_type `rooftop`, accuracy 1,
source `Pinal` — county parcel records, exactly the independent data OSM and
TIGER lack. Twelve distinct coordinates, zero failures.

The probe also caught a trap worth recording. Geocodio returns `accuracy: 1` for
`street_center` and `range_interpolation`, not only for `rooftop`, and returns
the CITY centre (`place`, accuracy 0.5) for an address that does not exist.
Gating on the score would have reintroduced the very stacking bug this tier
exists to remove. Only `accuracy_type` is load-bearing; `range_interpolation` is
classified as street-level, never house.

After the repair, app-wide: 967 mapped, 0 unmapped, 0 distinct addresses sharing
a pin. The odd/even ZIP+4 split resolved to opposite sides of the street — odds
average latitude 33.091778, evens 33.092230, 50 metres apart — which is the
proof this is per-building data rather than interpolation.

Remaining: rotate the Geocodio key, since it was pasted into a chat transcript.

## Open action — rotate the Geocodio API key

The key was pasted into a chat transcript on 2026-07-31 while validating the
CASS geocoder, so it should be treated as exposed. Rotating costs nothing and
needs no deploy.

**CLOSED 2026-07-31 — accepted risk, do not re-raise.** Three rotation attempts each
re-saved the same key (verified by SHA-256: the stored value stayed byte-identical to the
exposed one while updated_at confirmed the writes were landing). Owner decided not to
pursue it. Exposure is bounded — a free-tier geocoding key that cannot reach leads, the
database or customers; worst case is a stranger consuming the monthly lookup quota.

- [x] ~~Generate a new key at geocod.io~~
- [x] ~~Paste it into Settings → Geocoder API key~~
- [x] ~~Revoke the old key in the Geocodio dashboard~~
- [x] Confirm geocoding still works — verified live: rooftop accuracy, exact coords
      report 0 remaining rather than a run of failures

Not urgent — the free tier has no billing attached, so the worst case is someone
else consuming the daily quota. But it is a real credential and the fix is a
two-minute job.

## Stabilization sprint — data safety, access control, and scheduled jobs

Goal: protect the production-only customer record before adding another major
workflow. Build durable guardrails that future tables and routes inherit instead
of repairing today's omissions one at a time.

### Architecture and data safety

- [x] Add the long-term architecture rule to the canonical agent instructions
- [x] Make the database backup manifest cover every application table
- [x] Add a schema-coverage test so a newly created table cannot be omitted silently
- [x] Back up private lead-photo objects, with a manifest and safe local paths
- [x] Align the backup and restore documentation with what the command actually preserves

### Authorization

- [x] Require admin or uploader ownership before permanently deleting a lead photo
- [x] Centralize lead visibility enforcement for lead child resources
- [x] Apply the shared policy to knocks, calls, photos, Activity, and Stats
- [x] Add focused policy and route-contract regression tests

### Operations and remaining hardening

- [x] Verify `CRON_SECRET` is configured in Vercel without exposing its value
- [ ] With owner confirmation, mark `JWT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`
      as Sensitive in Vercel; the dashboard currently flags both
- [ ] **URGENT — owner action** Provision Upstash and set `UPSTASH_REDIS_REST_URL` /
      `_TOKEN` in Vercel. Requires creating a database in the Upstash console and pasting
      a token into Vercel, neither of which the assistant can do.
      Steps: console.upstash.com -> Create Database (Redis, region nearest the Vercel
      deployment) -> copy the REST URL and token -> Vercel -> Settings -> Environment
      Variables (Production) -> redeploy.
      Verify afterwards with `GET /api/admin/health/rate-limit` as an admin; it performs a
      real limiter round trip and must report `healthy: true`.

      Detection is now in place regardless: a configured-but-unreachable backend logs a
      `[SECURITY]` error and reports `healthy: false`, instead of degrading silently.

      Original note:
      the currently configured host `fleet-wahoo-75781.upstash.io` returns NXDOMAIN — the
      database no longer exists. checkConfiguredRateLimit catches the failure and falls
      back to an in-memory counter, silently. On serverless that counter is per-instance
      and resets on cold start, so login brute-force protection is effectively absent in
      production and the per-account limit added for audit item #6 does not hold.
      production currently falls back to per-instance rate limits and cron locks
- [x] Verify both scheduled jobs have current production execution evidence — confirmed
      2026-08-04 from `scheduled_job_runs`: storm-alerts and appointment-reminders both
      succeeded on 2026-08-03 and 2026-08-04. CRON_SECRET is set; the long-standing
      "crons may have never fired" question is closed.
- [x] Add a shared append-only execution ledger so quiet, failed, skipped, and
      timed-out cron runs remain auditable beyond Vercel's log window
- [x] Apply migrations 028 and 029 before deploying the cron and ingress changes
- [x] Replace webhook credentials in URLs with the existing header form without
      leaving a second permanent authentication scheme
- [x] Add bounded import rate limiting and remove whole-table duplicate loading

### Verification and review

- [x] Run the focused tests that prove backup coverage and access boundaries
- [x] Run the project-wide typecheck/test gate once
- [x] Record local versus production verification and any deployment prerequisites
- [x] Review the final diff for a smaller or more durable design

### Review — 2026-08-02

- The canonical instruction now requires long-term architectural decisions;
  `AGENTS.md` inherits it through the existing `CLAUDE.md` symlink.
- Backup coverage is an explicit restore-ordered manifest checked against all
  migration-created tables. The live read-only export completed at
  `backups/backup-2026-08-02T21-04-43-662Z`: 29 manifest entries, 967 leads,
  66,260 storm reports, one private Storage bucket, zero photo objects, and a
  verified database checksum. The directory and artifacts are owner-only.
- Lead visibility now has one pure policy plus shared point-resource and
  aggregate-query enforcement. Photo deletion is admin/uploader-only and the UI
  consumes the server's `can_delete` decision.
- URL webhook credentials are removed. Imports are account-rate-limited before
  parsing and use an indexed, database-owned canonical address key instead of
  loading the whole leads table. The recheck path uses the same generated key.
- Vercel confirms `CRON_SECRET` is a Sensitive Production variable and both
  daily schedules are enabled. Today's hail/wind ingestion succeeded with no
  failures. Appointment reminders had no delivery rows, so current execution is
  not provable until the shared run ledger is deployed.
- Local verification: 78 test files / 905 tests, TypeScript, changed-file ESLint,
  schema generation, `git diff --check`, and a network-enabled production build
  passed.
- Migrations 028 and 029 are live. Read-only verification confirmed the
  `scheduled_job_runs` table, generated `leads.address_dedupe_key` column, and
  `find_lead_duplicate_context(JSONB)` RPC. The application changes are not yet
  deployed. Vercel also lacks Upstash credentials, and its dashboard recommends
  marking the JWT and Supabase service-role variables Sensitive. Those external
  changes require owner approval.

## Territory Execution Mode

Goal: turn a saved territory into the focused daily canvassing workflow without
creating a second territory-membership or lead-assignment system.

Architectural decisions:
- Progress is derived from current lead coordinates, contact summaries, and
  appointment facts. It is not stored on the territory, so new and newly
  geocoded leads enter automatically and boundary edits cannot leave stale join
  rows behind.
- The five exclusive progress states use one shared precedence:
  Appointment > Follow-up > Contacted > Knocked > Unworked. Safety and terminal
  conditions remain separate eligibility flags instead of distorting progress.
- Territory ownership stays descriptive, matching the saved-territory design.
  Admins and setters may cover any active territory; closers cannot enter the
  door-knocking execution workflow. Admin-only presentation owns team/stalled
  management signals.
- Server snapshots and manager summaries use unfiltered, paginated lead data;
  current map status/priority filters never change canonical progress.
- The browser chooses the nearest eligible house with device geolocation.
  Location is requested only inside execution mode and is never persisted or
  transmitted. A deterministic manual queue remains available when permission
  is denied or GPS is unavailable.
- Revisit-due and stalled rules are shared domain logic: explicit follow-ups due
  on/before the caller's local date, undated callbacks needing scheduling, stale
  not-home knocks after 14 days, and active territories with actionable work but
  no field activity for seven days.

### Domain and API

- [x] Add shared progress, revisit, stalled, eligibility, and nearest-house logic
- [x] Add server-owned territory execution snapshots with exact polygon membership
- [x] Add a batched progress endpoint for territory cards and manager coverage
- [x] Apply role, archive, duplicate, market, and lead-visibility boundaries
- [x] Use real appointment evidence and overlay offline work on the client

### Rep workflow

- [x] Add Start/Resume actions to active territory cards
- [x] Replace the normal map toolbar with a focused execution toolbar while active
- [x] Show only the territory work set, progress, revisit markers, and current door
- [x] Add nearest-unworked selection using on-device geolocation plus manual fallback
- [x] Open durable one-tap knock results without visiting the full lead page
- [x] Preserve appointment, won-lead, follow-up, DNC/DNK, and offline-sync workflows

### Manager view

- [x] Show accurate five-state coverage, revisit counts, and last activity
- [x] Identify not-started, active, stalled, and complete territories for admins
- [x] Keep overlapping territory totals independent and avoid company-wide double counts

### Verification

- [x] Cover state precedence, due dates, stall thresholds, nearest-house ties, and exclusions
- [x] Cover route authorization, exact membership, unfiltered counts, and pagination
- [x] Cover execution-mode UI wiring, location failure, safety styling, and offline advancement
- [x] Run focused/full tests, TypeScript, changed-file lint, build, and diff review

### Review — 2026-08-02

- Territory membership and progress remain derived from the saved polygon and
  current lead facts. No execution table, territory-lead join, or migration was
  added. Exact server membership is independent of map filters and row caps.
- Admins and setters can start or resume any active territory; ownership remains
  descriptive. Closers are denied by both the UI capability and server route.
- Execution mode narrows the map to the canonical territory snapshot, keeps
  DNC/DNK strokes intact, marks due revisits and the active door, requests GPS
  only after the nearest-door action, and retains a deterministic manual queue.
- One-tap results use the existing owner-scoped IndexedDB outbox. Optimistic
  overlays advance to the next door before sync; callback/revisit promises stay
  selected until a follow-up is scheduled. Existing appointment and won-lead
  follow-on flows are reused.
- Verification passed: 85 test files / 946 tests, TypeScript, changed-file
  ESLint, focused route/domain/UI tests, and `git diff --check`. The production
  build reached compilation but the sandbox could not download Google Geist
  fonts; the offline mock build and local browser server were unavailable under
  the current approval/usage limit. Browser interaction is therefore unverified.
- These changes are local only: no migration, commit, push, or deployment was
  performed.
