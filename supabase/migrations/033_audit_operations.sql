-- Durable, grouped audit operations.
--
-- A bulk change is one business action, even when it changes hundreds of
-- leads. Store that action once and link its per-lead history rows so the Audit
-- Log can show a concise operation without losing each lead's timeline.

CREATE TABLE audit_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('bulk_assignment')),
  actor_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  market_id INTEGER REFERENCES markets(id) ON DELETE SET NULL,
  affected_count INTEGER NOT NULL CHECK (affected_count > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON audit_operations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE lead_activities
  ADD COLUMN operation_id UUID REFERENCES audit_operations(id) ON DELETE SET NULL;

CREATE INDEX idx_audit_operations_created_at
  ON audit_operations(created_at DESC);

CREATE INDEX idx_audit_operations_actor_created
  ON audit_operations(actor_id, created_at DESC);

CREATE INDEX idx_audit_operations_type_created
  ON audit_operations(operation_type, created_at DESC);

CREATE INDEX idx_audit_operations_market_created
  ON audit_operations(market_id, created_at DESC)
  WHERE market_id IS NOT NULL;

CREATE INDEX idx_lead_activities_operation
  ON lead_activities(operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX idx_lead_activities_actor_created
  ON lead_activities(created_by, created_at DESC);

CREATE INDEX idx_lead_activities_type_created
  ON lead_activities(activity_type, created_at DESC);

-- Apply a full bulk assignment and its audit trail in one transaction. A
-- concurrent lead deletion or invalid target fails the entire operation.
CREATE OR REPLACE FUNCTION public.apply_bulk_assignment_with_audit(
  p_actor_id UUID,
  p_assignment_role TEXT,
  p_items JSONB,
  p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name TEXT;
  v_expected INTEGER;
  v_updated INTEGER;
  v_operation_id UUID;
  v_market_id INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'apply_bulk_assignment_with_audit requires service role';
  END IF;

  IF p_assignment_role NOT IN ('setter', 'closer') THEN
    RAISE EXCEPTION 'Invalid assignment role';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Assignment items must be an array';
  END IF;

  v_expected := jsonb_array_length(p_items);
  IF v_expected < 1 OR v_expected > 500 THEN
    RAISE EXCEPTION 'Assignment items must contain 1-500 rows';
  END IF;

  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Operation metadata must be an object';
  END IF;

  SELECT name INTO v_actor_name
  FROM admin_users
  WHERE id = p_actor_id;

  IF v_actor_name IS NULL THEN
    RAISE EXCEPTION 'Audit actor not found';
  END IF;

  -- The application deduplicates lead IDs. Keep the database boundary strict
  -- so another service caller cannot create conflicting assignments.
  IF (
    SELECT COUNT(DISTINCT item.lead_id)
    FROM jsonb_to_recordset(p_items) AS item(lead_id UUID, user_id UUID, content TEXT)
  ) <> v_expected THEN
    RAISE EXCEPTION 'Assignment items contain duplicate lead IDs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(lead_id UUID, user_id UUID, content TEXT)
    LEFT JOIN admin_users target ON target.id = item.user_id
    WHERE item.user_id IS NOT NULL
      AND (
        target.id IS NULL OR
        (target.role::TEXT <> p_assignment_role AND target.role::TEXT <> 'admin')
      )
  ) THEN
    RAISE EXCEPTION 'One or more assignment targets are not eligible';
  END IF;

  SELECT CASE
    WHEN COUNT(DISTINCT leads.market_id) = 1
      AND COUNT(*) FILTER (WHERE leads.market_id IS NULL) = 0
    THEN MIN(leads.market_id)
    ELSE NULL
  END
  INTO v_market_id
  FROM jsonb_to_recordset(p_items) AS item(lead_id UUID, user_id UUID, content TEXT)
  JOIN leads ON leads.id = item.lead_id;

  INSERT INTO audit_operations (
    operation_type,
    actor_id,
    actor_name,
    market_id,
    affected_count,
    metadata
  )
  VALUES (
    'bulk_assignment',
    p_actor_id,
    v_actor_name,
    v_market_id,
    v_expected,
    p_metadata || jsonb_build_object('assignment_role', p_assignment_role)
  )
  RETURNING id INTO v_operation_id;

  IF p_assignment_role = 'setter' THEN
    WITH input AS (
      SELECT item.lead_id, item.user_id, item.content
      FROM jsonb_to_recordset(p_items) AS item(lead_id UUID, user_id UUID, content TEXT)
    ),
    updated AS (
      UPDATE leads
      SET assigned_setter_id = input.user_id
      FROM input
      WHERE leads.id = input.lead_id
      RETURNING leads.id, input.content
    ),
    logged AS (
      INSERT INTO lead_activities (
        lead_id,
        activity_type,
        content,
        created_by,
        operation_id
      )
      SELECT id, 'updated', content, p_actor_id, v_operation_id
      FROM updated
      RETURNING id
    )
    SELECT COUNT(*) INTO v_updated FROM logged;
  ELSE
    WITH input AS (
      SELECT item.lead_id, item.user_id, item.content
      FROM jsonb_to_recordset(p_items) AS item(lead_id UUID, user_id UUID, content TEXT)
    ),
    updated AS (
      UPDATE leads
      SET assigned_closer_id = input.user_id
      FROM input
      WHERE leads.id = input.lead_id
      RETURNING leads.id, input.content
    ),
    logged AS (
      INSERT INTO lead_activities (
        lead_id,
        activity_type,
        content,
        created_by,
        operation_id
      )
      SELECT id, 'updated', content, p_actor_id, v_operation_id
      FROM updated
      RETURNING id
    )
    SELECT COUNT(*) INTO v_updated FROM logged;
  END IF;

  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'One or more leads changed before assignment';
  END IF;

  RETURN jsonb_build_object(
    'operation_id', v_operation_id,
    'updated_count', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_bulk_assignment_with_audit(
  UUID,
  TEXT,
  JSONB,
  JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_bulk_assignment_with_audit(
  UUID,
  TEXT,
  JSONB,
  JSONB
) TO service_role;

-- Return a single, paginated stream for the admin Audit Log. New bulk
-- operations are grouped; legacy and single-record activities remain events.
CREATE OR REPLACE FUNCTION public.list_admin_audit_feed(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_market_id INTEGER DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  item_kind TEXT,
  item_id UUID,
  activity_type TEXT,
  content TEXT,
  old_status TEXT,
  new_status TEXT,
  created_at TIMESTAMPTZ,
  actor_name TEXT,
  lead JSONB,
  operation JSONB,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH feed AS (
    SELECT
      'operation'::TEXT AS item_kind,
      operation.id AS item_id,
      operation.operation_type AS activity_type,
      CASE operation.operation_type
        WHEN 'bulk_assignment' THEN
          'Bulk ' || COALESCE(operation.metadata->>'assignment_role', 'lead') ||
          ' assignment'
        ELSE REPLACE(operation.operation_type, '_', ' ')
      END AS content,
      NULL::TEXT AS old_status,
      NULL::TEXT AS new_status,
      operation.created_at,
      operation.actor_name,
      NULL::JSONB AS lead,
      jsonb_build_object(
        'id', operation.id,
        'operation_type', operation.operation_type,
        'affected_count', CASE
          WHEN p_market_id IS NULL THEN operation.affected_count
          ELSE (
            SELECT COUNT(*)
            FROM lead_activities scoped_activity
            JOIN leads scoped_lead ON scoped_lead.id = scoped_activity.lead_id
            WHERE scoped_activity.operation_id = operation.id
              AND scoped_lead.market_id = p_market_id
          )
        END,
        'market_id', operation.market_id,
        'metadata', operation.metadata
      ) AS operation
    FROM audit_operations operation
    WHERE (p_user_id IS NULL OR operation.actor_id = p_user_id)
      AND (p_type IS NULL OR p_type = 'bulk_assignment')
      AND (p_from IS NULL OR operation.created_at >= p_from)
      AND (p_to IS NULL OR operation.created_at < p_to)
      AND (
        p_market_id IS NULL OR EXISTS (
          SELECT 1
          FROM lead_activities linked_activity
          JOIN leads linked_lead ON linked_lead.id = linked_activity.lead_id
          WHERE linked_activity.operation_id = operation.id
            AND linked_lead.market_id = p_market_id
        )
      )
      AND (
        p_query IS NULL OR p_query = '' OR
        operation.actor_name ILIKE '%' || p_query || '%' OR
        EXISTS (
          SELECT 1
          FROM lead_activities linked_activity
          JOIN leads linked_lead ON linked_lead.id = linked_activity.lead_id
          WHERE linked_activity.operation_id = operation.id
            AND (
              linked_activity.content ILIKE '%' || p_query || '%' OR
              linked_lead.first_name ILIKE '%' || p_query || '%' OR
              linked_lead.last_name ILIKE '%' || p_query || '%' OR
              CONCAT_WS(' ', linked_lead.first_name, linked_lead.last_name) ILIKE '%' || p_query || '%' OR
              linked_lead.address_street ILIKE '%' || p_query || '%' OR
              linked_lead.address_city ILIKE '%' || p_query || '%'
            )
        )
      )

    UNION ALL

    SELECT
      'activity'::TEXT AS item_kind,
      activity.id AS item_id,
      activity.activity_type::TEXT,
      activity.content,
      activity.old_status::TEXT,
      activity.new_status::TEXT,
      activity.created_at,
      actor.name AS actor_name,
      jsonb_build_object(
        'id', lead.id,
        'first_name', lead.first_name,
        'last_name', lead.last_name,
        'address_street', lead.address_street,
        'address_city', lead.address_city,
        'address_state', lead.address_state,
        'market_id', lead.market_id
      ) AS lead,
      NULL::JSONB AS operation
    FROM lead_activities activity
    JOIN leads lead ON lead.id = activity.lead_id
    LEFT JOIN admin_users actor ON actor.id = activity.created_by
    WHERE activity.operation_id IS NULL
      AND (p_user_id IS NULL OR activity.created_by = p_user_id)
      AND (p_type IS NULL OR activity.activity_type::TEXT = p_type)
      AND (p_market_id IS NULL OR lead.market_id = p_market_id)
      AND (p_from IS NULL OR activity.created_at >= p_from)
      AND (p_to IS NULL OR activity.created_at < p_to)
      AND (
        p_query IS NULL OR p_query = '' OR
        activity.content ILIKE '%' || p_query || '%' OR
        actor.name ILIKE '%' || p_query || '%' OR
        lead.first_name ILIKE '%' || p_query || '%' OR
        lead.last_name ILIKE '%' || p_query || '%' OR
        CONCAT_WS(' ', lead.first_name, lead.last_name) ILIKE '%' || p_query || '%' OR
        lead.address_street ILIKE '%' || p_query || '%' OR
        lead.address_city ILIKE '%' || p_query || '%'
      )
  ),
  counted AS (
    SELECT feed.*, COUNT(*) OVER() AS total_count
    FROM feed
  )
  SELECT *
  FROM counted
  ORDER BY created_at DESC, item_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
  OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.list_admin_audit_feed(
  INTEGER,
  INTEGER,
  INTEGER,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_admin_audit_feed(
  INTEGER,
  INTEGER,
  INTEGER,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) TO service_role;

-- Reps keep the existing "my work on my assigned leads" rule. Linked rows
-- remain individual lead events so a rep never receives a team-wide operation
-- count through the grouped admin view.
CREATE OR REPLACE FUNCTION public.list_rep_audit_feed(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_market_id INTEGER DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  item_kind TEXT,
  item_id UUID,
  activity_type TEXT,
  content TEXT,
  old_status TEXT,
  new_status TEXT,
  created_at TIMESTAMPTZ,
  actor_name TEXT,
  lead JSONB,
  operation JSONB,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH feed AS (
    SELECT
      'activity'::TEXT AS item_kind,
      activity.id AS item_id,
      activity.activity_type::TEXT,
      activity.content,
      activity.old_status::TEXT,
      activity.new_status::TEXT,
      activity.created_at,
      actor.name AS actor_name,
      jsonb_build_object(
        'id', lead.id,
        'first_name', lead.first_name,
        'last_name', lead.last_name,
        'address_street', lead.address_street,
        'address_city', lead.address_city,
        'address_state', lead.address_state,
        'market_id', lead.market_id
      ) AS lead,
      NULL::JSONB AS operation
    FROM lead_activities activity
    JOIN leads lead ON lead.id = activity.lead_id
    LEFT JOIN admin_users actor ON actor.id = activity.created_by
    WHERE activity.created_by = p_actor_id
      AND (
        (p_actor_role = 'setter' AND lead.assigned_setter_id = p_actor_id) OR
        (p_actor_role = 'closer' AND lead.assigned_closer_id = p_actor_id) OR
        (p_actor_role = 'admin' AND (
          lead.assigned_setter_id = p_actor_id OR lead.assigned_closer_id = p_actor_id
        ))
      )
      AND (p_type IS NULL OR activity.activity_type::TEXT = p_type)
      AND (p_market_id IS NULL OR lead.market_id = p_market_id)
      AND (p_from IS NULL OR activity.created_at >= p_from)
      AND (p_to IS NULL OR activity.created_at < p_to)
      AND (
        p_query IS NULL OR p_query = '' OR
        activity.content ILIKE '%' || p_query || '%' OR
        actor.name ILIKE '%' || p_query || '%' OR
        lead.first_name ILIKE '%' || p_query || '%' OR
        lead.last_name ILIKE '%' || p_query || '%' OR
        CONCAT_WS(' ', lead.first_name, lead.last_name) ILIKE '%' || p_query || '%' OR
        lead.address_street ILIKE '%' || p_query || '%' OR
        lead.address_city ILIKE '%' || p_query || '%'
      )
  ),
  counted AS (
    SELECT feed.*, COUNT(*) OVER() AS total_count
    FROM feed
  )
  SELECT *
  FROM counted
  ORDER BY created_at DESC, item_id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100)
  OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.list_rep_audit_feed(
  UUID,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_rep_audit_feed(
  UUID,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT
) TO service_role;

-- Admins can expand a grouped operation without loading every linked row into
-- the main feed. This function uses the same office and search boundaries.
CREATE OR REPLACE FUNCTION public.get_audit_operation_leads(
  p_operation_id UUID,
  p_market_id INTEGER DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  activity_id UUID,
  content TEXT,
  lead JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    activity.id AS activity_id,
    activity.content,
    jsonb_build_object(
      'id', lead.id,
      'first_name', lead.first_name,
      'last_name', lead.last_name,
      'address_street', lead.address_street,
      'address_city', lead.address_city,
      'address_state', lead.address_state
    ) AS lead
  FROM lead_activities activity
  JOIN leads lead ON lead.id = activity.lead_id
  WHERE activity.operation_id = p_operation_id
    AND (p_market_id IS NULL OR lead.market_id = p_market_id)
  ORDER BY lead.last_name, lead.first_name, activity.id
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION public.get_audit_operation_leads(
  UUID,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_audit_operation_leads(
  UUID,
  INTEGER,
  INTEGER
) TO service_role;
