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
