-- Audit trail for deleted leads.
--
-- Deleting a lead currently leaves nothing behind. Every child table —
-- lead_activities, lead_knocks, lead_calls, lead_photos, lead_appointments — is
-- ON DELETE CASCADE, so the lead and its entire history disappear together and
-- there is no way to tell the lead ever existed, who removed it, or what was
-- lost with it.
--
-- This table deliberately has NO foreign key to leads. A reference would cascade
-- and destroy the very record we are trying to keep. lead_id is a plain UUID
-- pointing at a row that no longer exists, which is the point.
--
-- It stores a snapshot rather than a reference for the same reason: after the
-- delete there is nothing left to join to, so anything worth reading later has
-- to be copied in at the time.

CREATE TABLE IF NOT EXISTS lead_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The lead as it was. No FK: the row it names is gone.
  lead_id UUID NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  status TEXT,
  deal_value NUMERIC,
  market_id INTEGER,
  assigned_setter_id UUID,
  assigned_closer_id UUID,
  lead_created_at TIMESTAMPTZ,
  lead_created_by UUID,

  -- Who removed it. Name and role are copied rather than joined so the record
  -- still reads correctly after the account is renamed or deleted.
  deleted_by UUID,
  deleted_by_name TEXT,
  deleted_by_role TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What went with it. The counts are the signal that a deletion mattered:
  -- removing a lead with 14 knocks against it is a different act from removing
  -- a duplicate that was never worked.
  activities_destroyed INTEGER NOT NULL DEFAULT 0,
  knocks_destroyed INTEGER NOT NULL DEFAULT 0,
  calls_destroyed INTEGER NOT NULL DEFAULT 0,
  photos_destroyed INTEGER NOT NULL DEFAULT 0,
  appointments_destroyed INTEGER NOT NULL DEFAULT 0
);

-- The feed is "most recent deletions", so order by time.
CREATE INDEX IF NOT EXISTS idx_lead_deletions_deleted_at ON lead_deletions (deleted_at DESC);
-- "What did this person delete?" is the other question worth asking.
CREATE INDEX IF NOT EXISTS idx_lead_deletions_deleted_by ON lead_deletions (deleted_by);
-- Cheap lookup when someone asks what happened to a specific lead id.
CREATE INDEX IF NOT EXISTS idx_lead_deletions_lead_id ON lead_deletions (lead_id);

ALTER TABLE lead_deletions ENABLE ROW LEVEL SECURITY;
