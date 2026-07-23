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

