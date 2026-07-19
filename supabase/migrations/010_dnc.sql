-- Do Not Call flag, set on import when the source CSV marks a number as DNC.
ALTER TABLE leads ADD COLUMN is_dnc BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_leads_is_dnc ON leads(is_dnc) WHERE is_dnc = true;
