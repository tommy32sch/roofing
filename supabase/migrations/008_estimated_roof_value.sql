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
