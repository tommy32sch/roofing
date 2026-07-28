# Lessons

## Own the deployment when the user asks for deployment
- **Correction:** after the owner configured Resend, I told them to redeploy
  Vercel themselves even though deployment was already within the requested
  workflow.
- **Rules:**
  - When the owner asks to deploy or validate newly added production
    configuration, trigger the deployment directly if repository access and
    deployment credentials are available.
  - Treat a Vercel environment-variable change as incomplete until a new
    production build has finished; the existing deployment will not receive it.
  - Separate deployment verification from authenticated feature verification:
    confirm the new production commit first, then use a signed-in session for
    admin-only configuration checks.

## New persistent workflows must preserve the transient workflow they extend
- **Correction:** saved territories replaced the map's existing “Draw area”
  lead-selection action. Territory creation requires one concrete market, so
  the replacement button was grey in “All Markets” and admins could no longer
  draw a temporary boundary just to assign leads.
- **Rules:**
  - When adding persistence to an existing gesture, keep the original transient
    action unless the owner explicitly agrees to replace it.
  - Different outcomes need explicit intent state. A shared drawing surface can
    support `selection` and `territory`, but `Finish` must branch on the chosen
    intent rather than silently changing what the gesture means.
  - Encode each action's prerequisites separately: temporary selection needs
    shown leads; a saved territory needs one market and may be created before
    that market has leads.
  - Add a regression test for the exact cross-product that broke: in “All
    Markets” with leads, Draw Area is enabled while New Territory is disabled.

## Deploy verification: middleware makes 401 probes meaningless
- **Mistake:** verified Vercel deploys by probing a new-only API route and treating
  401 as "route exists in new build". But `src/middleware.ts` matches
  `/api/admin/:path*` and returns 401 for ANY unauthenticated path under it —
  including routes that don't exist. The probe passes on the OLD build too.
- **Rule:** to confirm a deploy on this app, check a **build fingerprint** that only
  the new build can serve — e.g. a response header changed in `next.config.ts`
  (CSP), or page content visible without auth. Never use status codes on
  middleware-guarded paths.
- **Also:** Vercel builds take ~2-3 min; a probe 30s after push tests the old build.

## Locally-minted JWTs don't work against production
- `.env.local` JWT_SECRET differs from the Vercel env. Minted tokens are for
  LOCAL dev-server e2e only; production auth checks require the user to log in.

## Always verify prod DB schema before pushing main
- Dev and prod share one Supabase project, and migrations are applied manually via
  the dashboard SQL editor. Code on main that references a column the user hasn't
  applied yet breaks production (found migration 007 missing this way). Check
  column existence against the live DB before any deploy that touches the schema.

## Don't verify table existence with a head:true count query
- Checking `.select('id', { count: 'exact', head: true })` against a MISSING table
  returns `{ error: null, count: null }` rather than an error, so it looks like a
  pass. Combined with `count ?? 0` it reported "table exists, 0 rows" for a table
  that did not exist, and appointments work was nearly pushed to main on that basis.
- Verify with a real row read instead: `.select('*').limit(1)` surfaces
  "Could not find the table 'public.X' in the schema cache". Always include a
  control query against a known-good table so a broken client can't read as a pass.

## <input type="time"> has the SAME "empty until complete" trap as datetime-local
- **Mistake:** "fixed" a greyed-out submit button by swapping `datetime-local`
  for a separate date + `<input type="time">`, believing the trap was unique to
  datetime-local. It is not. In a US (AM/PM) locale `type="time"` renders
  `hh:mm AM/PM` and its `.value` stays `''` until ALL segments — including the
  meridiem — are valid. So editing the time to a real hour leaves value `''`
  mid-entry and any all-or-nothing "date && time" combine disables the button
  exactly as before. Shipped the same bug twice.
- **Why it slipped past verification:** (1) automated `type`/keystroke tools in
  this harness deliver ZERO key events to native segmented inputs — synthetic
  typing "worked" but changed nothing; (2) headless Chromium can render
  `type="time"` as 24h with no AM/PM segment, hiding the locale-specific failure.
  A browser test that only exercises auto-fill/programmatic value-set will pass
  while the real keyboard path is broken.
- **Rules:**
  - For split date/time inputs, make the DATE the only field that can block the
    value; default or hold-with-a-hint on time, never silently disable.
  - Distinguish "mid-entry" from "empty" via `input.validity.badInput`
    (`value==='' && badInput` = partial), not by emptiness alone.
  - Put the combine logic in a PURE, unit-tested function — jsdom doesn't
    implement time/date input sanitization, so DOM tests can't cover it; a pure
    function can encode "partial -> '' -> disabled, complete -> value -> enabled".
  - Don't trust a green browser check that relied on synthetic keystrokes or
    programmatic value sets for native date/time controls; those bypass the exact
    sanitization that causes the bug.

## Map encodings: never share a hue family across meanings; labels beat ramps
- **Correction:** owner rejected the storm-zone age view — "everything just
  looks orange and red." Age was drawn red→orange→amber ON TOP of wind severity
  markers already coloured amber→orange→red. Same hues, two meanings, one
  screen; and adjacent warm hues don't visibly order anyway.
- **Rules:**
  - One variable per hue family on screen at a time. If two variables must
    coexist, hide one layer (view toggle) rather than blending them.
  - Ordered data gets a single-hue sequential ramp (strong → pale), not a
    multi-hue one.
  - When the value must be readable at any zoom, write it on the mark
    (screen-space label) — a label needs no legend. Leaflet: permanent Tooltip;
    style needs `.leaflet-tooltip.your-class` or Leaflet's own CSS wins the tie.
  - Verify by LOOKING at the render with real data, not by reasoning that the
    encoding "should" work — both zone bugs (slivers, colour mush) were only
    visible on screen.

## "Verified" means verified WHERE THE USER RUNS IT — check deploy state first
- **Correction:** owner reported a login bug four times ("still says poopsybelle",
  "it signs into chris", "still doing the same thing", "IT'S STILL DOING THE SAME
  THING"). Each time I fixed it on localhost, ran tests/build, reproduced the bug
  and the fix in the local browser, and reported it fixed and verified. All four
  reports were about `roofing-ebon.vercel.app`. Nothing had been pushed —
  `main` sat 11 commits ahead of `origin/main` the entire time, so the deployed
  app still had the ORIGINAL bug. Every "verified" claim was true and useless.
- **Rules:**
  - This repo auto-deploys `main` to Vercel. Local `main` being correct means
    NOTHING to the user. Before saying "fixed", run
    `git log --oneline origin/main..main` — if it is non-empty, the user does not
    have the fix, and say so explicitly instead of claiming it works.
  - When a user reports a bug in a deployed app, FIRST establish where they are
    testing. Ask, or infer it and state the assumption. Do not start debugging
    until that is settled.
  - When a user says "still broken" after I claimed a fix, hypothesis #1 is
    **my change never reached them** — not a new theory about the code. Check
    deploy state and cache before writing another line. I skipped this four
    times and produced three real fixes the user could not use.
  - Prove a fix against the ORIGIN THE USER USES. `curl` the production URL for
    a signature only the new build has (a header, a status code) — that is the
    only evidence that counts. Localhost proves the patch is correct, not that
    it is delivered.
  - Never say "verified" / "fixed" for a deployed app without naming the
    environment the evidence came from.

## Don't burn shared state the user depends on while testing
- **Correction:** while testing the login fix I made ~20 login attempts, which
  exhausted the login rate limiter (5 per 15 min, per IP, in-memory, so a shared
  bucket on localhost). The owner then could not log in at all, and because I had
  also left their browser holding a different user's session cookie, every
  rejected attempt dropped them back into that account. The symptom I was hired
  to fix was, at that point, partly one I had caused.
- **Rules:**
  - Testing against a live system consumes real budgets: rate limits, quotas,
    tokens, sessions. Note what a test consumes BEFORE running it in a loop.
  - Restore the state afterwards — log out, clear cookies I set, reset counters,
    restart what I exhausted — and say what I touched.
  - Never leave the user's browser signed in as a test account.
  - If a credential has to be minted for a test, revoke it in the same turn
    (here: bump `token_version`) and tell the user.

## Touch: disabling Leaflet's drag removes the touch-action guard you depend on
- **Correction:** owner reported freehand map drawing worked with a mouse but not
  on mobile — "it still has the 4 corner points". Every finger drag committed a
  single vertex instead of tracing. Diagnosed by Codex; I had two of the three
  causes.
- **Rules:**
  - `pointercancel` is NOT `pointerup`. Never bind them to one handler. A cancel
    is the browser taking the gesture away, not the user finishing it — it must
    commit nothing, and any live preview already emitted has to be rolled back.
  - The browser decides at **pointerdown** whether a gesture is a page scroll.
    `e.preventDefault()` inside `pointermove` is too late; by then it has already
    sent `pointercancel`. Set `touch-action: none` BEFORE the gesture starts.
  - Leaflet supplies that guard through its `leaflet-touch-drag` class — and
    `map.dragging.disable()` REMOVES the class. So any mode that disables
    dragging (a lasso, a measure tool) deletes the touch-action guard exactly
    when it needs it, and must set `touch-action: none` itself.
  - Restore handlers conditionally. `map.dragging.enable()` in cleanup switches
    on panning even if the caller had deliberately disabled it. Record
    `.enabled()` first and re-enable only what you turned off. Same for
    `touchZoom` and `tapHold`.
  - Track the primary `pointerId` and ignore the rest, or a second finger
    hijacks the trace mid-gesture.
  - Inline arrow callbacks in a parent + those callbacks in a `useEffect` dep
    array = listeners torn down and rebound **mid-gesture** (pointer capture goes
    with them). Hold them in a latest-props ref and keep the effect keyed only on
    what genuinely re-binds. This bug was live on desktop too and nobody saw it.
  - jsdom has no touch. Unit-test the gesture DECISION as a pure function
    (`classifyDrawGestureEnd`) and confirm on a real device — the owner's phone
    was the only thing that actually proved this fixed.
