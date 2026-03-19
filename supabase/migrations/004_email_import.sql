-- Migration 004: Email-to-import system
-- Adds email import logging and configuration

-- Email import log table
CREATE TABLE email_import_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_email TEXT NOT NULL,
  subject TEXT,
  attachment_name TEXT,
  source_id INTEGER REFERENCES lead_sources(id),
  leads_imported INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  errors TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_import_logs_created_at ON email_import_logs(created_at DESC);

-- Email import settings
ALTER TABLE app_settings ADD COLUMN email_import_enabled BOOLEAN DEFAULT false;
ALTER TABLE app_settings ADD COLUMN allowed_sender_emails TEXT[] DEFAULT '{}';
