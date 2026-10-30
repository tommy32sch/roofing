# Product plan — make Roof Leads worth paying for

Written 2026-09-01 from a review of the repository (commit `d1f15d3`), a
read-only count of the live database, and 2026 public pricing for the products
roofing companies buy instead. No code was changed for this review.

**Ordered from most important to least important. Work top to bottom.** Do not
open a lower section while a higher one is open, unless a gate says otherwise.
Check items off here as they land.

## Snapshot on 2026-09-01 — compare against this when you come back

- 5 accounts (2 admin, 2 setter, 1 closer), 2 markets
- 967 leads: one import (July 2026), one market, all assigned to one setter;
  964 still `new`, 2 `contacted`, 1 `appointment_set`, 0 `sold`, $0 deal value
- 8 knocks, 4 appointments, 0 calls, 0 photos, 0 territories, 0 saved views
- Last field action by a person: 2026-07-30 (peak storm season)
- Storm cron healthy: 58 runs, 72,920 NOAA reports stored
- Codebase: 219 commits, ~61k lines, 1,175 tests passing, 71 API routes, no CI

Re-run the count in the Supabase SQL editor (read-only):

```sql
select
  (select count(*) from leads)                          as leads,
  (select count(*) from leads where status = 'new')     as leads_new,
  (select count(*) from leads where status = 'sold')    as sold,
  (select count(*) from lead_knocks)                    as knocks,
  (select count(*) from lead_calls)                     as calls,
  (select count(*) from lead_appointments)              as appointments,
  (select count(*) from lead_photos)                    as photos,
  (select count(*) from territories)                    as territories,
  (select max(created_at) from lead_knocks)             as last_knock;
```

The verdict in one line: the engineering is strong, the adoption is zero, and
"worth paying for" is an adoption problem first, a positioning problem second,
and a feature problem third.

---

## 1. Decide the path and find out why the reps stopped — not code

Most important. Everything below is wasted if this is skipped.

- [ ] Pick a path and write it here:
      (1) the one company pays for it — internal ROI;
      (2) other storm crews pay for it — vertical SaaS;
      (3) nobody pays — portfolio piece, stop adding admin features.
      This plan runs (1) as the gate to (2).
- [ ] Spend a day knocking with the two setters and the closer. Watch, do not
      demo. Write down every point where they reach for their phone instead of
      the app.
- [ ] Find out why usage stopped on 2026-07-30 during peak season: the reps,
      the leads, the phones, or the product. Record the answer here.
- [ ] Define the one success metric: knocks per rep per day, appointments set,
      and one sold job with a real deal value attributed to a storm territory.

## 2. Stop and stabilize — 1 to 2 weeks

- [ ] Commit or shelve the Settings/Integrations work in the working tree
      (uncommitted since 2026-08-18).
- [ ] Freeze the admin roadmap. Phase 7 Team Scoreboard and Phase 8 Buyer
      Profiles do not start until reps use the product.
- [ ] Add usage instrumentation: logins, knocks, calls, texts, appointments per
      user per day (server-side event table or PostHog). You cannot manage
      adoption you cannot see.
- [ ] Move email to production: verify a sending domain in Resend, set
      `RESEND_FROM_EMAIL`, confirm one homeowner confirmation and one storm
      alert deliver.
- [ ] Configure Upstash in production (`UPSTASH_REDIS_REST_URL`,
      `UPSTASH_REDIS_REST_TOKEN`). Confirm `/api/admin/health/rate-limit`
      reports the shared backend. Marked URGENT since July.
- [ ] Add error monitoring (Sentry or equivalent) and a Vercel log drain.
- [ ] Add GitHub Actions: `vitest run`, `tsc --noEmit`, `eslint` on every push
      and pull request.
- [ ] Run development against Supabase local (Docker) per
      `docs/DATABASE_SETUP.md`. Stop pointing `.env.local` at production.

## 3. Rep daily use — Tier 1, before anyone pays — 4 to 8 weeks

Ship these, then run one storm season with the instrumentation on.

- [ ] Two-way SMS from the lead (Twilio or Telnyx): templates, every message
      logged to the timeline, STOP/opt-out handling, respect `is_dnc`. Today an
      `sms:` link leaves the app and records nothing.
- [ ] Push notifications (web-push) for storm alerts, follow-ups due, and
      appointment reminders. Email is dead and the in-app bell needs the app
      open.
- [ ] Door capture fast enough to use: photo, voice note, one-tap disposition.
      Zero photos to date means this flow is unproven.
- [ ] Finish offline: walk-up lead and first knock sync together; photos in the
      outbox; cold launch, reconnect, and storage limits tested on a real
      iPhone and Android.
- [ ] Swath-quality storm data: NOAA MRMS MESH hail swaths (free on AWS Open
      Data) layered with the SPC spotter reports, or a licensed provider. The
      spotter points are the current differentiator and they are coarse.
- [ ] Review the instrumentation weekly. If reps still do not use it after the
      friction is gone, the product is not the problem.

### Gate A

Two or more reps log 20+ knocks a day for four consecutive weeks, and one sold
job is recorded with a real deal value. **If Gate A is not met, stop
productization work and choose path (3).**

## 4. Make the differentiator real — Tier 2 — 4 to 6 weeks

May overlap the end of section 3.

- [ ] Storm to territory in one tap: draw from a swath, assign, push to the
      setter.
- [ ] Property facts on the pin from Regrid: owner, year built, roof age, home
      value.
- [ ] Homeowner texts with opt-out: appointment confirmation, day-before
      reminder, review request after sold.
- [ ] Rep leaderboard and streaks. Reframe Phase 7 for reps, not managers; the
      metrics module already exists.
- [ ] Inspection report PDF: photos plus notes for the homeowner and adjuster.
- [ ] Insurance fields on the lead: carrier, claim number, adjuster visit,
      supplement status. `adjuster` appointments and `insurance_carrier`
      already exist.
- [ ] Sold-job handoff to JobNimbus, AccuLynx, or Roofr (API or Zapier) and a
      QuickBooks export. Integrate with the job CRMs; do not compete with them.

## 5. A second company, still single-tenant — 2 to 4 weeks per company

- [ ] Deploy a second copy (own Supabase project, own Vercel project) for a
      second roofing company that agrees to pay something, even $200 a month.
      Almost no engineering; answers the only question that matters.
- [ ] Price anchor: $49–79 per user per month, or about $299 a month flat for
      up to ten seats. Undercuts SalesRabbit Pro plus Weather (~$68–80 per
      user) with storm data included.
- [ ] Record everything that breaks in their onboarding and their data. That
      list is the spec for section 6.

### Gate B

Two companies paying, or one paying and one with a signed letter of intent.
**Only then start section 6.**

## 6. Productize — Tier 3 — 8 to 12 weeks

- [ ] Multi-tenancy: `organizations` table, `org_id` on every table, RLS keyed
      to the organization, org-scoped settings, markets, and API keys. Migrate
      both single-tenant copies in. Largest engineering item in the codebase.
- [ ] Account lifecycle: invitations, password reset, MFA. Decide Supabase Auth
      versus extending custom JWT before writing any of it.
- [ ] Stripe billing per seat, 14-day trial, plan gates.
- [ ] Replace `tile.openstreetmap.org` with a paid tile provider (MapTiler or
      Mapbox). Geocode through Geocodio and Census only. Meter Regrid and
      geocoding cost per organization.
- [ ] Legal: terms, privacy policy, DPA, and a TCPA and Do Not Call compliance
      statement — the product stores DNC flags and will send texts.
- [ ] Onboarding: sample data, a guided first territory, the existing CSV
      mapping wizard.
- [ ] Status page and a support inbox.

## 7. Widen the wedge — ongoing, after section 6

- [ ] Proposal and e-sign (Good / Better / Best) only if customers refuse the
      CRM handoff.
- [ ] Insurance claim tracking beyond fields: adjuster meeting outcomes,
      supplement timeline.
- [ ] Rep gamification beyond the leaderboard: goals, contests.

## 8. Code health — alongside the above, never instead of it

- [ ] Split the largest pages: `map/page.tsx` (1,873 lines),
      `leads/[leadId]/page.tsx` (1,467), `leads/page.tsx` (1,133),
      `activity/page.tsx` (1,013), `calendar/page.tsx` (996).
- [ ] Replace source-string contract tests (`toContain('LEAD_PAGE_SIZE')`)
      with behavior tests. Add one end-to-end test of a rep knocking a door.
- [ ] Move Performance and Analytics from whole-table in-memory loading to
      aggregate queries (already a documented follow-up).
- [ ] Decide the auth provider before section 6 adds reset, MFA, and SSO.

## Do not build

- Buyer Profiles / Analytics (Phase 8): zero won customers, no data. A small
  sample dressed as insight would mislead.
- More Audit Log or Integration Health polish: admin surfaces for a team that
  is not logging in.
- Xactimate, supplements, material ordering: AccuLynx's moat. Route around it
  with a handoff.
- Native roof measurement: Roofr and EagleView own it at $13–19 a report.
- Multi-tenancy before Gate B.

---

## Why — the findings behind the order

### Adoption and positioning (blocks everything)

- No usage: eight knocks, zero sales, idle since July 30. Every feature
  decision since August was made without a user.
- Built for admins, not reps. Of 22 pages, four serve the field (Today, Map,
  Leads, Lead detail). The August roadmap was 100% admin reporting for a team
  of two setters and one closer.
- The differentiator is coarse. NOAA SPC reports are spotter point
  observations. SalesRabbit (Verisk) and HailTrace sell radar-derived hail
  swaths with size probability — the data adjusters use.
- Revenue is a hand-typed number. The pipeline has a `proposal_sent` status
  with no proposal object, and a `deal_value` nobody has ever filled.

### Blockers to charging a second company

- Single-tenant by construction: `app_settings` is one row, `admin_users` has
  no company, `leads` and `markets` have no tenant key, RLS is
  service-role-only so isolation lives in application code across 71 routes.
- No account lifecycle: no signup, invitations, password reset, or MFA.
  Admins set passwords by hand.
- Third-party terms: the browser loads `tile.openstreetmap.org` directly and
  imports geocode through public Nominatim. OSM policy forbids heavy or
  distributed-app use without permission and bulk geocoding.
- Regrid and Geocodio are per-call costs on one shared key with no way to
  attribute cost to a customer.

### Operational risk (fix regardless of path)

- Production and development share one Supabase project; every local run
  touches real homeowner PII.
- No CI. No error monitoring or log drain.
- Upstash unconfigured in production: login limits and cron locks reset on
  every cold start.
- Email in test mode: six storm alert events exist, none delivered.
- Two weeks of Settings work uncommitted.

### Code health (secondary)

- Page components of 1,000–1,900 lines.
- Many tests assert source strings; one broke on a two-line change in August.
  No end-to-end test of the rep flow.
- Reporting loads whole tables into memory.
- Custom JWT auth means sessions, reset, MFA, and SSO are all hand-built on
  the SaaS path.

## Market reference — 2026 prices, read 2026-09-01

| Product | Price | What buyers get | Where Roof Leads stands |
| --- | --- | --- | --- |
| SalesRabbit | Pro $49/user/mo annual ($75 monthly); Weather +$19–31; Digital Contracts +$13–20 | Territories, pins, leaderboards, Verisk storm overlays, e-contracts, texting | Closest comparable. Matches territories, pins, DNC, offline. Lacks texting, contracts, leaderboards. Storm data coarser. |
| HailTrace | Quote only; ~$999–1,999/yr per region (third-party); free 1-star maps | Radar-derived hail swaths, weather history reports, canvassing pins on higher tiers | Storm data is free here but at spotter-report precision. |
| JobNimbus | ~$225/mo base + $20–75/user by role; quote only; texting +$49–249/mo | Full job CRM: estimates, insurance workflow, QuickBooks, photos | None of the job-management layer exists. Integrate, do not compete. |
| AccuLynx | Quote only; ~$100–200/user/mo reported | Deepest insurance and supplement workflow, Xactimate, material ordering, payments | Not a target. Route around it. |
| Roofr | Free Starter; $249/mo (5 seats); $349/mo (10 seats); $13–19 per measurement | Measurement to proposal to e-sign in minutes | Sets the price ceiling for a small crew: ~$250–350/mo flat. |
| CompanyCam | From $79/mo for 3 users | Photo documentation | Photo storage exists; zero photos taken. |

Sources: vendor pricing pages and third-party trackers (Augmented Trades,
Contractor Guide Pro, The Roofing Brief, Lead Mapper, Roofing Software Guide).
AccuLynx, JobNimbus, HailTrace, and SPOTIO are quote-based; their figures are
reported ranges. A storm-restoration shop typically budgets $300–800/mo for its
whole stack.

## Risks to name plainly

- The market is crowded and consolidating (SalesRabbit bought RoofLink; Roofr
  went free-tier). A solo developer loses on breadth and wins only on a sharp
  wedge for storm crews of two to ten reps.
- The July stop is the worst possible timing. Arizona monsoon and Minnesota
  hail season both peak June to August. Leads were imported in July, worked
  for about two weeks, and abandoned during peak. Find out why before writing
  code.
- Your time. This plan front-loads the cheap, high-information steps and puts
  the expensive work behind two gates so that six more months cannot be spent
  building for nobody.
