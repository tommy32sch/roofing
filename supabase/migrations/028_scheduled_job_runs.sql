-- Durable execution history for every scheduled job.
--
-- Vercel's short log window cannot prove that a quiet job ran, and delivery
-- tables only contain rows when there was work to do. This append-only ledger
-- records each authenticated invocation before work begins, then records its
-- terminal status and bounded summary. A timed-out process deliberately leaves
-- a `running` row behind, which is itself useful operational evidence.

CREATE TABLE scheduled_job_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name TEXT NOT NULL
    CHECK (job_name ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary JSONB,
  error TEXT,
  CHECK (
    (status = 'running' AND finished_at IS NULL)
    OR (status <> 'running' AND finished_at IS NOT NULL)
  )
);

CREATE INDEX idx_scheduled_job_runs_job_started
  ON scheduled_job_runs(job_name, started_at DESC);

ALTER TABLE scheduled_job_runs ENABLE ROW LEVEL SECURITY;
