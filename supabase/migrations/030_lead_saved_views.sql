-- User-owned saved views for the Leads work queue.
--
-- A view stores only a versioned, validated queue definition. It never stores
-- lead IDs, so imports, assignments, status changes, and deletions appear
-- immediately the next time the view is opened.

CREATE TABLE lead_saved_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  definition_version SMALLINT NOT NULL DEFAULT 1,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT lead_saved_views_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  CONSTRAINT lead_saved_views_name_length
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT lead_saved_views_definition_version
    CHECK (definition_version > 0),
  CONSTRAINT lead_saved_views_definition_shape
    CHECK (jsonb_typeof(definition) = 'object')
);

CREATE UNIQUE INDEX idx_lead_saved_views_owner_name
  ON lead_saved_views (owner_user_id, lower(btrim(name)));

CREATE INDEX idx_lead_saved_views_owner_created
  ON lead_saved_views (owner_user_id, created_at ASC);

CREATE TRIGGER update_lead_saved_views_updated_at
  BEFORE UPDATE ON lead_saved_views
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE lead_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_saved_views
  FOR ALL USING (auth.role() = 'service_role');
