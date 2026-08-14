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

## Trusted application shell

Goal: load session identity, company, markets, connection state, and broad UI
permissions once before any protected page renders. Navigation must never flash
the wrong role, and a failed bootstrap must never look like valid empty data.

### Architecture

- [x] Separate the public login route from a server-loaded protected route group
- [x] Add a typed session resolver that distinguishes invalid sessions from service failures
- [x] Add one server bootstrap for identity, company, markets, impersonation, and permissions
- [x] Add one client provider for bootstrap data, connection state, and shell refresh

### Migration

- [x] Move the existing navigation and account controls into the shared shell
- [x] Replace repeated identity requests in Dashboard, Leads, Map, Today,
      Performance, Users, and Lead Detail
- [x] Make the market hook and market settings read the shared market list
- [x] Remove duplicate browser connection listeners from offline workflows
- [x] Show clear shell and resource errors instead of false empty or zero states

### Verification

- [x] Add focused session, permissions, and shell contract tests
- [x] Update route-path contract tests after the protected route-group move
- [x] Run the focused tests, full test suite, TypeScript, lint, build, and diff review
- [x] Record the delivered behavior and verification limits

### Review — 2026-08-09

- Public login now sits outside `admin/(app)`. The protected server layout
  resolves the live database account before it renders navigation or a page, so
  no client can start with an admin fallback or flash another role.
- One request-scoped bootstrap supplies company, markets, impersonation, broad
  UI permissions, and home market. Client identity and market-list requests are
  removed. Market-filtered APIs reuse the authenticated home market instead of
  reading the account row twice.
- One provider owns online/offline state. A service outage, degraded company or
  market read, page-data failure, and valid empty result now have separate UI.
  Import and edit screens stay blocked when their required source data is not
  trustworthy.
- Verification passed: 91 test files / 1,004 tests, TypeScript, changed-file
  ESLint, production build, route generation, and whitespace review. A local
  browser confirmed that login mounts without the protected shell, `/admin`
  redirects to login with its return path, and the browser console stays clean.
  A signed-in browser pass then confirmed Dashboard, Leads, and Settings through
  the protected shell.
- Commit `9b2767a` was pushed to `origin/main` on 2026-08-09. No migration was
  required.

## Stable Leads work queue

Goal: make Leads a fast, predictable work surface whose URL, table, saved views,
and exports always describe the same result set.

Architectural decisions:
- The URL is the canonical transient queue state. Filter and sort changes replace
  the current history entry; pagination may remain a deliberate history step.
- User-owned saved views are durable database records. They store only an
  allowlisted, normalized set of lead query parameters and never use localStorage.
- Sorting is server-owned, allowlisted, null-safe, and deterministic across pages.
- Saved views never include pagination. Applying one replaces the full queue
  filter and sort state in one navigation.

### Query model and API

- [x] Add one typed lead-view query contract with normalization and signatures
- [x] Fix controlled debounce and use `router.replace` for filter and sort changes
- [x] Read and send `sort` and `order`, including existing Today links
- [x] Make list and export filtering and ordering match
- [x] Add migration 030 and owner-scoped saved-view CRUD routes

### Work-queue UI

- [x] Add a saved-view picker with create, update, rename, and delete actions
- [x] Add clear active-filter chips and one Clear all action
- [x] Add accessible sortable table headers and a compact sort control
- [x] Keep mobile controls compact and preserve safe bulk-selection behavior

### Verification

- [x] Add focused query, route, migration, and page-contract tests
- [x] Run focused/full tests, TypeScript, changed-file lint, schema build, and production build
- [x] Verify signed-in desktop search, clear, filter, sorting, and clean hydration
- [x] Verify saved-view create, update, rename, apply, and delete after migration 030
- [ ] Verify the phone-width workflow in a real narrow viewport
- [x] Record review results and deployment requirements

### Review — 2026-08-09

- The Leads URL now owns the complete allowlisted filter and sort state. Search
  is controlled and debounced, changes replace history, stale requests abort,
  old rows remain visible during refresh, and pagination is deterministic.
- List, export, and street grouping use one server filter boundary. Malformed
  assignment filters still fail closed instead of widening the result set.
- Saved views are versioned, user-owned database records with create, update,
  rename, and delete routes. Migration 030 is included in the generated schema
  and backup manifest and was applied by the owner on 2026-08-10.
- Desktop browser verification passed for debounced search, URL state, live
  result counts, Clear all, status filters, and server sorting. A fresh
  production build also confirmed clean hydration and no browser console errors.
  The pass fixed the app-shell Sun/Moon mismatch and link-button semantics found
  during this review.
- Verification passed: 95 test files / 1,026 tests, TypeScript, changed-file
  ESLint, schema generation from 30 migrations, `git diff --check`, and a full
  mocked-font webpack production build with all 42 pages generated. The normal
  Turbopack build was blocked only by sandbox access to Google Fonts; two network
  approval attempts timed out.
- The phone-specific sheet and safe-area bulk bar are covered by contracts, but
  the current in-app browser cannot change its viewport. A real phone-width pass
  remains required.
- Post-migration browser verification created a temporary saved view from the
  `status=new`, `search=Charles`, `last_name:asc` queue, updated its definition,
  renamed it, left and reapplied it, and then deleted it. The exact URL and
  six-lead result set were restored, cleanup was confirmed, and the signed-in
  browser console stayed clean.
- Existing closer-status visibility was not changed. The current routes do not
  share one consistent business policy, so that access decision should be made
  as its own security-scoped change.

## Today command center

Goal: make Today the screen a rep can work from without opening every lead.
Show the next stop, make overdue appointment results impossible to miss, and
show honest progress for the current day.

Architectural decisions:
- Keep `lead_appointments.outcome` as the source of truth. Today records results
  through the existing permission-checked appointment PATCH route.
- A cancellation is an outcome, not deletion. The booking and its reporting
  history remain in the database.
- Load today's schedule and earlier unresolved appointments separately. This
  avoids duplicate rows while still finding work left behind on a prior day.
- Derive the next stop, awaiting list, and daily progress from one pure command
  center model so the UI and tests cannot disagree.
- Calculate the local day on the device, but compare appointment instants with
  one server-provided request time so every section uses the same clock.

### Data and domain
- [x] Add a pure Today command-center model for next stop, result queue, and progress
- [x] Return outcome fields, action permission, server time, and prior unresolved visits
- [x] Keep role, assignment, market, duplicate, and lead-visibility boundaries intact

### UI
- [x] Add a prominent next-stop card with call, text, directions, and lead access
- [x] Add one-tap Completed, No-show, and Cancelled actions for awaiting visits
- [x] Add compact daily appointment progress and clear outcome states
- [x] Preserve the existing follow-up, callback, scope, and empty-state workflows

### Verification
- [x] Add focused domain, route, and page-contract tests
- [x] Run focused/full tests, TypeScript, changed-file lint, build, and diff review
- [x] Verify the signed-in Today workflow in the production browser
- [x] Record the delivered behavior and verification limits

### Review — 2026-08-12

- Today now leads with the next scheduled stop, large call/text/directions
  actions, a daily appointment-progress card, an oldest-first result backlog,
  and later visits. Follow-ups and door callbacks remain below the fixed-time
  work and share a two-column desktop layout.
- Past scheduled visits from earlier days now remain visible until somebody
  records Completed, No-show, or Cancelled. The server returns the exact
  backlog count and computes each row's action permission from the shared
  appointment-ownership policy.
- Migration 031 adds a service-role-only transaction for an outcome plus its
  lead-history entry. It rejects stale rep updates. Cancellation preserves the
  booking, stops reminder planning and delivery, and frees the time from the
  conflict checker. Permanent deletion is now admin-only and named clearly.
- Lead Detail uses the same PATCH-based outcome client, so its old cancellation
  workflow no longer deletes reporting history. Appointment status is visible
  there, and overdue visits have the same result controls as Today.
- Verification passed: 97 test files / 1,048 tests, TypeScript, changed-file
  ESLint, generated 31-migration schema, `git diff --check`, and the real
  Turbopack production build with all 42 pages generated.
- Migration 031 is live and its RPC is exposed. Commit `7473f6d` deployed to
  production, where signed-in browser acceptance passed in the team and personal
  scopes. The live page showed four overdue result cards, the focused personal
  empty state, 12 enabled outcome actions with 44 px minimum touch height,
  responsive mobile and desktop layouts, and no browser warnings or errors. No
  real appointment result was changed during acceptance.

## Admin-only team data scope

Goal: let admins switch between personal and team data while setters and closers
can only read work assigned to their role across the whole application.

Architectural decisions:
- Treat team scope as an access-control permission, not a client-side filter.
- Use one shared role-aware policy for direct lead queries, embedded lead
  queries, and lead-detail authorization.
- A setter owns a lead through `assigned_setter_id`; a closer owns it through
  `assigned_closer_id`. An admin personal scope matches either assignment.
- Assignment is the access boundary for both rep roles. Pipeline status remains
  a workflow filter, not an authorization rule, so a closer does not lose a
  newly created or newly assigned lead before it reaches a later stage.
- Reject an explicit team-scope request from a non-admin instead of silently
  broadening or interpreting it.

### Policy and server
- [x] Add the shared role-aware scope resolver and query helpers
- [x] Apply it to Today and every lead-derived list, detail, map, calendar,
      activity, reporting, and export boundary
- [x] Preserve admin team access and admin personal-scope behavior
- [x] Require a closer handoff when a setter books an appointment
- [x] Stop setters from changing a sold lead

### UI
- [x] Show Mine/Everyone and account/team selectors only to admins
- [x] Keep setter and closer requests fixed to their own role assignment
- [x] Add a closer picker on appointment booking

### Verification
- [x] Add pure policy, route-contract, and UI-contract coverage
- [x] Run focused/full tests, TypeScript, changed-file lint, build, and diff review
- [ ] Verify admin and non-admin behavior in the production browser after deploy
- [x] Record delivered behavior and remaining limits

### Review

- One assignment policy now controls direct lead reads, embedded lead lists,
  detail and child routes, appointments, reports, map data, and territory work.
- Admins keep team access and may select Mine or Everyone on Today. Setters and
  closers have no team control, and an explicit `scope=all` request returns 403.
- New leads created or imported by a rep are assigned to that rep's role so the
  record does not disappear after creation. Existing unassigned leads remain
  admin-only until an admin assigns them.
- Booking an appointment requires a closer. Setters may set `assigned_closer_id`
  only; they cannot award themselves doors or change a sold lead. The team
  directory returns names and roles, not emails.
- Appointment conflicts and nearby-house checks keep other accounts' customer
  details private. Reminder recipients now use current setter and closer
  assignments instead of the booking creator.
- Offline territory packages use schema 3, so packages created before this
  access boundary are discarded. A server denial cannot fall back to a cached
  package; a device with no network can still use a package that was valid when
  downloaded, because offline access cannot receive a later reassignment.
- Booking an appointment now requires a closer. Setters may set
  `assigned_closer_id` only. They cannot change a sold lead. `/api/admin/team`
  returns id, name, and role for the picker; emails stay on the admin users
  route.
- Verified locally: 1,074 tests, TypeScript, and changed-file ESLint pass.
  Not deployed. Existing unassigned leads stay admin-only until an admin
  assigns them. Signed-in production role checks remain after deploy.

## Assign the current book to C. Simmons

- [x] Read live users, markets, territories, and assignment counts
- [x] Backup production
- [x] Assign every Arizona lead to C. Simmons as setter
- [x] Leave closer empty (no real closer; almost no appointments)

Review:
- Before: 883 unassigned, 82 on the demo Setter account, 2 on C. Simmons.
  After a real-row read of all 967 leads: every `assigned_setter_id` is
  C. Simmons (`csimmons@mytacheny.com`). Zero closer assignments.
- Backup: `backups/backup-2026-08-13T22-41-22-477Z`.
- No closer was invented. The one appointment-set lead still needs a closer
  before that visit appears on a closer's Today screen.

## Product-specific admin interface

Goal: replace the generic AI-dashboard appearance with a durable visual system
for a roofing sales operation, starting with the shared shell and Today.

Architectural decisions:
- Use hierarchy, density, and task order instead of decorative glow or a wall
  of interchangeable cards.
- Make the desktop navigation a distinct work rail and keep the mobile tab bar
  focused on field actions.
- Treat Today as an operating board: next stop first, unresolved results next,
  and flexible follow-up work after the scheduled route.
- Keep the existing data, permissions, actions, touch targets, and dark mode.

### Implementation
- [x] Remove the global ambient/glow treatment from core surfaces
- [x] Redesign the shared admin shell and navigation
- [x] Redesign Today around one clear work sequence
- [x] Preserve responsive, accessible, role-aware behavior

### Verification
- [x] Run focused contracts, TypeScript, changed-file lint, and production build
- [x] Inspect desktop and phone-width renders
- [x] Record review results and remaining production verification

### Review
- The shell now uses a dark, product-specific work rail, a custom roof mark,
  route context, stronger account controls, and a field-focused mobile dock.
- Today is one operating board: the next stop and daily progress share one
  command surface; unresolved results and later visits use ledger rows; flexible
  follow-ups and callbacks sit below the scheduled route.
- The global ambient gradient, card sheen, card lift, and button glow are gone.
  Cards, buttons, and badges now have smaller radii and flat structural borders.
- Signed-in browser inspection passed at 1440, 900, 768, 390, and 320 px in
  dark mode, plus a light-mode phone pass. The drawer, fixed mobile dock,
  filters, command surface, result actions, and lower work queues have no
  horizontal overflow or console warnings. A tablet-only result-row squeeze
  and a truncated Completed label were found and fixed during this pass.
- The production service worker no longer registers in development. Stable dev
  asset URLs had cached an old stylesheet and caused a hydration mismatch; the
  production content-hashed offline cache remains unchanged.
- Verification passed: 45 focused contracts, TypeScript, changed-file ESLint,
  `git diff --check`, and a real Turbopack production build with all 43 pages.
- No database changes or migration are required for this redesign.

## Lead workspace redesign

Goal: make the lead book and homeowner record feel like one fast field-sales
workflow, with the same product-specific hierarchy as Today.

Architectural decisions:
- Keep list and detail behavior in their existing routes and APIs. This phase is
  an information-architecture and interaction redesign, not a data rewrite.
- Treat the list as a work queue: search and common queue choices first;
  advanced filtering and administrative maintenance stay available but quiet.
- Treat the detail page as one homeowner record: immediate contact and next-step
  actions first, live status controls second, then property and chronological
  history. Do not hide the work history behind a tab.
- Keep permissions, saved views, URL-backed filters, bulk actions, exports,
  appointment rules, DNC handling, assignment rules, and mobile touch targets.
- Use flat sections, ledgers, dividers, and sticky context. Do not recreate a
  wall of interchangeable cards or add decorative gradients and glow.

### Implementation
- [x] Redesign the Leads list as a focused work queue
- [x] Redesign Lead Detail as an action-first homeowner record
- [x] Preserve responsive, accessible, role-aware behavior
- [x] Add focused visual contracts for the new information architecture

### Verification
- [x] Run focused lead contracts, TypeScript, changed-file lint, and build
- [x] Inspect list and detail at desktop, tablet, and phone widths
- [x] Check empty, filtered, selected, DNC, and populated record states
- [x] Record review results and any production verification still required

### Review
- Leads is now a work queue with primary search, saved views, sorting, URL-backed
  presets, quiet advanced filters, mobile work rows, and a sticky desktop ledger.
- Lead Detail is now one homeowner record with immediate contact actions, visible
  safety cues, a flat status band, appointments, and one chronological activity
  timeline. Existing mutations, permissions, and dialogs remain in place.
- The responsive browser pass covered 1440 px, 1280 px, 768 px, and 390 px.
  Empty, filtered, selected, DNC, and populated states had no page overflow or
  new console warnings. All primary action targets remain at least 44 px.
- Verification passed: 55 focused contracts, TypeScript, changed-file ESLint,
  `git diff --check`, and a real Turbopack production build with all 43 pages.
- No database changes or migration were required. Commit `5992d86` is live on
  Vercel, and the signed-in production Leads queue passed its final check.

## Map workspace redesign

Goal: turn Map into a focused field-work workspace where the map stays primary
while browsing leads, planning territories, selecting work, and canvassing.

Architectural decisions:
- Keep `LeadMap` as one stable, measured canvas. Preserve its layer order,
  marker meanings, pure-freehand drawing, pointer cancellation, offline result
  flow, and territory execution behavior.
- Model Browse, Select Area, Draw Territory, Add House, and Execute Territory as
  explicit workspace modes. Treat filters and storm data as view layers, not
  competing modes.
- Put role-aware work controls over the map on desktop. On phones, keep
  Territories and Add House immediate and move secondary tools into a bottom
  sheet so opening them never reduces map height.
- Keep safety warnings above actions. Add Call, Text, Directions, and Open Lead
  to the lead popup with 44 px targets; Do Not Call blocks phone actions only.
- Clear selection and drawn selection areas whenever a lead-set filter changes,
  so hidden leads cannot remain in an assignment.
- Extend the existing role-scoped geo payload only with fields needed by the
  approved actions. No database or migration change is required.

### Implementation
- [x] Replace the wrapping Map toolbar with the desktop command dock
- [x] Add the mobile field-action row and non-shrinking tool sheet
- [x] Add explicit mode context, compact map status, and overlay legend
- [x] Upgrade lead popup identity, safety, contact, and navigation actions
- [x] Align the bulk selection bar and clear stale selections on every filter
- [x] Preserve all role, territory, storm, result, drawing, and offline behavior

### Verification
- [x] Add focused Map workspace and popup-action contracts
- [x] Run focused Map tests, TypeScript, changed-file lint, and build
- [x] Inspect desktop, tablet, and phone layouts in the signed-in browser
- [x] Check browse, tools, filters, storm, selection, drawing, and territory states
- [x] Record results and any production verification still required

### Review
- Map now keeps one full-height Leaflet canvas mounted while the workspace moves
  between Browse, Select Area, Draw Territory, Add House, and Execute Territory.
  Desktop controls use compact overlay docks; mobile and tablet controls use an
  immediate action row and a bottom sheet that does not resize the map.
- Lead popups now show homeowner identity and 44 px Call, Text, Directions, and
  Open actions. The role-scoped geo response supplies only the needed contact
  and address fields, and DNC still removes direct phone actions.
- Selection and lasso state now clear when market, status, or priority changes.
  The mobile bulk bar stays above the fixed navigation and keeps the existing
  500-lead assignment limit.
- Signed-in browser inspection passed at 1440, 1024, and 390 px. Browse, tool
  sheet, filters, lead popup, storm layer, territory panel, add-house, drawing,
  and selection states had no page overflow or new console warnings.
- Verification passed: 199 focused Map and territory tests, TypeScript,
  changed-file ESLint, `git diff --check`, and a real Turbopack production build
  with all 43 pages.
- No database change or migration was required. Commit `8b28416` is live on
  Vercel. The signed-in production Map loaded 967 leads in Browse mode, exposed
  the stable canvas and 44 px filter controls, and logged no browser errors.

## Remaining product interface roadmap

Phases 0–5 are implemented in the working tree. Settings, Performance, and
Buyer Profiles remain later work. Migrations 032–034 are not yet on the live
database — do not deploy this stack until they are applied.

Goal: bring Dashboard, Calendar, Import, Activity, Integrations, Settings,
Performance, and Analytics to the same workflow-based quality as Today, Leads,
and Map.

### Program decisions

- Ship one complete phase at a time. Each phase must be useful on its own and
  must not depend on an unfinished replacement.
- Build one shared report scope for market, team member, and date range. Do not
  let Dashboard, Performance, Activity, and Analytics create separate versions.
- Keep scope in the URL so refresh, browser history, bookmarks, and shared links
  preserve the current report.
- Apply role limits on the server. Admins may use team scopes. Setters and
  closers remain fixed to their own permitted records even if a URL is changed.
- Use the device timezone to create explicit `from` and `to` instants. The
  server must not guess the user's local day, week, or month.
- Use flat ledgers, compact metric strips, clear sections, and action links.
  Avoid a new wall of generic cards.
- Keep 44 px touch targets for field actions. Use mobile sheets or agendas when
  a desktop table or panel would become cramped.
- Use route-specific response models. UI components must not know database row
  shapes or repeat business rules.
- Add a migration only when the current data model cannot support the durable
  workflow. Do not use client-only grouping, temporary files, or duplicate
  parsers as substitutes for a proper boundary.
- Preserve existing permissions, DNC and DNK rules, appointment rules, market
  scope, and audit history in every phase.

### Phase 0 — Shared reporting foundation

Objective: create the stable scope and presentation system used by every
reporting page.

#### Planned work

- [x] Define one `ReportScope` contract with market, actor scope, named period,
  explicit `from` and `to` instants, and an `asOf` timestamp.
- [x] Define one URL parser and serializer for report scope.
- [x] Define one server resolver that validates dates, market access, and team
  access before any query runs.
- [x] Keep admin choices for All Team, Mine, and one team member. Setters and
  closers receive Mine only.
- [x] Create shared product patterns for a report scope bar, compact metric
  strip, exception ledger, report empty state, and drill-down link.
- [x] Define one comparison contract so a metric always compares the selected
  period with the immediately preceding period of equal length.
- [x] Define loading, partial-error, empty, and stale-data states once.
- [x] Add contract tests for URL round trips, local-day boundaries, invalid
  ranges, and role enforcement.

#### Exit criteria

- Scope survives refresh and browser back/forward navigation.
- The same URL cannot expose broader data to a setter or closer.
- Dashboard, Performance, Activity, and Analytics can consume the same contract
  without translating it into page-specific state.
- No database migration is expected for this phase.

### Phase 1 — Dashboard: Operations Overview

Objective: replace the passive card wall with one management brief that answers
what needs attention, what changed, and where to act.

#### Planned experience

- [x] Put urgent exceptions first: overdue follow-ups, unassigned leads,
  appointments missing required ownership, and active deals with no recent work.
- [ ] Define stalled-work thresholds in one tested domain module. Show the rule
  that caused each exception instead of using an unexplained warning.
- [ ] Add a compact KPI strip for new leads, contacts, appointments, sold jobs,
  and revenue. Use the same selected period for every KPI.
- [ ] Replace the large intake chart with a compact trend that supports the
  current decision and does not dominate the first screen.
- [ ] Show the current funnel as a ledger with counts, value, and direct links to
  the matching Leads queue.
- [ ] Show a team pulse for knocks, calls, appointments, outcomes, and sold jobs.
- [ ] Keep Recent Leads only when it adds new information; otherwise link to the
  Lead Book and use the space for exceptions.
- [ ] Add clear `View work` links that open URL-filtered Leads, Calendar, or
  Activity views.
- [ ] Keep refresh and show the exact `asOf` time.

#### Data and API plan

- [ ] Add a dedicated operations-overview response model instead of expanding
  the generic stats response without a boundary.
- [ ] Reuse existing lead, appointment, knock, call, and contact-activity query
  helpers so totals use the same policy as their source pages.
- [ ] Return exceptions, metrics, funnel, team pulse, prior-period comparison,
  and destination filter URLs in one scoped response.
- [ ] Keep partial sections usable when one optional query fails.

#### Exit criteria

- A manager can identify the most important problem and open the affected work
  without interpreting several unrelated cards.
- Every period metric uses the same date window and prior comparison.
- Admin, setter, and closer views pass the role matrix.
- Desktop and mobile show the first actionable item without a long scroll.
- No database migration is expected for this phase.

### Phase 2 — Calendar: Schedule Desk

Objective: make Calendar the operating schedule for inspections and adjuster
visits instead of a passive date grid.

#### Planned experience

- [ ] Keep a desktop week schedule, use a compact month overview, and replace the
  phone grid with a chronological agenda.
- [ ] Add admin filters for All Team, one setter, and one closer. Keep reps fixed
  to their permitted appointments.
- [ ] Show appointment type, time, homeowner, address, setter, closer, status,
  and outcome in a clear hierarchy.
- [ ] Add 44 px Call, Directions, Open Lead, and Record Outcome actions.
- [ ] Remove Call when the lead is DNC. Keep navigation and lead access.
- [ ] Add an unscheduled-work rail for due follow-ups that need an appointment or
  a new date.
- [ ] Show conflicts, missing ownership, and overdue outcome recording as visible
  schedule exceptions.
- [ ] Preserve week and month navigation in the URL.

#### Data and API plan

- [ ] Extend the appointment query contract with validated team scope and the
  display fields required by the schedule.
- [ ] Return setter and closer names with the appointment instead of resolving
  account IDs in the UI.
- [ ] Reuse the existing appointment-outcome mutation and result dialogs.
- [ ] Define one schedule-work response for follow-ups that are due but do not
  already have a future appointment.

#### Exit criteria

- A field rep can move from agenda item to call, directions, lead, or outcome in
  one tap.
- An admin can understand one rep's day and the whole team's week.
- The mobile agenda is fully usable at 390 px with no horizontal calendar grid.
- Existing appointment visibility and outcome rules remain enforced.
- No database migration is expected for this phase.

### Phase 3 — Import: Durable Review and Confirm

Objective: make imports safe, reviewable, resumable, and auditable before any
lead is created.

#### Planned architecture

- [ ] Evolve `lead_import_batches` into a durable import-job state machine with
  `uploaded`, `review_ready`, `processing`, `completed`, `failed`, and
  `cancelled` states.
- [ ] Store the original file in a private Supabase Storage bucket with a file
  hash, uploader, market, row count, preview summary, and retention policy.
- [ ] Use one server-side parser and validator for preview and commit. Do not
  create a second client parser that can disagree with production import rules.
- [ ] Make confirmation idempotent so a retry or double click cannot insert the
  same job twice.
- [ ] Keep the final batch as the durable receipt linked from imported leads.
- [ ] Add a migration for job state, storage reference, file hash, confirmation
  metadata, failure details, and structured preview counts.

#### Planned experience

- [ ] Step 1 — Upload: support file picker, real drag-and-drop, keyboard access,
  file replacement, market selection, and clear file limits.
- [ ] Step 2 — Review: show detected columns, mapped fields, valid rows, missing
  required fields, duplicate candidates, DNC handling, and a bounded row sample.
- [ ] Let the user cancel or replace the file before any lead is written.
- [ ] Step 3 — Confirm: show an explicit summary of what will import and what
  will be flagged or skipped.
- [ ] Step 4 — Receipt: show uploader, market, filename, timestamps, counts,
  errors, and direct links to the imported batch in Leads.
- [ ] Add a recent-imports ledger so a refresh or another session can reopen the
  receipt.

#### Exit criteria

- Preview creates no leads.
- Refreshing during review restores the same job.
- Confirming twice creates one result.
- Duplicate and DNC counts match the committed batch.
- Failed jobs keep actionable error details and never appear completed.
- File cleanup and retention are documented and tested.

### Phase 4 — Activity: Audit Log

Objective: turn the noisy event feed into a trustworthy audit trail that can
represent one bulk operation without hundreds of identical rows.

#### Planned architecture

- [ ] Add a durable `audit_operations` record for bulk actions with actor,
  operation type, market, affected count, safe metadata, and timestamp.
- [ ] Add `operation_id` to `lead_activities` so detailed per-lead history can
  link to the parent operation.
- [ ] Update bulk mutation routes to create one operation and link every affected
  lead activity in the same transaction or server operation boundary.
- [ ] Do not guess groups from matching text or nearby timestamps. Existing rows
  without an operation ID remain honest legacy events.
- [ ] Add indexes for operation, date, actor, type, and lead access patterns.

#### Planned experience

- [ ] Rename the navigation label to Audit Log while keeping the current route
  stable.
- [ ] Group results by calendar date and show both relative and absolute time.
- [ ] Render one summary row for a bulk operation with an expandable lead sample
  and affected count.
- [ ] Add lead or address search, date range, event type, market, and user scope.
- [ ] Store all filters and pagination in the URL.
- [ ] Use a mobile filter sheet and a flat desktop ledger.
- [ ] Preserve the deleted-leads panel and its separate permission boundary.

#### API plan and exit criteria

- [ ] Extend the API with validated `q`, `from`, `to`, scope, operation, and
  cursor or page parameters.
- [ ] Return operation summaries and individual events as explicit union types.
- A bulk assignment produces one audit summary, while each lead retains its own
  linked history.
- Search and filters cannot reveal leads outside the caller's visibility.
- Old events remain readable without false grouping.

### Phase 5 — Integrations: Connection Health Console

Objective: show whether each inbound connection is configured, working, stale,
or failing, and give the admin one place to fix it.

#### Planned architecture

- [ ] Define one `IntegrationConnection` response model with provider, state,
  last attempt, last success, last failure, expected cadence, recent volume,
  configuration state, and safe error summary.
- [ ] Build provider adapters for webhook API keys, email import, and Regrid.
  Keep provider secrets in their existing secure storage.
- [ ] Add durable integration health state so status does not depend on only the
  last 50 visible log rows.
- [ ] Update each provider path to record attempts, successes, failures, and
  consecutive failures at the source of truth.
- [ ] Define health rules for Not configured, Healthy, Stale, Failing, and
  Paused. A connection without an expected cadence must not be called Stale.
- [ ] Isolate provider failures so one failed request cannot hide every other
  connection.

#### Planned experience

- [ ] Replace setup cards with a compact connection ledger and clear state.
- [ ] Add provider detail panels with configuration, recent runs, error detail,
  test connection, pause or resume, and setup guidance.
- [ ] Move Regrid and email-import configuration out of Settings and into the
  relevant integration detail.
- [ ] Keep API-key reveal behavior safe: show a new secret once and never return
  the full stored key later.
- [ ] Add in-app stale or failure warnings. External alert delivery remains a
  separate decision until owned email delivery is enabled.

#### Exit criteria

- An admin can tell whether lead intake is working without reading raw logs.
- One provider failure leaves the remaining providers usable.
- Health state has a documented reason and timestamp.
- Tests cover secret handling, role access, state transitions, and partial
  failures.

### Phase 6 — Settings: Structured Administration

Objective: replace the long card stack with stable, deep-linkable settings
areas and remove integration setup from general company configuration.

#### Planned information architecture

- [ ] Create internal settings navigation for Company, Markets, Lead Rules,
  Mapping, and Notifications.
- [ ] Use stable nested routes or URL sections so a link opens the exact setting.
- [ ] Keep Regrid, webhook, and email-import setup in Integrations only.
- [ ] Keep storm delivery thresholds and recipients under Notifications.
- [ ] Keep roof pricing and default lead behavior under Lead Rules.
- [ ] Keep office region and geocoding defaults under Markets and Mapping.

#### Planned behavior

- [ ] Give each section its own loading and error boundary.
- [ ] Track saved and changed values. Warn before leaving a section with unsaved
  changes.
- [ ] Use one clear save action per section and confirm which fields changed.
- [ ] Mask secret fields and never place saved secrets back into normal text
  inputs.
- [ ] Keep all settings routes admin-only on both the page and API.
- [ ] Replace long setup code blocks with a short summary and an expandable copy
  panel only where setup code is still required.

#### Exit criteria

- An admin can reach any setting directly without scrolling through unrelated
  configuration.
- Moving integration settings does not duplicate state or create two save paths.
- Unsaved changes cannot be lost without a warning.
- No database migration is expected beyond any health-state migration already
  completed for Integrations.

### Phase 7 — Performance: Team Scoreboard

Objective: show each role the metrics it controls, the pace toward its goals,
and the work behind each result.

#### Planned experience

- [ ] Use the shared market, team, and period scope.
- [ ] Replace repeated rep cards with a sortable desktop ledger and mobile rep
  rows.
- [ ] Add Setter, Closer, and All Team views for admins.
- [ ] Setter metrics: knocks, calls, appointments set, set rate, show rate, and
  overdue follow-through.
- [ ] Closer metrics: appointments held, inspections, proposals, sold jobs,
  close rate, revenue, and average deal value.
- [ ] Give reps only their own scorecard and trend.
- [ ] Open a rep detail panel with the existing 12-week trend, goal pace, and
  direct links to the supporting work.
- [ ] Explain every denominator and retain a dash when a rate is not defined.

#### Data and goals plan

- [ ] Replace broad in-memory row loading with a stable aggregate query boundary
  that can scale beyond the current lead count.
- [ ] Add effective-dated performance targets by role, market, metric, and
  period. Do not hard-code one target forever in the UI.
- [ ] Add a migration for targets with uniqueness and effective-date rules.
- [ ] Compute pace and prior-period comparison on the server from the same
  explicit date window as the scoreboard.

#### Exit criteria

- Setter and closer scorecards contain no irrelevant headline metrics.
- Sorting, scope, and period survive refresh.
- Every displayed total can drill into visible supporting records.
- Goal changes preserve history rather than rewriting past expectations.

### Phase 8 — Analytics: Buyer Profiles, data-gated

Objective: show honest patterns in won customers without presenting a small
sample as a confident advertising recommendation.

#### Planned experience

- [ ] Rename the product surface to Buyer Profiles.
- [ ] Replace nine repeated cards with one ranked profile workspace and
  attribute navigation.
- [ ] Show sample size beside every result and define visible confidence bands.
- [ ] Use Observed, Directional, and Established labels with documented minimum
  sample sizes.
- [ ] Never combine separate top categories into a synthetic customer profile
  unless the joint distribution supports that combination.
- [ ] Remove the Facebook targeting claim. Present observed customer patterns
  and let the user decide how to use them.
- [ ] Add a data-readiness state that shows how many completed demographic
  profiles are needed and which fields are missing most often.
- [ ] Use the shared market and date scope after enough data exists.

#### Data plan and release gate

- [ ] Return per-attribute non-null sample sizes, distributions, and joint
  combinations from the analytics response.
- [ ] Define and test confidence thresholds in one domain module.
- [ ] Keep the full profile workspace behind a minimum useful sample gate.
- [ ] Release the readiness state now only if it helps data collection; release
  recommendations after production has enough won profiles.
- No database migration is expected because the demographic fields already
  exist.

### Shared definition of done for every phase

- [ ] Existing role, market, DNC, DNK, and lead-visibility contracts pass.
- [ ] New business rules have focused unit or contract tests.
- [ ] URL scope, refresh, back/forward, loading, empty, partial-error, and retry
  behavior are verified.
- [ ] Signed-in browser QA covers admin, setter, and closer behavior where the
  surface differs by role.
- [ ] Responsive QA covers 1440, 1280, 768, and 390 px with dark and light mode
  where theme styling changes.
- [ ] Primary mobile actions are at least 44 px and no page has horizontal
  overflow.
- [ ] TypeScript, changed-file ESLint, focused tests, `git diff --check`, and a
  production build pass.
- [ ] When deployment is authorized, push `main`, confirm it matches
  `origin/main`, and verify a build-specific signature on the live page.
- [ ] Document migrations, manual SQL, backup limits, and rollback steps before
  any phase that changes data.

### Delivery order and dependencies

1. Phase 0 and Phase 1 together: shared reporting scope and Operations Overview.
2. Phase 2: Schedule Desk. It can reuse the shared scope but does not depend on
   later reporting work.
3. Phase 3: Durable Import. Ship its migration and job workflow as one release.
4. Phase 4: Audit Log. Ship operation IDs before changing bulk-event UI.
5. Phase 5, then Phase 6: establish the Integrations boundary before removing
   integration configuration from Settings.
6. Phase 7: Team Scoreboard on the shared reporting scope.
7. Phase 8: Buyer Profiles after the production sample reaches the defined gate.

Do not start a later phase by adding a temporary version of a dependency that
an earlier phase is designed to own.
