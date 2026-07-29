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
