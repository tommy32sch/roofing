-- Commercial geocoder credential.
--
-- OSM and Census TIGER both lack whole blocks of newer housing — 12 leads on
-- two Florence streets were unplaceable by either, and a paid provider resolved
-- all 12 as rooftop matches from county parcel records.
--
-- Stored beside regrid_api_key rather than in an env var so an admin can rotate
-- it from Settings without a redeploy, and so it never reaches the browser
-- bundle. Nullable: with no key the app behaves exactly as it does today, which
-- is what keeps this tier optional.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS geocode_api_key TEXT;
