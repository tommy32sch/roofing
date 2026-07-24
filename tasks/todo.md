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
