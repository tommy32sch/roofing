-- Integration API Keys and Webhook Logs

-- API keys for webhook integrations
CREATE TABLE integration_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  source_id INTEGER REFERENCES lead_sources(id),
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook call logs
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id UUID REFERENCES integration_api_keys(id),
  source_name TEXT,
  payload_summary TEXT,
  leads_imported INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  errors TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_integration_api_keys_api_key ON integration_api_keys(api_key);
CREATE INDEX idx_integration_api_keys_is_active ON integration_api_keys(is_active);
CREATE INDEX idx_webhook_logs_api_key_id ON webhook_logs(api_key_id);
CREATE INDEX idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

-- Row Level Security
ALTER TABLE integration_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON integration_api_keys FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON webhook_logs FOR ALL USING (auth.role() = 'service_role');
