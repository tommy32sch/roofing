-- Durable, review-first lead imports.
--
-- The existing lead_import_batches row remains the permanent receipt linked by
-- leads.import_batch_id. New columns let that same row own the uploaded file,
-- preview, confirmation claim, final counts, and any actionable failure.

ALTER TABLE lead_import_batches
  ADD COLUMN status TEXT NOT NULL DEFAULT 'completed',
  ADD COLUMN uploaded_by_role TEXT,
  ADD COLUMN storage_bucket TEXT,
  ADD COLUMN storage_path TEXT,
  ADD COLUMN file_hash TEXT,
  ADD COLUMN file_size_bytes BIGINT,
  ADD COLUMN content_type TEXT,
  ADD COLUMN source_columns JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN field_mappings JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN preview_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN preview_sample JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN preview_errors JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN confirmation_plan JSONB,
  ADD COLUMN confirmation_plan_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN confirmed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN confirmed_by_name TEXT,
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN failed_at TIMESTAMPTZ,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN failure_code TEXT,
  ADD COLUMN failure_detail TEXT,
  ADD COLUMN retention_expires_at TIMESTAMPTZ,
  ADD COLUMN file_deleted_at TIMESTAMPTZ,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Rows created before this migration already represent completed imports.
UPDATE lead_import_batches
SET
  completed_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(created_at, NOW())
WHERE status = 'completed';

ALTER TABLE lead_import_batches
  ALTER COLUMN status SET DEFAULT 'uploaded',
  ADD CONSTRAINT lead_import_batches_status_check
    CHECK (status IN (
      'uploaded',
      'review_ready',
      'processing',
      'completed',
      'failed',
      'cancelled'
    )),
  ADD CONSTRAINT lead_import_batches_uploader_role_check
    CHECK (uploaded_by_role IS NULL OR uploaded_by_role IN ('admin', 'setter', 'closer')),
  ADD CONSTRAINT lead_import_batches_file_size_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 0 AND 5242880),
  ADD CONSTRAINT lead_import_batches_hash_check
    CHECK (file_hash IS NULL OR file_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT lead_import_batches_counts_check
    CHECK (
      row_count >= 0
      AND imported_count >= 0
      AND duplicate_count >= 0
      AND dnc_count >= 0
      AND skipped_count >= 0
    ),
  ADD CONSTRAINT lead_import_batches_storage_pair_check
    CHECK ((storage_bucket IS NULL) = (storage_path IS NULL)),
  ADD CONSTRAINT lead_import_batches_terminal_time_check
    CHECK (
      (status <> 'completed' OR completed_at IS NOT NULL)
      AND (status <> 'failed' OR failed_at IS NOT NULL)
      AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
    );

CREATE UNIQUE INDEX idx_lead_import_batches_storage_path
  ON lead_import_batches(storage_bucket, storage_path)
  WHERE storage_path IS NOT NULL;

CREATE INDEX idx_lead_import_batches_uploader_recent
  ON lead_import_batches(uploaded_by, created_at DESC);

CREATE INDEX idx_lead_import_batches_open_jobs
  ON lead_import_batches(uploaded_by, updated_at DESC)
  WHERE status IN ('uploaded', 'review_ready', 'processing');

CREATE INDEX idx_lead_import_batches_file_retention
  ON lead_import_batches(retention_expires_at)
  WHERE storage_path IS NOT NULL AND file_deleted_at IS NULL;

CREATE TRIGGER update_lead_import_batches_updated_at
  BEFORE UPDATE ON lead_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Source files are server-only. The application uses the service-role client;
-- no browser policy is created on storage.objects. Files expire after 30 days.
-- The import service removes expired objects in bounded batches, then records
-- file_deleted_at while retaining the database receipt indefinitely.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('lead-imports', 'lead-imports', false, 5242880)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880;

COMMENT ON COLUMN lead_import_batches.confirmation_plan IS
  'Server-only deterministic lead-id to duplicate-parent plan used to resume confirmation safely.';

COMMENT ON COLUMN lead_import_batches.retention_expires_at IS
  'Private source-file expiry. The receipt and imported leads do not expire.';
