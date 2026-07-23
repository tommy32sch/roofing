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
