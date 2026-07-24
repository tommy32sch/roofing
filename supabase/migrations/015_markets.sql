-- Markets (offices). The company runs more than one branch — Arizona and
-- Minnesota — and a rep should work their own book rather than scrolling past
-- another office's leads.
--
-- Why market is stored, not derived: 615 of the 616 leads at the time of this
-- migration have NO city and NO state (the Phoenix storm list was imported
-- street-only), so there is nothing on the address to derive an office from.
-- A market can also legitimately span states, or one state can hold two
-- markets, so an explicit assignment is the durable model either way.

CREATE TABLE markets (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  -- Per-market geocoding fallback. app_settings.default_geo_city/state is a
  -- single app-wide value, which silently resolves a street-only Minnesota
  -- address into Arizona once a second office exists. Geocoding now prefers
  -- the lead's own market.
  default_geo_city TEXT,
  default_geo_state TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO markets (name, default_geo_city, default_geo_state, sort_order) VALUES
  ('Arizona',   'Phoenix',     'AZ', 1),
  ('Minnesota', 'Minneapolis', 'MN', 2);

-- Leads belong to a market. ON DELETE SET NULL so retiring an office never
-- deletes its lead history.
ALTER TABLE leads ADD COLUMN market_id INTEGER REFERENCES markets(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_market ON leads(market_id);
-- The list and map filter by market together with status, the two most common
-- filters applied at once.
CREATE INDEX idx_leads_market_status ON leads(market_id, status);

-- A user's home office. Their Leads/Map/reporting default here; they can still
-- switch markets — this is a default, not an access restriction.
ALTER TABLE admin_users ADD COLUMN market_id INTEGER REFERENCES markets(id) ON DELETE SET NULL;

-- Backfill: every existing lead came from the Phoenix storm list.
UPDATE leads SET market_id = (SELECT id FROM markets WHERE name = 'Arizona')
WHERE market_id IS NULL;

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON markets FOR ALL USING (auth.role() = 'service_role');
