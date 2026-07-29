-- ============================================================
-- Roof Leads CRM — complete schema
--
-- Generated from supabase/migrations/*.sql in order.
-- Paste into the SQL editor of a NEW Supabase project to create an
-- empty database matching production's structure (no data).
-- Regenerate with: npm run schema:build
-- ============================================================

-- ------------------------------------------------------------
-- 001_initial_schema.sql
-- ------------------------------------------------------------
-- Roof Leads CRM - Initial Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
CREATE TYPE lead_status AS ENUM (
  'new',
  'contacted',
  'appointment_set',
  'inspected',
  'proposal_sent',
  'sold',
  'lost'
);

CREATE TYPE lead_priority AS ENUM ('low', 'medium', 'high', 'hot');

CREATE TYPE roof_type AS ENUM (
  'asphalt_shingle',
  'metal',
  'tile',
  'slate',
  'wood_shake',
  'flat',
  'other',
  'unknown'
);

CREATE TYPE activity_type AS ENUM (
  'note',
  'status_change',
  'call',
  'email',
  'visit',
  'created',
  'updated'
);

-- Admin users
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- App settings (single-row pattern)
CREATE TABLE app_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  company_name TEXT DEFAULT 'Roof Leads',
  default_lead_status lead_status DEFAULT 'new',
  default_lead_priority lead_priority DEFAULT 'medium',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- Lead sources reference table
CREATE TABLE lead_sources (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO lead_sources (name, display_name, sort_order) VALUES
  ('hailtrace',    'HailTrace',    1),
  ('hail_watch',   'Hail Watch',   2),
  ('imgimg',       'ImgImg',       3),
  ('roof_hawk',    'Roof Hawk',    4),
  ('propstream',   'PropStream',   5),
  ('batchleads',   'BatchLeads',   6),
  ('regrid',       'Regrid',       7),
  ('door_knock',   'Door Knock',   8),
  ('referral',     'Referral',     9),
  ('storm_chase',  'Storm Chase', 10),
  ('online',       'Online/Web',  11),
  ('other',        'Other',       12);

-- Leads (core table)
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Contact info
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  email TEXT,

  -- Property info
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  home_value INTEGER,
  year_built INTEGER,

  -- Roof info
  roof_age INTEGER,
  roof_type roof_type DEFAULT 'unknown',
  roof_score INTEGER,
  roof_material_notes TEXT,

  -- Lead info
  status lead_status DEFAULT 'new',
  priority lead_priority DEFAULT 'medium',
  source_id INTEGER REFERENCES lead_sources(id),
  source_notes TEXT,

  -- Metadata
  assigned_to UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lead activities / notes log
CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  activity_type activity_type NOT NULL,
  content TEXT,
  old_status lead_status,
  new_status lead_status,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tags
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#6b7280'
);

CREATE TABLE lead_tags (
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

-- Indexes
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_priority ON leads(priority);
CREATE INDEX idx_leads_source_id ON leads(source_id);
CREATE INDEX idx_leads_phone_normalized ON leads(phone_normalized);
CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_address_zip ON leads(address_zip);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_leads_updated_at ON leads(updated_at DESC);
CREATE INDEX idx_lead_activities_lead_id ON lead_activities(lead_id);
CREATE INDEX idx_lead_activities_created_at ON lead_activities(created_at DESC);
CREATE INDEX idx_lead_tags_lead_id ON lead_tags(lead_id);
CREATE INDEX idx_lead_tags_tag_id ON lead_tags(tag_id);

-- Full text search on lead names and address
CREATE INDEX idx_leads_search ON leads USING gin(
  to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(address_street, '') || ' ' || coalesce(address_city, ''))
);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON admin_users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON app_settings FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON lead_sources FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON leads FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON lead_activities FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON tags FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON lead_tags FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read lead_sources" ON lead_sources FOR SELECT USING (true);

-- ------------------------------------------------------------
-- 002_integrations.sql
-- ------------------------------------------------------------
-- Integration API Keys and Webhook Logs

-- API keys for webhook integrations
CREATE TABLE integration_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  source_id INTEGER REFERENCES lead_sources(id),
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook call logs
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id UUID REFERENCES integration_api_keys(id),
  source_name TEXT,
  payload_summary TEXT,
  leads_imported INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  errors TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_integration_api_keys_api_key ON integration_api_keys(api_key);
CREATE INDEX idx_integration_api_keys_is_active ON integration_api_keys(is_active);
CREATE INDEX idx_webhook_logs_api_key_id ON webhook_logs(api_key_id);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

-- Row Level Security
ALTER TABLE integration_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON integration_api_keys FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON webhook_logs FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 003_enrichment.sql
-- ------------------------------------------------------------
-- Migration 003: Schema enrichment for multi-source data centralization
-- Adds: multiple contacts, mailing address, property details, hail/storm context, enrichment tracking, coordinates

-- Multiple contact methods (BatchLeads skip tracing returns up to 3 phones + 2 emails)
ALTER TABLE leads ADD COLUMN phone2 TEXT;
ALTER TABLE leads ADD COLUMN phone2_normalized TEXT;
ALTER TABLE leads ADD COLUMN phone3 TEXT;
ALTER TABLE leads ADD COLUMN phone3_normalized TEXT;
ALTER TABLE leads ADD COLUMN email2 TEXT;

-- Mailing address (absentee owner detection - from BatchLeads, PropStream, Regrid)
ALTER TABLE leads ADD COLUMN mailing_street TEXT;
ALTER TABLE leads ADD COLUMN mailing_city TEXT;
ALTER TABLE leads ADD COLUMN mailing_state TEXT;
ALTER TABLE leads ADD COLUMN mailing_zip TEXT;

-- Property enrichment fields (from Regrid API + CSV sources)
ALTER TABLE leads ADD COLUMN sqft INTEGER;
ALTER TABLE leads ADD COLUMN lot_size NUMERIC;
ALTER TABLE leads ADD COLUMN bedrooms INTEGER;
ALTER TABLE leads ADD COLUMN bathrooms NUMERIC;
ALTER TABLE leads ADD COLUMN stories INTEGER;
ALTER TABLE leads ADD COLUMN assessed_value INTEGER;
ALTER TABLE leads ADD COLUMN last_sale_date DATE;
ALTER TABLE leads ADD COLUMN last_sale_price INTEGER;
ALTER TABLE leads ADD COLUMN owner_type TEXT;
ALTER TABLE leads ADD COLUMN apn TEXT;

-- Hail/storm context (from HailTrace exports)
ALTER TABLE leads ADD COLUMN hail_date DATE;
ALTER TABLE leads ADD COLUMN hail_size_inches NUMERIC;
ALTER TABLE leads ADD COLUMN storm_id TEXT;

-- Coordinates (from Regrid, useful for map views)
ALTER TABLE leads ADD COLUMN latitude NUMERIC;
ALTER TABLE leads ADD COLUMN longitude NUMERIC;

-- Enrichment tracking
ALTER TABLE leads ADD COLUMN enriched_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN enrichment_source TEXT;

-- Indexes for new fields
CREATE INDEX idx_leads_apn ON leads(apn) WHERE apn IS NOT NULL;
CREATE INDEX idx_leads_mailing_zip ON leads(mailing_zip) WHERE mailing_zip IS NOT NULL;
CREATE INDEX idx_leads_hail_date ON leads(hail_date) WHERE hail_date IS NOT NULL;
CREATE INDEX idx_leads_enriched_at ON leads(enriched_at) WHERE enriched_at IS NOT NULL;

-- Add Regrid configuration to app_settings
ALTER TABLE app_settings ADD COLUMN regrid_api_key TEXT;
ALTER TABLE app_settings ADD COLUMN auto_enrich_enabled BOOLEAN DEFAULT false;

-- ------------------------------------------------------------
-- 004_email_import.sql
-- ------------------------------------------------------------
-- Migration 004: Email-to-import system
-- Adds email import logging and configuration

-- Email import log table
CREATE TABLE email_import_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_email TEXT NOT NULL,
  subject TEXT,
  attachment_name TEXT,
  source_id INTEGER REFERENCES lead_sources(id),
  leads_imported INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  errors TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_import_logs_created_at ON email_import_logs(created_at DESC);

-- Email import settings
ALTER TABLE app_settings ADD COLUMN email_import_enabled BOOLEAN DEFAULT false;
ALTER TABLE app_settings ADD COLUMN allowed_sender_emails TEXT[] DEFAULT '{}';

-- ------------------------------------------------------------
-- 005_roles_demographics_duplicates.sql
-- ------------------------------------------------------------
-- Migration 005: Role system, won-lead demographics, duplicate flagging

-- 1. Role enum and column
CREATE TYPE user_role AS ENUM ('admin', 'setter', 'closer');
ALTER TABLE admin_users ADD COLUMN role user_role NOT NULL DEFAULT 'admin';

-- 2. Won-lead demographic fields
ALTER TABLE leads ADD COLUMN career TEXT;
ALTER TABLE leads ADD COLUMN family_size INTEGER;
ALTER TABLE leads ADD COLUMN marital_status TEXT;
ALTER TABLE leads ADD COLUMN age_range TEXT;
ALTER TABLE leads ADD COLUMN household_income_range TEXT;
ALTER TABLE leads ADD COLUMN education_level TEXT;
ALTER TABLE leads ADD COLUMN years_in_home INTEGER;
ALTER TABLE leads ADD COLUMN insurance_carrier TEXT;
ALTER TABLE leads ADD COLUMN decision_maker TEXT;
ALTER TABLE leads ADD COLUMN referral_source TEXT;
ALTER TABLE leads ADD COLUMN demographic_captured_at TIMESTAMPTZ;

-- 3. Duplicate flagging
ALTER TABLE leads ADD COLUMN is_flagged_duplicate BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN duplicate_of_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- 4. Indexes
CREATE INDEX idx_leads_flagged_dup ON leads(is_flagged_duplicate) WHERE is_flagged_duplicate = true;
CREATE INDEX idx_leads_duplicate_of ON leads(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;
CREATE INDEX idx_admin_users_role ON admin_users(role);

-- ------------------------------------------------------------
-- 006_add_lead_sources.sql
-- ------------------------------------------------------------
INSERT INTO lead_sources (name, display_name, sort_order) VALUES
  ('cold_call', 'Cold Call', 11)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 007_deal_value_assignment.sql
-- ------------------------------------------------------------
-- Deal value: estimated or actual contract amount
ALTER TABLE leads ADD COLUMN deal_value NUMERIC(10, 2);

-- Separate setter and closer assignment
ALTER TABLE leads ADD COLUMN assigned_setter_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN assigned_closer_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

-- Follow-up reminder date
ALTER TABLE leads ADD COLUMN follow_up_date DATE;

CREATE INDEX idx_leads_assigned_setter ON leads(assigned_setter_id) WHERE assigned_setter_id IS NOT NULL;
CREATE INDEX idx_leads_assigned_closer ON leads(assigned_closer_id) WHERE assigned_closer_id IS NOT NULL;
CREATE INDEX idx_leads_follow_up_date ON leads(follow_up_date) WHERE follow_up_date IS NOT NULL;

-- ------------------------------------------------------------
-- 008_estimated_roof_value.sql
-- ------------------------------------------------------------
-- Estimated roof replacement value: system estimate derived from property data
-- (sqft, stories, roof_type) and an admin-configurable price-per-square.
-- Distinct from deal_value (the actual contract amount a closer enters).
ALTER TABLE leads ADD COLUMN estimated_roof_value NUMERIC(12, 2);

-- Indexed for later "assign / sort by total $$$ volume".
CREATE INDEX idx_leads_estimated_roof_value
  ON leads(estimated_roof_value)
  WHERE estimated_roof_value IS NOT NULL;

-- Admin-configurable base price per roofing square (100 sq ft) for an asphalt
-- shingle roof. Material differences (metal, tile, slate, ...) are auto-scaled
-- in code. NULL falls back to the built-in default (~$400/square).
ALTER TABLE app_settings ADD COLUMN roof_price_per_square NUMERIC(10, 2);

-- ------------------------------------------------------------
-- 009_lead_appointments.sql
-- ------------------------------------------------------------
-- Appointments: real date/times behind the appointment_set status.
-- 'inspection' = the sales appointment a setter books;
-- 'adjuster'   = insurance adjuster visit entered after a win.
CREATE TABLE lead_appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  appointment_type TEXT NOT NULL DEFAULT 'inspection'
    CHECK (appointment_type IN ('inspection', 'adjuster')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_appointments_scheduled ON lead_appointments(scheduled_at);
CREATE INDEX idx_lead_appointments_lead ON lead_appointments(lead_id);

ALTER TABLE lead_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_appointments FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 010_dnc.sql
-- ------------------------------------------------------------
-- Do Not Call flag, set on import when the source CSV marks a number as DNC.
ALTER TABLE leads ADD COLUMN is_dnc BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_leads_is_dnc ON leads(is_dnc) WHERE is_dnc = true;

-- ------------------------------------------------------------
-- 011_default_geo_region.sql
-- ------------------------------------------------------------
-- Default geocoding region: when a lead has no city/state of its own, geocoding
-- falls back to these so street-only addresses resolve within the right area
-- instead of matching a same-named street elsewhere in the country.
ALTER TABLE app_settings ADD COLUMN default_geo_city TEXT;
ALTER TABLE app_settings ADD COLUMN default_geo_state TEXT;

-- ------------------------------------------------------------
-- 012_token_version.sql
-- ------------------------------------------------------------
-- Session revocation support.
-- Every JWT carries the user's token_version. getAuthenticatedAdmin() rejects a
-- token whose version doesn't match the current column value, so bumping this
-- (on role change, password change, "log out everywhere", or deletion)
-- invalidates that user's existing sessions immediately instead of waiting up to
-- 24h for the token to expire.
-- Additive and backward-compatible: existing code doesn't reference this column,
-- and existing tokens (which predate the tv claim) match the default of 0.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 013_knock_dispositions.sql
-- ------------------------------------------------------------
-- Door-knock dispositions.
--
-- The daily canvassing loop: a rep stands at a door and records what happened.
-- Without this, reps keep the outcome in their head or on paper, the same door
-- gets knocked twice, and nothing is learned from the ones that didn't answer.
--
-- Append-only by design — a knock is an event that happened, not a record to
-- edit. That also keeps the denormalised columns on `leads` from drifting.

CREATE TYPE knock_disposition AS ENUM (
  'not_home',        -- most common outcome; worth revisiting
  'callback',        -- interested, come back later
  'not_interested',
  'appointment_set', -- also moves the lead's status
  'no_damage',       -- roof looked fine from the ground; stop spending time here
  'do_not_knock'     -- homeowner asked us not to return
);

CREATE TABLE lead_knocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  disposition knock_disposition NOT NULL,
  notes TEXT,
  knocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_knocks_lead ON lead_knocks(lead_id);
CREATE INDEX idx_lead_knocks_knocked_at ON lead_knocks(knocked_at DESC);

-- Denormalised onto leads so the map can colour 600+ pins without running an
-- aggregate per pin, and so the list can sort/filter by knock recency.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_knock_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_disposition knock_disposition,
  ADD COLUMN IF NOT EXISTS knock_count INTEGER NOT NULL DEFAULT 0,
  -- Persistent, like is_dnc but for the door: survives later knocks so a rep
  -- can never be told to knock a house the owner asked us to leave alone.
  ADD COLUMN IF NOT EXISTS do_not_knock BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_leads_last_knock_at ON leads(last_knock_at DESC);

ALTER TABLE lead_knocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_knocks FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 014_lead_photos.sql
-- ------------------------------------------------------------
-- Photos attached to a lead.
--
-- Damage photos are what get insurance claims approved, and right now they live
-- in reps' camera rolls and text threads. This puts them on the lead.
--
-- Only metadata lives here; the file itself sits in the private `lead-photos`
-- storage bucket, addressed by storage_path. Nothing is publicly readable —
-- these are photographs of customers' homes, so the API hands out short-lived
-- signed URLs rather than permanent links.

CREATE TABLE lead_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  -- Path within the bucket, e.g. "<lead_id>/<uuid>.jpg"
  storage_path TEXT NOT NULL UNIQUE,
  caption TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_photos_lead ON lead_photos(lead_id, created_at DESC);

ALTER TABLE lead_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_photos FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 015_markets.sql
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 016_market_center.sql
-- ------------------------------------------------------------
-- Where each office actually is on the map.
--
-- The map fits its view to the leads it is showing, which works right up until
-- a market has no leads yet: switching to Minnesota left the map sitting over
-- Phoenix, because there was nothing to fit to. A market needs a home position
-- of its own, independent of whether any leads have been imported for it.
--
-- Stored rather than geocoded on demand so switching markets is instant and
-- can't fail: a Nominatim lookup at click time would add a second of latency
-- and silently leave the map put whenever it errored or rate-limited.

ALTER TABLE markets ADD COLUMN center_lat DOUBLE PRECISION;
ALTER TABLE markets ADD COLUMN center_lng DOUBLE PRECISION;
-- Roughly metro-wide. Null falls back to the map's own default.
ALTER TABLE markets ADD COLUMN center_zoom INTEGER;

UPDATE markets SET center_lat = 33.4484, center_lng = -112.0740, center_zoom = 10
WHERE name = 'Arizona';

UPDATE markets SET center_lat = 44.9778, center_lng = -93.2650, center_zoom = 10
WHERE name = 'Minnesota';

-- ------------------------------------------------------------
-- 017_storm_reports.sql
-- ------------------------------------------------------------
-- Stored NOAA severe-weather history, so the map can show two years instead of 90 days.
--
-- Why store it rather than keep fetching:
--
-- The map used to pull one CSV per day from NOAA on demand, which put a hard
-- ceiling on the window. Measured at 66 ms/file, two years is ~730 files per
-- type — roughly 48s each, 96s for both, over the function's 60s limit. Worse,
-- the cache lived in process memory, so every cold start paid the whole cost
-- again, and 1,460 requests to NOAA per cold start is not a reasonable thing to
-- do to a public service.
--
-- Storm history is immutable: a hailstorm from 2024 is never going to change.
-- Fetching it once and querying it locally is both faster and kinder. Volume is
-- modest — roughly 32,000 US reports a year across both types, so two years is
-- ~63,000 rows, and a metro-sized view holds only a couple of hundred.
--
-- Units are NORMALISED on the way in: hail in inches, wind in MPH. The two NOAA
-- feeds disagree (the yearly archive publishes wind in KNOTS, the daily files in
-- mph), and storing them mixed would make every historical wind report read 15%
-- low — a genuinely severe 58 mph gust would fall below the severe threshold.
-- See src/lib/storm/parse.ts.

CREATE TABLE storm_reports (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('hail', 'wind')),
  occurred_on DATE NOT NULL,
  -- Local time of day, "HH:MM". Informational, and part of report identity.
  occurred_at TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  -- Hail inches or wind mph. Null is a real value: a damage report with no
  -- measurement, which still marks a hit roof.
  value DOUBLE PRECISION,
  -- Place name. Empty for archive rows, which carry FIPS codes instead.
  location TEXT,
  state TEXT,
  -- 'archive' is NOAA's quality-controlled yearly file and supersedes 'daily'.
  source TEXT NOT NULL CHECK (source IN ('daily', 'archive')),
  -- Identity across both feeds: type + date + time + coordinates rounded to 2dp.
  -- Rounded because the daily feed publishes 2dp and the archive 4dp for the
  -- same report, so full precision would never dedupe. Unique so the loader can
  -- upsert and re-runs are idempotent.
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The map's query is: one type, a date window, a bounding box, ordered by
-- severity. Leading with (type, occurred_on) narrows hardest; at this row count
-- the bbox is a cheap filter on the remainder.
CREATE INDEX idx_storm_reports_type_date ON storm_reports(type, occurred_on DESC);
CREATE INDEX idx_storm_reports_bbox ON storm_reports(lat, lon);
-- Supports "worst first" when a wide view has to be capped.
CREATE INDEX idx_storm_reports_severity ON storm_reports(type, value DESC NULLS LAST);

ALTER TABLE storm_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON storm_reports FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 018_lead_attribution.sql
-- ------------------------------------------------------------
-- Who added each lead, and which upload it came from.
--
-- Setters and closers can now import lists too, so "where did these 600 leads
-- come from" needs an answer that isn't "ask around". Every lead records the
-- account that created it, and imported leads additionally point at the batch —
-- the file, the office, the counts — so a whole upload can be reviewed as a unit.
--
-- Deliberately NOT reusing leads.source_id: that column is the vendor/channel a
-- lead came from (HailTrace, PropStream, Referral). Provenance-by-account is a
-- different question, and overloading one column with two meanings would make
-- both unreadable.

CREATE TABLE lead_import_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename TEXT NOT NULL,
  uploaded_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  -- Name snapshot. ON DELETE SET NULL keeps the batch when an account is
  -- removed, but the point of the record is WHO uploaded it — so the name is
  -- stored rather than joined, and survives the account going away or being
  -- renamed later. For an audit trail, the name at the time is the correct one.
  uploaded_by_name TEXT NOT NULL,
  market_id INTEGER REFERENCES markets(id) ON DELETE SET NULL,
  -- Counts as reported to the uploader, so the batch row and what they saw agree.
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  dnc_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_import_batches_uploader ON lead_import_batches(uploaded_by);
CREATE INDEX idx_lead_import_batches_created ON lead_import_batches(created_at DESC);

-- Attribution on the lead itself, so one column answers "added by" no matter
-- which path created it: an upload, the Add Lead form, a webhook, or email.
ALTER TABLE leads ADD COLUMN created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
-- Display name, snapshotted for the same reason as above, and because webhook
-- and email leads have no admin_users row to join to at all.
ALTER TABLE leads ADD COLUMN created_by_name TEXT;
ALTER TABLE leads ADD COLUMN import_batch_id UUID REFERENCES lead_import_batches(id) ON DELETE SET NULL;

CREATE INDEX idx_leads_created_by ON leads(created_by);
CREATE INDEX idx_leads_import_batch ON leads(import_batch_id);

-- Leads that predate this migration keep a NULL attribution rather than being
-- credited to whoever happens to run it. The UI shows them as unattributed,
-- which is the truth.

ALTER TABLE lead_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_import_batches FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 019_saved_territories.sql
-- ------------------------------------------------------------
-- Saved map territories.
--
-- The polygon is stored as JSONB in Leaflet's [latitude, longitude] order.
-- PostGIS would be unnecessary weight for the first release: the application
-- already has tested point/polygon helpers and the expected territory count is
-- small. Bounding columns let the API cheaply narrow overlap candidates.

CREATE TABLE territories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  boundary JSONB NOT NULL,
  min_lat DOUBLE PRECISION NOT NULL,
  max_lat DOUBLE PRECISION NOT NULL,
  min_lng DOUBLE PRECISION NOT NULL,
  max_lng DOUBLE PRECISION NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  owner_user_id UUID,
  created_by UUID,
  archived_at TIMESTAMPTZ,
  archived_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT territories_market_id_fkey
    FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT,
  CONSTRAINT territories_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT territories_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT territories_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT territories_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT territories_boundary_shape
    CHECK (
      jsonb_typeof(boundary) = 'array'
      AND jsonb_array_length(boundary) BETWEEN 3 AND 500
    ),
  CONSTRAINT territories_bounds_valid
    CHECK (
      min_lat BETWEEN -90 AND 90
      AND max_lat BETWEEN -90 AND 90
      AND min_lng BETWEEN -180 AND 180
      AND max_lng BETWEEN -180 AND 180
      AND min_lat <= max_lat
      AND min_lng <= max_lng
    )
);

-- A live map should never contain two active territories with the same label in
-- one office. Archived history may reuse a name later.
CREATE UNIQUE INDEX idx_territories_active_name
  ON territories (market_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX idx_territories_active_market
  ON territories (market_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX idx_territories_owner
  ON territories (owner_user_id)
  WHERE owner_user_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER update_territories_updated_at
  BEFORE UPDATE ON territories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON territories
  FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 020_storm_alerts.sql
-- ------------------------------------------------------------
-- Storm alerts.
--
-- NOAA's daily storm reports are preliminary point reports, not forecasts or
-- radar polygons. This schema keeps ingestion health, market matching,
-- in-app events, and email delivery separate so a NOAA or Resend failure can
-- never erase an alert that was already discovered.

CREATE TABLE storm_ingestion_state (
  type TEXT PRIMARY KEY CHECK (type IN ('hail', 'wind')),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_new_report_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO storm_ingestion_state (type) VALUES ('hail'), ('wind')
ON CONFLICT (type) DO NOTHING;

CREATE TABLE storm_alert_rules (
  market_id INTEGER PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  -- Deliberately false: applying the migration or deploying the cron sends
  -- nothing until an admin configures recipients and opts a market in.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  radius_miles DOUBLE PRECISION NOT NULL DEFAULT 50
    CHECK (radius_miles BETWEEN 5 AND 150),
  hail_min_inches DOUBLE PRECISION NOT NULL DEFAULT 1
    CHECK (hail_min_inches BETWEEN 0 AND 10),
  wind_min_mph DOUBLE PRECISION NOT NULL DEFAULT 58
    CHECK (wind_min_mph BETWEEN 0 AND 250),
  include_unmeasured_wind BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE storm_alert_subscriptions (
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_id, user_id)
);

CREATE INDEX idx_storm_alert_subscriptions_user
  ON storm_alert_subscriptions(user_id, market_id);

CREATE TABLE storm_alert_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('hail', 'wind')),
  occurred_on DATE NOT NULL,
  first_reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  centroid_lat DOUBLE PRECISION NOT NULL CHECK (centroid_lat BETWEEN -90 AND 90),
  centroid_lon DOUBLE PRECISION NOT NULL CHECK (centroid_lon BETWEEN -180 AND 180),
  peak_value DOUBLE PRECISION,
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  closest_distance_miles DOUBLE PRECISION NOT NULL CHECK (closest_distance_miles >= 0),
  -- 0=below standard/unmeasured, 1=1in or 58mph, 2=1.5in or 74mph,
  -- 3=2in or 90mph. Email escalates only when this number increases.
  severity_band INTEGER NOT NULL DEFAULT 0 CHECK (severity_band BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, type, occurred_on)
);

CREATE INDEX idx_storm_alert_events_market_updated
  ON storm_alert_events(market_id, updated_at DESC);

CREATE TABLE storm_alert_hits (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES storm_alert_events(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  storm_report_id BIGINT NOT NULL REFERENCES storm_reports(id) ON DELETE CASCADE,
  distance_miles DOUBLE PRECISION NOT NULL CHECK (distance_miles >= 0),
  observed_value DOUBLE PRECISION,
  severity_band INTEGER NOT NULL CHECK (severity_band BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, storm_report_id)
);

CREATE INDEX idx_storm_alert_hits_event ON storm_alert_hits(event_id);

CREATE TABLE storm_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES storm_alert_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'escalation')),
  severity_band INTEGER NOT NULL CHECK (severity_band BETWEEN 0 AND 3),
  -- Stable key is the outbox idempotency boundary. Initial delivery omits the
  -- band; escalation includes it, so each higher band can notify exactly once.
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_storm_alert_deliveries_ready
  ON storm_alert_deliveries(status, next_attempt_at)
  WHERE status IN ('pending', 'failed', 'processing') AND attempt_count < 3;

CREATE TABLE storm_alert_reads (
  event_id UUID NOT NULL REFERENCES storm_alert_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX idx_storm_alert_reads_user_market
  ON storm_alert_reads(user_id, market_id);

-- Atomically claim retryable outbox rows. Vercel can overlap or duplicate cron
-- invocations; SKIP LOCKED plus the delivery dedupe key prevents double sends.
CREATE OR REPLACE FUNCTION claim_storm_alert_deliveries(p_limit INTEGER DEFAULT 25)
RETURNS SETOF storm_alert_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM storm_alert_deliveries
    WHERE attempt_count < 3
      AND next_attempt_at <= NOW()
      AND (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND locked_at < NOW() - INTERVAL '10 minutes')
      )
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE storm_alert_deliveries d
  SET status = 'processing',
      attempt_count = d.attempt_count + 1,
      locked_at = NOW(),
      updated_at = NOW()
  FROM candidates c
  WHERE d.id = c.id
  RETURNING d.*;
END;
$$;

-- SECURITY DEFINER bypasses RLS, so the function must not retain PostgreSQL's
-- default PUBLIC execute privilege. Only the server-side service client may
-- claim delivery work.
REVOKE EXECUTE ON FUNCTION claim_storm_alert_deliveries(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_storm_alert_deliveries(INTEGER)
  TO service_role;

CREATE TRIGGER update_storm_ingestion_state_updated_at
  BEFORE UPDATE ON storm_ingestion_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_rules_updated_at
  BEFORE UPDATE ON storm_alert_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_subscriptions_updated_at
  BEFORE UPDATE ON storm_alert_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_events_updated_at
  BEFORE UPDATE ON storm_alert_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_hits_updated_at
  BEFORE UPDATE ON storm_alert_hits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_deliveries_updated_at
  BEFORE UPDATE ON storm_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE storm_ingestion_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON storm_ingestion_state
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_rules
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_subscriptions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_events
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_hits
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_deliveries
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_reads
  FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 021_appointment_reminders.sql
-- ------------------------------------------------------------
-- Appointment reminders.
--
-- A booked appointment nobody shows up to costs a closer a round trip and cools
-- the lead, so the job that prevents it needs its own durable state: which
-- reminder went out, to whom, and for which version of the booking.
--
-- Additive only. Nothing here alters or drops existing data.

-- ---------------------------------------------------------------------------
-- Markets carry their own clock.
--
-- Reminders are scheduled against a market's LOCAL calendar day, so the zone
-- has to be stored rather than inferred. Arizona does not observe DST and
-- Minnesota does; deriving a zone from the state code also breaks the first
-- time a market opens somewhere split across two of them.
-- ---------------------------------------------------------------------------
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Phoenix';

UPDATE markets SET timezone = 'America/Chicago'
  WHERE default_geo_state = 'MN' AND timezone = 'America/Phoenix';

-- ---------------------------------------------------------------------------
-- Per-market control.
--
-- notify_homeowners defaults FALSE deliberately. Reminders to reps are internal
-- mail to people who already have accounts; reminders to homeowners are
-- outbound customer contact and must be switched on by a human, not acquired by
-- running a migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_reminder_settings (
  market_id INTEGER PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify_reps BOOLEAN NOT NULL DEFAULT TRUE,
  notify_homeowners BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO appointment_reminder_settings (market_id)
  SELECT id FROM markets
  ON CONFLICT (market_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Delivery ledger — the idempotency boundary.
--
-- dedupe_key embeds the appointment's scheduled_at. Keying on the appointment
-- alone would treat a rescheduled visit as already-notified, and the customer
-- would be told the old time or nothing at all; including the instant re-arms
-- the reminders whenever the booking genuinely moves.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointment_reminder_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id UUID NOT NULL REFERENCES lead_appointments(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('rep', 'homeowner')),
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('day_before', 'morning_of')),
  -- The booking instant this reminder was built for.
  appointment_at TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_reminder_deliveries_pending
  ON appointment_reminder_deliveries(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_appointment_reminder_deliveries_appointment
  ON appointment_reminder_deliveries(appointment_id);

-- Every table in this schema is reached through the service role in app code,
-- which bypasses RLS; enabling it keeps the anon key from ever reading these
-- rows directly, matching how 019 and 020 are locked down.
ALTER TABLE appointment_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_reminder_deliveries ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 022_offline_knocks.sql
-- ------------------------------------------------------------
-- Offline knock capture.
--
-- Knocks are taken on a phone walking a street with patchy signal. Two things
-- the current schema cannot express:
--
--   1. That a replayed request is the SAME knock. Without a client-supplied
--      identity, a retry after a lost response records the door twice and
--      inflates knock_count.
--   2. That a knock happened earlier than it was received. knocked_at defaults
--      to NOW(), so a knock taken at 10:05 and synced at 11:30 claims 11:30 —
--      which corrupts knock recency, the value the map colours doors by.
--
-- Additive only. Existing rows keep a NULL client_id and are unaffected.

ALTER TABLE lead_knocks
  ADD COLUMN IF NOT EXISTS client_id UUID;

-- Partial unique index rather than a UNIQUE constraint: every knock recorded
-- before this migration has a NULL client_id, and many NULLs must stay legal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_knocks_client_id
  ON lead_knocks(client_id)
  WHERE client_id IS NOT NULL;

-- One transaction owns the event, its denormalised lead state and the activity
-- timeline. Doing these as separate REST writes leaves an unrecoverable gap if
-- the server stops after inserting the event but before updating the lead.
CREATE OR REPLACE FUNCTION record_lead_knock(
  p_lead_id UUID,
  p_disposition knock_disposition,
  p_notes TEXT,
  p_created_by UUID,
  p_knocked_at TIMESTAMPTZ,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_knock lead_knocks%ROWTYPE;
  v_existing lead_knocks%ROWTYPE;
  v_target_status lead_status;
  v_status_changed lead_status;
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_is_newest BOOLEAN;
  v_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_lead_knock requires service role';
  END IF;

  -- Fast replay path. The key is bound to the actor and full event, so a UUID
  -- accidentally reused for different work is surfaced instead of silently
  -- discarding the second knock.
  IF p_client_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
      FROM lead_knocks
      WHERE client_id = p_client_id;

    IF FOUND THEN
      IF v_existing.lead_id IS DISTINCT FROM p_lead_id
        OR v_existing.disposition IS DISTINCT FROM p_disposition
        OR v_existing.notes IS DISTINCT FROM p_notes
        OR v_existing.knocked_at IS DISTINCT FROM p_knocked_at
        OR v_existing.created_by IS DISTINCT FROM p_created_by
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'client_id_conflict'
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'knock', to_jsonb(v_existing),
        'statusChangedTo', NULL
      );
    END IF;
  END IF;

  -- Serialise all knocks for one door. Different phones may reconnect at the
  -- same moment; this lock makes the count increment and latest-time decision
  -- deterministic.
  SELECT *
    INTO v_lead
    FROM leads
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_not_found');
  END IF;

  BEGIN
    INSERT INTO lead_knocks (
      lead_id,
      disposition,
      notes,
      created_by,
      knocked_at,
      client_id
    )
    VALUES (
      p_lead_id,
      p_disposition,
      p_notes,
      p_created_by,
      p_knocked_at,
      p_client_id
    )
    RETURNING * INTO v_knock;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent replay can pass the fast lookup while the first request is
    -- uncommitted. The unique index waits for it; after the conflict, verify
    -- that it was truly the same event.
    SELECT *
      INTO v_existing
      FROM lead_knocks
      WHERE client_id = p_client_id;

    IF NOT FOUND
      OR v_existing.lead_id IS DISTINCT FROM p_lead_id
      OR v_existing.disposition IS DISTINCT FROM p_disposition
      OR v_existing.notes IS DISTINCT FROM p_notes
      OR v_existing.knocked_at IS DISTINCT FROM p_knocked_at
      OR v_existing.created_by IS DISTINCT FROM p_created_by
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'client_id_conflict'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'knock', to_jsonb(v_existing),
      'statusChangedTo', NULL
    );
  END;

  v_is_newest :=
    v_lead.last_knock_at IS NULL OR p_knocked_at >= v_lead.last_knock_at;

  v_target_status := CASE p_disposition
    WHEN 'appointment_set' THEN 'appointment_set'::lead_status
    WHEN 'callback' THEN 'contacted'::lead_status
    WHEN 'not_interested' THEN 'contacted'::lead_status
    WHEN 'no_damage' THEN 'contacted'::lead_status
    ELSE NULL
  END;

  -- Pipeline movement is monotonic and independent of arrival order. A
  -- yesterday callback arriving after today's "not home" still proves contact,
  -- but it must never pull an inspected/proposal/sold lead backwards.
  v_current_rank := CASE v_lead.status
    WHEN 'new' THEN 0
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    WHEN 'inspected' THEN 3
    WHEN 'proposal_sent' THEN 4
    WHEN 'sold' THEN 5
    WHEN 'lost' THEN 5
  END;
  v_target_rank := CASE v_target_status
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    ELSE NULL
  END;

  IF v_target_status IS NOT NULL AND v_target_rank > v_current_rank THEN
    v_status_changed := v_target_status;
  END IF;

  UPDATE leads
  SET
    knock_count = COALESCE(knock_count, 0) + 1,
    do_not_knock = do_not_knock OR p_disposition = 'do_not_knock',
    last_knock_at = CASE
      WHEN v_is_newest THEN p_knocked_at
      ELSE last_knock_at
    END,
    last_disposition = CASE
      WHEN v_is_newest THEN p_disposition
      ELSE last_disposition
    END,
    status = COALESCE(v_status_changed, status)
  WHERE id = p_lead_id;

  v_label := CASE p_disposition
    WHEN 'not_home' THEN 'Not home'
    WHEN 'callback' THEN 'Callback'
    WHEN 'appointment_set' THEN 'Appointment set'
    WHEN 'not_interested' THEN 'Not interested'
    WHEN 'no_damage' THEN 'No damage'
    WHEN 'do_not_knock' THEN 'Do not knock'
  END;

  INSERT INTO lead_activities (
    lead_id,
    activity_type,
    content,
    created_by,
    created_at
  )
  VALUES (
    p_lead_id,
    'visit',
    'Knocked — ' || v_label ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END,
    p_created_by,
    p_knocked_at
  );

  IF v_status_changed IS NOT NULL THEN
    INSERT INTO lead_activities (
      lead_id,
      activity_type,
      content,
      old_status,
      new_status,
      created_by,
      created_at
    )
    VALUES (
      p_lead_id,
      'status_change',
      'Status changed from ' || v_lead.status::TEXT ||
        ' to ' || v_status_changed::TEXT,
      v_lead.status,
      v_status_changed,
      p_created_by,
      p_knocked_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'knock', to_jsonb(v_knock),
    'statusChangedTo', v_status_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION record_lead_knock(
  UUID,
  knock_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_lead_knock(
  UUID,
  knock_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) TO service_role;

-- ------------------------------------------------------------
-- 023_contact_results.sql
-- ------------------------------------------------------------
-- Structured map results for door knocks and cold calls.
--
-- The knock table and its offline idempotency contract already exist. Extend
-- that vocabulary additively so an older deployed client, historical row, or
-- queued IndexedDB entry using `callback` / `no_damage` remains valid.

ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'call_back';
ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'referral';
ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'contract_signed';
ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'renter';

-- Keep the existing signature so deployed clients can move between versions
-- while the database migration and application deployment roll out. New enum
-- values are compared through TEXT: PostgreSQL may reject direct use of a newly
-- added enum literal until the ALTER TYPE transaction commits.
CREATE OR REPLACE FUNCTION record_lead_knock(
  p_lead_id UUID,
  p_disposition knock_disposition,
  p_notes TEXT,
  p_created_by UUID,
  p_knocked_at TIMESTAMPTZ,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_knock lead_knocks%ROWTYPE;
  v_existing lead_knocks%ROWTYPE;
  v_target_status lead_status;
  v_status_changed lead_status;
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_is_newest BOOLEAN;
  v_disposition TEXT;
  v_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_lead_knock requires service role';
  END IF;

  v_disposition := p_disposition::TEXT;

  IF p_client_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
      FROM lead_knocks
      WHERE client_id = p_client_id;

    IF FOUND THEN
      IF v_existing.lead_id IS DISTINCT FROM p_lead_id
        OR v_existing.disposition IS DISTINCT FROM p_disposition
        OR v_existing.notes IS DISTINCT FROM p_notes
        OR v_existing.knocked_at IS DISTINCT FROM p_knocked_at
        OR v_existing.created_by IS DISTINCT FROM p_created_by
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'client_id_conflict'
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'knock', to_jsonb(v_existing),
        'statusChangedTo', NULL
      );
    END IF;
  END IF;

  SELECT *
    INTO v_lead
    FROM leads
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_not_found');
  END IF;

  BEGIN
    INSERT INTO lead_knocks (
      lead_id,
      disposition,
      notes,
      created_by,
      knocked_at,
      client_id
    )
    VALUES (
      p_lead_id,
      p_disposition,
      p_notes,
      p_created_by,
      p_knocked_at,
      p_client_id
    )
    RETURNING * INTO v_knock;
  EXCEPTION WHEN unique_violation THEN
    SELECT *
      INTO v_existing
      FROM lead_knocks
      WHERE client_id = p_client_id;

    IF NOT FOUND
      OR v_existing.lead_id IS DISTINCT FROM p_lead_id
      OR v_existing.disposition IS DISTINCT FROM p_disposition
      OR v_existing.notes IS DISTINCT FROM p_notes
      OR v_existing.knocked_at IS DISTINCT FROM p_knocked_at
      OR v_existing.created_by IS DISTINCT FROM p_created_by
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'client_id_conflict'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'knock', to_jsonb(v_existing),
      'statusChangedTo', NULL
    );
  END;

  v_is_newest :=
    v_lead.last_knock_at IS NULL OR p_knocked_at >= v_lead.last_knock_at;

  -- An outcome may prove contact, but it cannot skip the required appointment
  -- scheduling or won-lead demographic workflows. Those actions own later
  -- pipeline transitions.
  v_target_status := CASE
    WHEN v_disposition IN (
      'callback',
      'call_back',
      'referral',
      'appointment_set',
      'contract_signed',
      'not_interested',
      'renter',
      'no_damage'
    ) THEN 'contacted'::lead_status
    ELSE NULL
  END;

  v_current_rank := CASE v_lead.status
    WHEN 'new' THEN 0
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    WHEN 'inspected' THEN 3
    WHEN 'proposal_sent' THEN 4
    WHEN 'sold' THEN 5
    WHEN 'lost' THEN 5
  END;
  v_target_rank := CASE v_target_status
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    ELSE NULL
  END;

  IF v_target_status IS NOT NULL AND v_target_rank > v_current_rank THEN
    v_status_changed := v_target_status;
  END IF;

  UPDATE leads
  SET
    knock_count = COALESCE(knock_count, 0) + 1,
    do_not_knock = do_not_knock OR v_disposition = 'do_not_knock',
    last_knock_at = CASE
      WHEN v_is_newest THEN p_knocked_at
      ELSE last_knock_at
    END,
    last_disposition = CASE
      WHEN v_is_newest THEN p_disposition
      ELSE last_disposition
    END,
    status = COALESCE(v_status_changed, status)
  WHERE id = p_lead_id;

  v_label := CASE v_disposition
    WHEN 'not_home' THEN 'Not Home'
    WHEN 'callback' THEN 'Go Back'
    WHEN 'call_back' THEN 'Call Back'
    WHEN 'referral' THEN 'Referral'
    WHEN 'appointment_set' THEN 'Appointment'
    WHEN 'contract_signed' THEN 'Contract Signed'
    WHEN 'not_interested' THEN 'Not Interested'
    WHEN 'renter' THEN 'Renter'
    WHEN 'do_not_knock' THEN 'Do Not Knock'
    WHEN 'no_damage' THEN 'No Damage'
    ELSE initcap(replace(v_disposition, '_', ' '))
  END;

  INSERT INTO lead_activities (
    lead_id,
    activity_type,
    content,
    created_by,
    created_at
  )
  VALUES (
    p_lead_id,
    'visit',
    'Knocked — ' || v_label ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END,
    p_created_by,
    p_knocked_at
  );

  IF v_status_changed IS NOT NULL THEN
    INSERT INTO lead_activities (
      lead_id,
      activity_type,
      content,
      old_status,
      new_status,
      created_by,
      created_at
    )
    VALUES (
      p_lead_id,
      'status_change',
      'Status changed from ' || v_lead.status::TEXT ||
        ' to ' || v_status_changed::TEXT,
      v_lead.status,
      v_status_changed,
      p_created_by,
      p_knocked_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'knock', to_jsonb(v_knock),
    'statusChangedTo', v_status_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION record_lead_knock(
  UUID,
  knock_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_lead_knock(
  UUID,
  knock_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) TO service_role;

-- Cold calls mirror knocks: append-only structured history plus denormalized
-- summary fields for a map that may load thousands of leads at once.
CREATE TYPE cold_call_disposition AS ENUM (
  'left_voicemail',
  'call_back',
  'appointment_set',
  'wrong_number',
  'do_not_call',
  'not_interested'
);

CREATE TABLE lead_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  disposition cold_call_disposition NOT NULL,
  notes TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES admin_users(id),
  client_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_calls_lead ON lead_calls(lead_id);
CREATE INDEX idx_lead_calls_called_at ON lead_calls(called_at DESC);
CREATE UNIQUE INDEX idx_lead_calls_client_id
  ON lead_calls(client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE leads
  ADD COLUMN last_call_at TIMESTAMPTZ,
  ADD COLUMN last_call_disposition cold_call_disposition,
  ADD COLUMN call_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_leads_last_call_at ON leads(last_call_at DESC);

ALTER TABLE lead_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION record_lead_call(
  p_lead_id UUID,
  p_disposition cold_call_disposition,
  p_notes TEXT,
  p_created_by UUID,
  p_called_at TIMESTAMPTZ,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_call lead_calls%ROWTYPE;
  v_existing lead_calls%ROWTYPE;
  v_target_status lead_status;
  v_status_changed lead_status;
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_is_newest BOOLEAN;
  v_disposition TEXT;
  v_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_lead_call requires service role';
  END IF;

  v_disposition := p_disposition::TEXT;

  IF p_client_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
      FROM lead_calls
      WHERE client_id = p_client_id;

    IF FOUND THEN
      IF v_existing.lead_id IS DISTINCT FROM p_lead_id
        OR v_existing.disposition IS DISTINCT FROM p_disposition
        OR v_existing.notes IS DISTINCT FROM p_notes
        OR v_existing.called_at IS DISTINCT FROM p_called_at
        OR v_existing.created_by IS DISTINCT FROM p_created_by
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'client_id_conflict'
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'call', to_jsonb(v_existing),
        'statusChangedTo', NULL
      );
    END IF;
  END IF;

  SELECT *
    INTO v_lead
    FROM leads
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_not_found');
  END IF;

  BEGIN
    INSERT INTO lead_calls (
      lead_id,
      disposition,
      notes,
      created_by,
      called_at,
      client_id
    )
    VALUES (
      p_lead_id,
      p_disposition,
      p_notes,
      p_created_by,
      p_called_at,
      p_client_id
    )
    RETURNING * INTO v_call;
  EXCEPTION WHEN unique_violation THEN
    SELECT *
      INTO v_existing
      FROM lead_calls
      WHERE client_id = p_client_id;

    IF NOT FOUND
      OR v_existing.lead_id IS DISTINCT FROM p_lead_id
      OR v_existing.disposition IS DISTINCT FROM p_disposition
      OR v_existing.notes IS DISTINCT FROM p_notes
      OR v_existing.called_at IS DISTINCT FROM p_called_at
      OR v_existing.created_by IS DISTINCT FROM p_created_by
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'client_id_conflict'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'call', to_jsonb(v_existing),
      'statusChangedTo', NULL
    );
  END;

  v_is_newest :=
    v_lead.last_call_at IS NULL OR p_called_at >= v_lead.last_call_at;

  v_target_status := CASE
    WHEN v_disposition IN (
      'call_back',
      'appointment_set',
      'do_not_call',
      'not_interested'
    ) THEN 'contacted'::lead_status
    ELSE NULL
  END;

  v_current_rank := CASE v_lead.status
    WHEN 'new' THEN 0
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    WHEN 'inspected' THEN 3
    WHEN 'proposal_sent' THEN 4
    WHEN 'sold' THEN 5
    WHEN 'lost' THEN 5
  END;
  v_target_rank := CASE v_target_status
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    ELSE NULL
  END;

  IF v_target_status IS NOT NULL AND v_target_rank > v_current_rank THEN
    v_status_changed := v_target_status;
  END IF;

  UPDATE leads
  SET
    call_count = COALESCE(call_count, 0) + 1,
    is_dnc = is_dnc OR v_disposition = 'do_not_call',
    last_call_at = CASE
      WHEN v_is_newest THEN p_called_at
      ELSE last_call_at
    END,
    last_call_disposition = CASE
      WHEN v_is_newest THEN p_disposition
      ELSE last_call_disposition
    END,
    status = COALESCE(v_status_changed, status)
  WHERE id = p_lead_id;

  v_label := CASE v_disposition
    WHEN 'left_voicemail' THEN 'Left Voicemail'
    WHEN 'call_back' THEN 'Call Back'
    WHEN 'appointment_set' THEN 'Appointment Set'
    WHEN 'wrong_number' THEN 'Wrong Number'
    WHEN 'do_not_call' THEN 'Do Not Call'
    WHEN 'not_interested' THEN 'Not Interested'
    ELSE initcap(replace(v_disposition, '_', ' '))
  END;

  INSERT INTO lead_activities (
    lead_id,
    activity_type,
    content,
    created_by,
    created_at
  )
  VALUES (
    p_lead_id,
    'call',
    'Cold called — ' || v_label ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END,
    p_created_by,
    p_called_at
  );

  IF v_status_changed IS NOT NULL THEN
    INSERT INTO lead_activities (
      lead_id,
      activity_type,
      content,
      old_status,
      new_status,
      created_by,
      created_at
    )
    VALUES (
      p_lead_id,
      'status_change',
      'Status changed from ' || v_lead.status::TEXT ||
        ' to ' || v_status_changed::TEXT,
      v_lead.status,
      v_status_changed,
      p_created_by,
      p_called_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'call', to_jsonb(v_call),
    'statusChangedTo', v_status_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION record_lead_call(
  UUID,
  cold_call_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_lead_call(
  UUID,
  cold_call_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) TO service_role;

