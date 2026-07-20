-- Default geocoding region: when a lead has no city/state of its own, geocoding
-- falls back to these so street-only addresses resolve within the right area
-- instead of matching a same-named street elsewhere in the country.
ALTER TABLE app_settings ADD COLUMN default_geo_city TEXT;
ALTER TABLE app_settings ADD COLUMN default_geo_state TEXT;
