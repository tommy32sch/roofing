-- Appointments: real date/times behind the appointment_set status.
-- 'inspection' = the sales appointment a setter books;
-- 'adjuster'   = insurance adjuster visit entered after a win.
CREATE TABLE lead_appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  appointment_type TEXT NOT NULL DEFAULT 'inspection'
    CHECK (appointment_type IN ('inspection', 'adjuster')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_appointments_scheduled ON lead_appointments(scheduled_at);
CREATE INDEX idx_lead_appointments_lead ON lead_appointments(lead_id);

ALTER TABLE lead_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_appointments FOR ALL USING (auth.role() = 'service_role');
