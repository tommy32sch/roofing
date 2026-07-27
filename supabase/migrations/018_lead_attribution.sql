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
