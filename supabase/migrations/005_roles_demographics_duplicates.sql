-- Migration 005: Role system, won-lead demographics, duplicate flagging

-- 1. Role enum and column
CREATE TYPE user_role AS ENUM ('admin', 'setter', 'closer');
ALTER TABLE admin_users ADD COLUMN role user_role NOT NULL DEFAULT 'admin';

-- 2. Won-lead demographic fields
ALTER TABLE leads ADD COLUMN career TEXT;
ALTER TABLE leads ADD COLUMN family_size INTEGER;
ALTER TABLE leads ADD COLUMN marital_status TEXT;
ALTER TABLE leads ADD COLUMN age_range TEXT;
ALTER TABLE leads ADD COLUMN household_income_range TEXT;
ALTER TABLE leads ADD COLUMN education_level TEXT;
ALTER TABLE leads ADD COLUMN years_in_home INTEGER;
ALTER TABLE leads ADD COLUMN insurance_carrier TEXT;
ALTER TABLE leads ADD COLUMN decision_maker TEXT;
ALTER TABLE leads ADD COLUMN referral_source TEXT;
ALTER TABLE leads ADD COLUMN demographic_captured_at TIMESTAMPTZ;

-- 3. Duplicate flagging
ALTER TABLE leads ADD COLUMN is_flagged_duplicate BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN duplicate_of_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- 4. Indexes
CREATE INDEX idx_leads_flagged_dup ON leads(is_flagged_duplicate) WHERE is_flagged_duplicate = true;
CREATE INDEX idx_leads_duplicate_of ON leads(duplicate_of_id) WHERE duplicate_of_id IS NOT NULL;
CREATE INDEX idx_admin_users_role ON admin_users(role);
