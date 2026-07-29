-- Appointment outcomes.
--
-- Appointments record only that a visit was BOOKED. Whether anyone turned up is
-- nowhere, so "no-show rate" — the number that tells a manager which setter
-- books appointments that evaporate — cannot be computed at all. Reminders were
-- built to reduce no-shows; without this there is no way to know whether they
-- did.
--
-- Additive only. Every existing appointment becomes 'scheduled', which is what
-- it already implicitly was.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_outcome') THEN
    CREATE TYPE appointment_outcome AS ENUM (
      'scheduled',
      'completed',
      'no_show',
      'cancelled'
    );
  END IF;
END
$$;

ALTER TABLE lead_appointments
  ADD COLUMN IF NOT EXISTS outcome appointment_outcome NOT NULL DEFAULT 'scheduled';

-- When the outcome was recorded, and by whom. Separate from scheduled_at
-- because "marked no-show three days later" is itself worth seeing, and from
-- created_by because the closer who ran the visit is often not the setter who
-- booked it.
ALTER TABLE lead_appointments
  ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;

ALTER TABLE lead_appointments
  ADD COLUMN IF NOT EXISTS outcome_by UUID REFERENCES admin_users(id);

-- Reporting reads "appointments in a window grouped by outcome", so the index
-- follows that shape rather than outcome alone, which would be low-cardinality
-- and near-useless on its own.
CREATE INDEX IF NOT EXISTS idx_lead_appointments_outcome_scheduled
  ON lead_appointments(outcome, scheduled_at DESC);
