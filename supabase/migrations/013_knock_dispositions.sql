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
