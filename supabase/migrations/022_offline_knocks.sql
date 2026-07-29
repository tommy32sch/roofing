-- Offline knock capture.
--
-- Knocks are taken on a phone walking a street with patchy signal. Two things
-- the current schema cannot express:
--
--   1. That a replayed request is the SAME knock. Without a client-supplied
--      identity, a retry after a lost response records the door twice and
--      inflates knock_count.
--   2. That a knock happened earlier than it was received. knocked_at defaults
--      to NOW(), so a knock taken at 10:05 and synced at 11:30 claims 11:30 —
--      which corrupts knock recency, the value the map colours doors by.
--
-- Additive only. Existing rows keep a NULL client_id and are unaffected.

ALTER TABLE lead_knocks
  ADD COLUMN IF NOT EXISTS client_id UUID;

-- Partial unique index rather than a UNIQUE constraint: every knock recorded
-- before this migration has a NULL client_id, and many NULLs must stay legal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_knocks_client_id
  ON lead_knocks(client_id)
  WHERE client_id IS NOT NULL;

-- One transaction owns the event, its denormalised lead state and the activity
-- timeline. Doing these as separate REST writes leaves an unrecoverable gap if
-- the server stops after inserting the event but before updating the lead.
CREATE OR REPLACE FUNCTION record_lead_knock(
  p_lead_id UUID,
  p_disposition knock_disposition,
  p_notes TEXT,
  p_created_by UUID,
  p_knocked_at TIMESTAMPTZ,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_knock lead_knocks%ROWTYPE;
  v_existing lead_knocks%ROWTYPE;
  v_target_status lead_status;
  v_status_changed lead_status;
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_is_newest BOOLEAN;
  v_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_lead_knock requires service role';
  END IF;

  -- Fast replay path. The key is bound to the actor and full event, so a UUID
  -- accidentally reused for different work is surfaced instead of silently
  -- discarding the second knock.
  IF p_client_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
      FROM lead_knocks
      WHERE client_id = p_client_id;

    IF FOUND THEN
      IF v_existing.lead_id IS DISTINCT FROM p_lead_id
        OR v_existing.disposition IS DISTINCT FROM p_disposition
        OR v_existing.notes IS DISTINCT FROM p_notes
        OR v_existing.knocked_at IS DISTINCT FROM p_knocked_at
        OR v_existing.created_by IS DISTINCT FROM p_created_by
      THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'client_id_conflict'
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'knock', to_jsonb(v_existing),
        'statusChangedTo', NULL
      );
    END IF;
  END IF;

  -- Serialise all knocks for one door. Different phones may reconnect at the
  -- same moment; this lock makes the count increment and latest-time decision
  -- deterministic.
  SELECT *
    INTO v_lead
    FROM leads
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_not_found');
  END IF;

  BEGIN
    INSERT INTO lead_knocks (
      lead_id,
      disposition,
      notes,
      created_by,
      knocked_at,
      client_id
    )
    VALUES (
      p_lead_id,
      p_disposition,
      p_notes,
      p_created_by,
      p_knocked_at,
      p_client_id
    )
    RETURNING * INTO v_knock;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent replay can pass the fast lookup while the first request is
    -- uncommitted. The unique index waits for it; after the conflict, verify
    -- that it was truly the same event.
    SELECT *
      INTO v_existing
      FROM lead_knocks
      WHERE client_id = p_client_id;

    IF NOT FOUND
      OR v_existing.lead_id IS DISTINCT FROM p_lead_id
      OR v_existing.disposition IS DISTINCT FROM p_disposition
      OR v_existing.notes IS DISTINCT FROM p_notes
      OR v_existing.knocked_at IS DISTINCT FROM p_knocked_at
      OR v_existing.created_by IS DISTINCT FROM p_created_by
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'client_id_conflict'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'knock', to_jsonb(v_existing),
      'statusChangedTo', NULL
    );
  END;

  v_is_newest :=
    v_lead.last_knock_at IS NULL OR p_knocked_at >= v_lead.last_knock_at;

  v_target_status := CASE p_disposition
    WHEN 'appointment_set' THEN 'appointment_set'::lead_status
    WHEN 'callback' THEN 'contacted'::lead_status
    WHEN 'not_interested' THEN 'contacted'::lead_status
    WHEN 'no_damage' THEN 'contacted'::lead_status
    ELSE NULL
  END;

  -- Pipeline movement is monotonic and independent of arrival order. A
  -- yesterday callback arriving after today's "not home" still proves contact,
  -- but it must never pull an inspected/proposal/sold lead backwards.
  v_current_rank := CASE v_lead.status
    WHEN 'new' THEN 0
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    WHEN 'inspected' THEN 3
    WHEN 'proposal_sent' THEN 4
    WHEN 'sold' THEN 5
    WHEN 'lost' THEN 5
  END;
  v_target_rank := CASE v_target_status
    WHEN 'contacted' THEN 1
    WHEN 'appointment_set' THEN 2
    ELSE NULL
  END;

  IF v_target_status IS NOT NULL AND v_target_rank > v_current_rank THEN
    v_status_changed := v_target_status;
  END IF;

  UPDATE leads
  SET
    knock_count = COALESCE(knock_count, 0) + 1,
    do_not_knock = do_not_knock OR p_disposition = 'do_not_knock',
    last_knock_at = CASE
      WHEN v_is_newest THEN p_knocked_at
      ELSE last_knock_at
    END,
    last_disposition = CASE
      WHEN v_is_newest THEN p_disposition
      ELSE last_disposition
    END,
    status = COALESCE(v_status_changed, status)
  WHERE id = p_lead_id;

  v_label := CASE p_disposition
    WHEN 'not_home' THEN 'Not home'
    WHEN 'callback' THEN 'Callback'
    WHEN 'appointment_set' THEN 'Appointment set'
    WHEN 'not_interested' THEN 'Not interested'
    WHEN 'no_damage' THEN 'No damage'
    WHEN 'do_not_knock' THEN 'Do not knock'
  END;

  INSERT INTO lead_activities (
    lead_id,
    activity_type,
    content,
    created_by,
    created_at
  )
  VALUES (
    p_lead_id,
    'visit',
    'Knocked — ' || v_label ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END,
    p_created_by,
    p_knocked_at
  );

  IF v_status_changed IS NOT NULL THEN
    INSERT INTO lead_activities (
      lead_id,
      activity_type,
      content,
      old_status,
      new_status,
      created_by,
      created_at
    )
    VALUES (
      p_lead_id,
      'status_change',
      'Status changed from ' || v_lead.status::TEXT ||
        ' to ' || v_status_changed::TEXT,
      v_lead.status,
      v_status_changed,
      p_created_by,
      p_knocked_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'knock', to_jsonb(v_knock),
    'statusChangedTo', v_status_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION record_lead_knock(
  UUID,
  knock_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_lead_knock(
  UUID,
  knock_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) TO service_role;
