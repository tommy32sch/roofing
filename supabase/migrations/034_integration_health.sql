-- Durable health for inbound connections.
--
-- Configuration remains in its existing source tables. These rows record what
-- happened at runtime so the Integrations page does not infer health from a
-- short page of logs or expose provider secrets.

CREATE TABLE integration_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL CHECK (provider IN ('webhook', 'email_import', 'regrid')),
  api_key_id UUID UNIQUE REFERENCES integration_api_keys(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  expected_cadence_minutes INTEGER CHECK (expected_cadence_minutes > 0),
  configured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error_summary TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (provider = 'webhook' AND api_key_id IS NOT NULL) OR
    (provider IN ('email_import', 'regrid') AND api_key_id IS NULL)
  )
);

CREATE UNIQUE INDEX idx_integration_connections_singleton_provider
  ON integration_connections(provider)
  WHERE api_key_id IS NULL;

CREATE INDEX idx_integration_connections_provider
  ON integration_connections(provider, updated_at DESC);

CREATE TABLE integration_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'rejected')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  items_received INTEGER NOT NULL DEFAULT 0 CHECK (items_received >= 0),
  items_succeeded INTEGER NOT NULL DEFAULT 0 CHECK (items_succeeded >= 0),
  items_failed INTEGER NOT NULL DEFAULT 0 CHECK (items_failed >= 0),
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX idx_integration_runs_connection_started
  ON integration_runs(connection_id, started_at DESC);

CREATE INDEX idx_integration_runs_status_started
  ON integration_runs(status, started_at DESC);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON integration_connections
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access"
  ON integration_runs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER update_integration_connections_updated_at
  BEFORE UPDATE ON integration_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- One source-owned call records a run and updates its durable health state.
-- Rejected requests remain visible but do not mark a working provider failed.
CREATE OR REPLACE FUNCTION public.record_integration_run(
  p_provider TEXT,
  p_api_key_id UUID,
  p_name TEXT,
  p_status TEXT,
  p_items_received INTEGER DEFAULT 0,
  p_items_succeeded INTEGER DEFAULT 0,
  p_items_failed INTEGER DEFAULT 0,
  p_error_summary TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::JSONB,
  p_started_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection_id UUID;
  v_run_id UUID;
  v_error TEXT := NULLIF(LEFT(TRIM(COALESCE(p_error_summary, '')), 500), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_integration_run requires service role';
  END IF;

  IF p_provider NOT IN ('webhook', 'email_import', 'regrid') THEN
    RAISE EXCEPTION 'Invalid integration provider';
  END IF;
  IF p_status NOT IN ('success', 'failure', 'rejected') THEN
    RAISE EXCEPTION 'Invalid integration run status';
  END IF;
  IF (p_provider = 'webhook') IS DISTINCT FROM (p_api_key_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Webhook runs require an API key and singleton providers do not';
  END IF;
  IF p_items_received < 0 OR p_items_succeeded < 0 OR p_items_failed < 0 THEN
    RAISE EXCEPTION 'Integration counts cannot be negative';
  END IF;
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Integration metadata must be an object';
  END IF;

  IF p_api_key_id IS NOT NULL THEN
    INSERT INTO integration_connections (
      provider,
      api_key_id,
      name,
      configured_at
    )
    SELECT p_provider, key.id, COALESCE(NULLIF(TRIM(p_name), ''), key.name), key.created_at
    FROM integration_api_keys key
    WHERE key.id = p_api_key_id
    ON CONFLICT (api_key_id) DO UPDATE
      SET name = EXCLUDED.name
    RETURNING id INTO v_connection_id;
  ELSE
    INSERT INTO integration_connections (provider, name)
    VALUES (p_provider, COALESCE(NULLIF(TRIM(p_name), ''), REPLACE(p_provider, '_', ' ')))
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_connection_id
    FROM integration_connections
    WHERE provider = p_provider
      AND api_key_id IS NULL;
  END IF;

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'Integration connection could not be resolved';
  END IF;

  INSERT INTO integration_runs (
    connection_id,
    status,
    started_at,
    finished_at,
    items_received,
    items_succeeded,
    items_failed,
    error_summary,
    metadata
  )
  VALUES (
    v_connection_id,
    p_status,
    p_started_at,
    NOW(),
    p_items_received,
    p_items_succeeded,
    p_items_failed,
    v_error,
    p_metadata
  )
  RETURNING id INTO v_run_id;

  UPDATE integration_connections
  SET
    last_attempt_at = NOW(),
    last_success_at = CASE WHEN p_status = 'success' THEN NOW() ELSE last_success_at END,
    last_failure_at = CASE WHEN p_status = 'failure' THEN NOW() ELSE last_failure_at END,
    last_error_summary = CASE
      WHEN p_status = 'success' THEN NULL
      WHEN p_status = 'failure' THEN v_error
      ELSE last_error_summary
    END,
    consecutive_failures = CASE
      WHEN p_status = 'success' THEN 0
      WHEN p_status = 'failure' THEN consecutive_failures + 1
      ELSE consecutive_failures
    END
  WHERE id = v_connection_id;

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_integration_run(
  TEXT,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT,
  JSONB,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_integration_run(
  TEXT,
  UUID,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT,
  JSONB,
  TIMESTAMPTZ
) TO service_role;

-- Existing webhook keys become first-class connections without changing their
-- credentials or activation state.
INSERT INTO integration_connections (
  provider,
  api_key_id,
  name,
  is_paused,
  configured_at,
  last_attempt_at,
  last_success_at
)
SELECT
  'webhook',
  key.id,
  key.name,
  NOT COALESCE(key.is_active, FALSE),
  key.created_at,
  key.last_used_at,
  key.last_used_at
FROM integration_api_keys key
ON CONFLICT (api_key_id) DO NOTHING;

-- Singleton provider rows exist only when there is real configuration or
-- history. An untouched provider therefore remains honestly Not configured.
INSERT INTO integration_connections (provider, name, is_paused, configured_at)
SELECT
  'email_import',
  'Email import',
  NOT COALESCE(settings.email_import_enabled, FALSE),
  NOW()
FROM app_settings settings
WHERE settings.id = 'default'
  AND (
    COALESCE(settings.email_import_enabled, FALSE) OR
    CARDINALITY(COALESCE(settings.allowed_sender_emails, '{}'::TEXT[])) > 0 OR
    EXISTS (SELECT 1 FROM email_import_logs)
  )
ON CONFLICT DO NOTHING;

INSERT INTO integration_connections (provider, name, is_paused, configured_at)
SELECT
  'regrid',
  'Regrid property enrichment',
  NOT COALESCE(settings.auto_enrich_enabled, FALSE),
  NOW()
FROM app_settings settings
WHERE settings.id = 'default'
  AND NULLIF(TRIM(settings.regrid_api_key), '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Preserve existing volume and timestamps as initial run history. Payloads,
-- sender addresses, and secrets are deliberately not copied into health data.
INSERT INTO integration_runs (
  connection_id,
  status,
  started_at,
  finished_at,
  items_received,
  items_succeeded,
  items_failed,
  error_summary,
  metadata
)
SELECT
  connection.id,
  CASE
    WHEN CARDINALITY(COALESCE(log.errors, '{}'::TEXT[])) > 0
      AND COALESCE(log.leads_imported, 0) = 0
    THEN 'failure'
    ELSE 'success'
  END,
  log.created_at,
  log.created_at,
  COALESCE(log.leads_imported, 0) + COALESCE(log.duplicates_skipped, 0),
  COALESCE(log.leads_imported, 0),
  CARDINALITY(COALESCE(log.errors, '{}'::TEXT[])),
  NULLIF(LEFT(ARRAY_TO_STRING(log.errors, '; '), 500), ''),
  jsonb_build_object('backfilled', TRUE, 'duplicates', COALESCE(log.duplicates_skipped, 0))
FROM webhook_logs log
JOIN integration_connections connection
  ON connection.provider = 'webhook'
 AND connection.api_key_id = log.api_key_id;

INSERT INTO integration_runs (
  connection_id,
  status,
  started_at,
  finished_at,
  items_received,
  items_succeeded,
  items_failed,
  error_summary,
  metadata
)
SELECT
  connection.id,
  CASE
    WHEN CARDINALITY(COALESCE(log.errors, '{}'::TEXT[])) > 0
      AND COALESCE(log.leads_imported, 0) = 0
    THEN 'failure'
    ELSE 'success'
  END,
  log.created_at,
  log.created_at,
  COALESCE(log.leads_imported, 0) + COALESCE(log.duplicates_skipped, 0),
  COALESCE(log.leads_imported, 0),
  CARDINALITY(COALESCE(log.errors, '{}'::TEXT[])),
  NULLIF(LEFT(ARRAY_TO_STRING(log.errors, '; '), 500), ''),
  jsonb_build_object('backfilled', TRUE, 'duplicates', COALESCE(log.duplicates_skipped, 0))
FROM email_import_logs log
JOIN integration_connections connection
  ON connection.provider = 'email_import'
 AND connection.api_key_id IS NULL;

WITH summary AS (
  SELECT
    connection_id,
    MAX(started_at) AS last_attempt_at,
    MAX(started_at) FILTER (WHERE status = 'success') AS last_success_at,
    MAX(started_at) FILTER (WHERE status = 'failure') AS last_failure_at,
    (ARRAY_AGG(error_summary ORDER BY started_at DESC)
      FILTER (WHERE status = 'failure' AND error_summary IS NOT NULL))[1] AS last_error_summary
  FROM integration_runs
  GROUP BY connection_id
)
UPDATE integration_connections connection
SET
  last_attempt_at = summary.last_attempt_at,
  last_success_at = summary.last_success_at,
  last_failure_at = summary.last_failure_at,
  last_error_summary = CASE
    WHEN summary.last_success_at IS NULL OR summary.last_failure_at > summary.last_success_at
    THEN summary.last_error_summary
    ELSE NULL
  END,
  consecutive_failures = CASE
    WHEN summary.last_failure_at IS NOT NULL
      AND (summary.last_success_at IS NULL OR summary.last_failure_at > summary.last_success_at)
    THEN 1
    ELSE 0
  END
FROM summary
WHERE connection.id = summary.connection_id;
