# Lead Map View (Leaflet + OSM, free geocoding)

Plan: `/Users/tommyschwieger/.claude/plans/gentle-dazzling-storm.md`
Branch: `feat/map-view`

## Tasks
- [x] Deps: leaflet 1.9.4, react-leaflet 5.0.0, @types/leaflet
- [x] Geocoding lib `src/lib/integrations/geocode.ts` (Nominatim, only-if-null writes)
- [x] Auto-geocode on lead create (fire-and-forget beside enrichLead)
- [x] Backfill script `scripts/geocode-leads.ts` (1.1s throttle, idempotent)
- [x] GET `/api/admin/leads/geo` (role-filtered, missing_coords count)
- [x] `map-constants.ts` (status colors, GeoLead type — leaflet-free for SSR)
- [x] `LeadMap.tsx` (canvas CircleMarkers, popups, FitBounds, map-ready callback)
- [x] `/admin/map` page (filters, legend, banner, selection, action bar, BulkAssignDialog)
- [x] Nav: Map item in sidebar + mobile bottom tabs (all roles)
- [x] CSP: img-src + OSM tile hosts
- [x] Verify: tsc/lint/build, geocode smoke + backfill, API role tests, UI screenshots

## Review

**Status:** complete + verified on branch `feat/map-view` (NOT yet deployed).

**What was built:** `/admin/map` plots all visible leads as status-colored pins on a
free OpenStreetMap/Leaflet map (no API key). Popups show name/address/status/est.
value + lead link. Admins select via popup buttons or "Select visible" (viewport
bounds) and bulk-assign through the existing BulkAssignDialog — zero new assignment
code. Free Nominatim geocoding: automatic on lead create, backfill script for
imports, "N leads not on map" banner. Closers get their status-restricted view.

**Verification:**
- tsc clean · zero new lint issues · build exit 0 (`/admin/map` prerendered = no SSR
  crash; geo route registered)
- Geocode smoke: Mesa AZ address → 33.40698,-111.73181 (plausible) ✓
- Backfill on real DB: 4/5 geocoded (the 4 real Mesa addresses); the fake
  "123 main st" test lead correctly failed and feeds the missing-coords banner
- API e2e (minted JWTs vs dev server): 401 unauth; admin 4 pins + missing:1;
  closer 3 pins only appointment_set/sold; status filter works
- UI e2e (production build via preview browser): tiles load through CSP, 4 pins
  correct colors, fitBounds framed the cluster, legend/banner render, mobile layout
  + bottom-tab Map link, "Select visible" → "4 selected · $33,500 est." → Assign
  dialog with correct eligible reps. No real writes (dialog closed unsubmitted).

**Notes:**
- Deploy = push main; no migrations (lat/long columns already existed)
- Backfill needs running after each bulk import (or user can re-run anytime)
- Google Maps can replace tiles later without touching the data layer
