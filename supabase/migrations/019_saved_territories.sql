-- Saved map territories.
--
-- The polygon is stored as JSONB in Leaflet's [latitude, longitude] order.
-- PostGIS would be unnecessary weight for the first release: the application
-- already has tested point/polygon helpers and the expected territory count is
-- small. Bounding columns let the API cheaply narrow overlap candidates.

CREATE TABLE territories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  boundary JSONB NOT NULL,
  min_lat DOUBLE PRECISION NOT NULL,
  max_lat DOUBLE PRECISION NOT NULL,
  min_lng DOUBLE PRECISION NOT NULL,
  max_lng DOUBLE PRECISION NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  owner_user_id UUID,
  created_by UUID,
  archived_at TIMESTAMPTZ,
  archived_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT territories_market_id_fkey
    FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT,
  CONSTRAINT territories_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT territories_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT territories_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT territories_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT territories_boundary_shape
    CHECK (
      jsonb_typeof(boundary) = 'array'
      AND jsonb_array_length(boundary) BETWEEN 3 AND 500
    ),
  CONSTRAINT territories_bounds_valid
    CHECK (
      min_lat BETWEEN -90 AND 90
      AND max_lat BETWEEN -90 AND 90
      AND min_lng BETWEEN -180 AND 180
      AND max_lng BETWEEN -180 AND 180
      AND min_lat <= max_lat
      AND min_lng <= max_lng
    )
);

-- A live map should never contain two active territories with the same label in
-- one office. Archived history may reuse a name later.
CREATE UNIQUE INDEX idx_territories_active_name
  ON territories (market_id, lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX idx_territories_active_market
  ON territories (market_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX idx_territories_owner
  ON territories (owner_user_id)
  WHERE owner_user_id IS NOT NULL AND archived_at IS NULL;

CREATE TRIGGER update_territories_updated_at
  BEFORE UPDATE ON territories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON territories
  FOR ALL USING (auth.role() = 'service_role');
