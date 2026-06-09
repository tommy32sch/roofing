# Estimated Roof Replacement Value

Plan: `/Users/tommyschwieger/.claude/plans/gentle-dazzling-storm.md`
Branch: `feat/estimated-roof-value`

## Tasks
- [x] Migration 008: `estimated_roof_value` on leads + index; `roof_price_per_square` on app_settings
- [x] Pure calc lib `src/lib/leads/roof-value.ts` (material multipliers, pitch, waste)
- [x] Types: `Lead.estimated_roof_value`, `AppSettings.roof_price_per_square`, `DashboardStats.totalEstimatedRoofValue`
- [x] Regrid `enrichLead`: read base price + current sqft/stories/roof_type, compute, store
- [x] Create route: compute estimate from insert payload
- [x] PATCH route: recompute when sqft/stories/roof_type change (respects explicit clear)
- [x] Settings API: accept `roof_price_per_square`
- [x] Settings page: "Roof Pricing" card
- [x] Stats route: sum `totalEstimatedRoofValue` over active statuses
- [x] Dashboard: Est. roof value card
- [x] Leads list: Est. Value column
- [x] CSV export: Est. Value column
- [x] Backfill script `scripts/backfill-roof-value.ts`
- [x] Verify: tsc (clean), lint (no new issues), build (exit 0), calc sanity check

## Review

**Status:** code complete + statically verified on branch `feat/estimated-roof-value`.

**What was built:** a derived `estimated_roof_value` per lead, computed from
`sqft / stories / roof_type` and an admin-set base $/square. Auto-populates on create,
update, and Regrid enrichment. Surfaced on lead detail (Roof card, with "~N squares"),
leads list, dashboard revenue cards, and CSV export. Lives alongside `deal_value`.

**Calc** (`src/lib/leads/roof-value.ts`, pure/no-DB): footprint = sqft/stories →
×1.3 pitch → /100 → ×1.10 waste → × (base × material multiplier), rounded to $100.
Verified: 2000sqft/1story/asphalt @$400 → **$11,400 / 28.6 squares** (matches plan).

**Verification:**
- `npx tsc --noEmit` → clean
- `npm run build` → exit 0, "Compiled successfully"
- `npm run lint` → only PRE-EXISTING issues; the 2 errors are in
  `src/app/api/webhooks/email/route.ts` (untouched by this branch)
- Calc spot-checks (default, base-price scaling, multi-story metal, null sqft) all correct

**Manual steps the user must run (writes to real Supabase):**
1. Apply `supabase/migrations/008_estimated_roof_value.sql`
2. `npx tsx --env-file=.env.local scripts/backfill-roof-value.ts`
3. (optional) set a base $/square in Admin → Settings → Roof Pricing

**Live e2e deferred** until the migration is applied — the stats/leads queries select
the new column, which won't exist on the DB until step 1.

**Design notes:** server-only base-price read kept in `roof-value.server.ts` so the
pure calc stays client-safe; PATCH recompute respects an explicit `null` (clearing
sqft zeroes the estimate rather than reusing the stale value).
