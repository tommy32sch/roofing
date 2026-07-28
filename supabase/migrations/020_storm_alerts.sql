-- Storm alerts.
--
-- NOAA's daily storm reports are preliminary point reports, not forecasts or
-- radar polygons. This schema keeps ingestion health, market matching,
-- in-app events, and email delivery separate so a NOAA or Resend failure can
-- never erase an alert that was already discovered.

CREATE TABLE storm_ingestion_state (
  type TEXT PRIMARY KEY CHECK (type IN ('hail', 'wind')),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_new_report_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO storm_ingestion_state (type) VALUES ('hail'), ('wind')
ON CONFLICT (type) DO NOTHING;

CREATE TABLE storm_alert_rules (
  market_id INTEGER PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  -- Deliberately false: applying the migration or deploying the cron sends
  -- nothing until an admin configures recipients and opts a market in.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  radius_miles DOUBLE PRECISION NOT NULL DEFAULT 50
    CHECK (radius_miles BETWEEN 5 AND 150),
  hail_min_inches DOUBLE PRECISION NOT NULL DEFAULT 1
    CHECK (hail_min_inches BETWEEN 0 AND 10),
  wind_min_mph DOUBLE PRECISION NOT NULL DEFAULT 58
    CHECK (wind_min_mph BETWEEN 0 AND 250),
  include_unmeasured_wind BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE storm_alert_subscriptions (
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_id, user_id)
);

CREATE INDEX idx_storm_alert_subscriptions_user
  ON storm_alert_subscriptions(user_id, market_id);

CREATE TABLE storm_alert_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('hail', 'wind')),
  occurred_on DATE NOT NULL,
  first_reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  centroid_lat DOUBLE PRECISION NOT NULL CHECK (centroid_lat BETWEEN -90 AND 90),
  centroid_lon DOUBLE PRECISION NOT NULL CHECK (centroid_lon BETWEEN -180 AND 180),
  peak_value DOUBLE PRECISION,
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  closest_distance_miles DOUBLE PRECISION NOT NULL CHECK (closest_distance_miles >= 0),
  -- 0=below standard/unmeasured, 1=1in or 58mph, 2=1.5in or 74mph,
  -- 3=2in or 90mph. Email escalates only when this number increases.
  severity_band INTEGER NOT NULL DEFAULT 0 CHECK (severity_band BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, type, occurred_on)
);

CREATE INDEX idx_storm_alert_events_market_updated
  ON storm_alert_events(market_id, updated_at DESC);

CREATE TABLE storm_alert_hits (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES storm_alert_events(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  storm_report_id BIGINT NOT NULL REFERENCES storm_reports(id) ON DELETE CASCADE,
  distance_miles DOUBLE PRECISION NOT NULL CHECK (distance_miles >= 0),
  observed_value DOUBLE PRECISION,
  severity_band INTEGER NOT NULL CHECK (severity_band BETWEEN 0 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, storm_report_id)
);

CREATE INDEX idx_storm_alert_hits_event ON storm_alert_hits(event_id);

CREATE TABLE storm_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES storm_alert_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'escalation')),
  severity_band INTEGER NOT NULL CHECK (severity_band BETWEEN 0 AND 3),
  -- Stable key is the outbox idempotency boundary. Initial delivery omits the
  -- band; escalation includes it, so each higher band can notify exactly once.
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_storm_alert_deliveries_ready
  ON storm_alert_deliveries(status, next_attempt_at)
  WHERE status IN ('pending', 'failed', 'processing') AND attempt_count < 3;

CREATE TABLE storm_alert_reads (
  event_id UUID NOT NULL REFERENCES storm_alert_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX idx_storm_alert_reads_user_market
  ON storm_alert_reads(user_id, market_id);

-- Atomically claim retryable outbox rows. Vercel can overlap or duplicate cron
-- invocations; SKIP LOCKED plus the delivery dedupe key prevents double sends.
CREATE OR REPLACE FUNCTION claim_storm_alert_deliveries(p_limit INTEGER DEFAULT 25)
RETURNS SETOF storm_alert_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM storm_alert_deliveries
    WHERE attempt_count < 3
      AND next_attempt_at <= NOW()
      AND (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND locked_at < NOW() - INTERVAL '10 minutes')
      )
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE storm_alert_deliveries d
  SET status = 'processing',
      attempt_count = d.attempt_count + 1,
      locked_at = NOW(),
      updated_at = NOW()
  FROM candidates c
  WHERE d.id = c.id
  RETURNING d.*;
END;
$$;

-- SECURITY DEFINER bypasses RLS, so the function must not retain PostgreSQL's
-- default PUBLIC execute privilege. Only the server-side service client may
-- claim delivery work.
REVOKE EXECUTE ON FUNCTION claim_storm_alert_deliveries(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_storm_alert_deliveries(INTEGER)
  TO service_role;

CREATE TRIGGER update_storm_ingestion_state_updated_at
  BEFORE UPDATE ON storm_ingestion_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_rules_updated_at
  BEFORE UPDATE ON storm_alert_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_subscriptions_updated_at
  BEFORE UPDATE ON storm_alert_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_events_updated_at
  BEFORE UPDATE ON storm_alert_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_hits_updated_at
  BEFORE UPDATE ON storm_alert_hits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storm_alert_deliveries_updated_at
  BEFORE UPDATE ON storm_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE storm_ingestion_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_alert_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON storm_ingestion_state
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_rules
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_subscriptions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_events
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_hits
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_deliveries
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON storm_alert_reads
  FOR ALL USING (auth.role() = 'service_role');
