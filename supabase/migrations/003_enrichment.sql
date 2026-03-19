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
