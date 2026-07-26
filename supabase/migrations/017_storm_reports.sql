-- Stored NOAA severe-weather history, so the map can show two years instead of 90 days.
--
-- Why store it rather than keep fetching:
--
-- The map used to pull one CSV per day from NOAA on demand, which put a hard
-- ceiling on the window. Measured at 66 ms/file, two years is ~730 files per
-- type — roughly 48s each, 96s for both, over the function's 60s limit. Worse,
-- the cache lived in process memory, so every cold start paid the whole cost
-- again, and 1,460 requests to NOAA per cold start is not a reasonable thing to
-- do to a public service.
--
-- Storm history is immutable: a hailstorm from 2024 is never going to change.
-- Fetching it once and querying it locally is both faster and kinder. Volume is
-- modest — roughly 32,000 US reports a year across both types, so two years is
-- ~63,000 rows, and a metro-sized view holds only a couple of hundred.
--
-- Units are NORMALISED on the way in: hail in inches, wind in MPH. The two NOAA
-- feeds disagree (the yearly archive publishes wind in KNOTS, the daily files in
-- mph), and storing them mixed would make every historical wind report read 15%
-- low — a genuinely severe 58 mph gust would fall below the severe threshold.
-- See src/lib/storm/parse.ts.

CREATE TABLE storm_reports (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('hail', 'wind')),
  occurred_on DATE NOT NULL,
  -- Local time of day, "HH:MM". Informational, and part of report identity.
  occurred_at TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  -- Hail inches or wind mph. Null is a real value: a damage report with no
  -- measurement, which still marks a hit roof.
  value DOUBLE PRECISION,
  -- Place name. Empty for archive rows, which carry FIPS codes instead.
  location TEXT,
  state TEXT,
  -- 'archive' is NOAA's quality-controlled yearly file and supersedes 'daily'.
  source TEXT NOT NULL CHECK (source IN ('daily', 'archive')),
  -- Identity across both feeds: type + date + time + coordinates rounded to 2dp.
  -- Rounded because the daily feed publishes 2dp and the archive 4dp for the
  -- same report, so full precision would never dedupe. Unique so the loader can
  -- upsert and re-runs are idempotent.
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The map's query is: one type, a date window, a bounding box, ordered by
-- severity. Leading with (type, occurred_on) narrows hardest; at this row count
-- the bbox is a cheap filter on the remainder.
CREATE INDEX idx_storm_reports_type_date ON storm_reports(type, occurred_on DESC);
CREATE INDEX idx_storm_reports_bbox ON storm_reports(lat, lon);
-- Supports "worst first" when a wide view has to be capped.
CREATE INDEX idx_storm_reports_severity ON storm_reports(type, value DESC NULLS LAST);

ALTER TABLE storm_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON storm_reports FOR ALL USING (auth.role() = 'service_role');
