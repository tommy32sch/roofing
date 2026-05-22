-- Deal value: estimated or actual contract amount
ALTER TABLE leads ADD COLUMN deal_value NUMERIC(10, 2);

-- Separate setter and closer assignment
ALTER TABLE leads ADD COLUMN assigned_setter_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN assigned_closer_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

-- Follow-up reminder date
ALTER TABLE leads ADD COLUMN follow_up_date DATE;

CREATE INDEX idx_leads_assigned_setter ON leads(assigned_setter_id) WHERE assigned_setter_id IS NOT NULL;
CREATE INDEX idx_leads_assigned_closer ON leads(assigned_closer_id) WHERE assigned_closer_id IS NOT NULL;
CREATE INDEX idx_leads_follow_up_date ON leads(follow_up_date) WHERE follow_up_date IS NOT NULL;
