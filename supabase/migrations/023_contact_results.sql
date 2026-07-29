-- Structured map results for door knocks and cold calls.
--
-- The knock table and its offline idempotency contract already exist. Extend
-- that vocabulary additively so an older deployed client, historical row, or
-- queued IndexedDB entry using `callback` / `no_damage` remains valid.

ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'call_back';
ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'referral';
ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'contract_signed';
ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS 'renter';

-- Keep the existing signature so deployed clients can move between versions
-- while the database migration and application deployment roll out. New enum
-- values are compared through TEXT: PostgreSQL may reject direct use of a newly
-- added enum literal until the ALTER TYPE transaction commits.
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
  v_disposition TEXT;
  v_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_lead_knock requires service role';
  END IF;

  v_disposition := p_disposition::TEXT;

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

  -- An outcome may prove contact, but it cannot skip the required appointment
  -- scheduling or won-lead demographic workflows. Those actions own later
  -- pipeline transitions.
  v_target_status := CASE
    WHEN v_disposition IN (
      'callback',
      'call_back',
      'referral',
      'appointment_set',
      'contract_signed',
      'not_interested',
      'renter',
      'no_damage'
    ) THEN 'contacted'::lead_status
    ELSE NULL
  END;

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
    do_not_knock = do_not_knock OR v_disposition = 'do_not_knock',
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

  v_label := CASE v_disposition
    WHEN 'not_home' THEN 'Not Home'
    WHEN 'callback' THEN 'Go Back'
    WHEN 'call_back' THEN 'Call Back'
    WHEN 'referral' THEN 'Referral'
    WHEN 'appointment_set' THEN 'Appointment'
    WHEN 'contract_signed' THEN 'Contract Signed'
    WHEN 'not_interested' THEN 'Not Interested'
    WHEN 'renter' THEN 'Renter'
    WHEN 'do_not_knock' THEN 'Do Not Knock'
    WHEN 'no_damage' THEN 'No Damage'
    ELSE initcap(replace(v_disposition, '_', ' '))
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

-- Cold calls mirror knocks: append-only structured history plus denormalized
-- summary fields for a map that may load thousands of leads at once.
CREATE TYPE cold_call_disposition AS ENUM (
  'left_voicemail',
  'call_back',
  'appointment_set',
  'wrong_number',
  'do_not_call',
  'not_interested'
);

CREATE TABLE lead_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  disposition cold_call_disposition NOT NULL,
  notes TEXT,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES admin_users(id),
  client_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_calls_lead ON lead_calls(lead_id);
CREATE INDEX idx_lead_calls_called_at ON lead_calls(called_at DESC);
CREATE UNIQUE INDEX idx_lead_calls_client_id
  ON lead_calls(client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE leads
  ADD COLUMN last_call_at TIMESTAMPTZ,
  ADD COLUMN last_call_disposition cold_call_disposition,
  ADD COLUMN call_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_leads_last_call_at ON leads(last_call_at DESC);

ALTER TABLE lead_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON lead_calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION record_lead_call(
  p_lead_id UUID,
  p_disposition cold_call_disposition,
  p_notes TEXT,
  p_created_by UUID,
  p_called_at TIMESTAMPTZ,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead leads%ROWTYPE;
  v_call lead_calls%ROWTYPE;
  v_existing lead_calls%ROWTYPE;
  v_target_status lead_status;
  v_status_changed lead_status;
  v_current_rank INTEGER;
  v_target_rank INTEGER;
  v_is_newest BOOLEAN;
  v_disposition TEXT;
  v_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_lead_call requires service role';
  END IF;

  v_disposition := p_disposition::TEXT;

  IF p_client_id IS NOT NULL THEN
    SELECT *
      INTO v_existing
      FROM lead_calls
      WHERE client_id = p_client_id;

    IF FOUND THEN
      IF v_existing.lead_id IS DISTINCT FROM p_lead_id
        OR v_existing.disposition IS DISTINCT FROM p_disposition
        OR v_existing.notes IS DISTINCT FROM p_notes
        OR v_existing.called_at IS DISTINCT FROM p_called_at
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
        'call', to_jsonb(v_existing),
        'statusChangedTo', NULL
      );
    END IF;
  END IF;

  SELECT *
    INTO v_lead
    FROM leads
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'lead_not_found');
  END IF;

  BEGIN
    INSERT INTO lead_calls (
      lead_id,
      disposition,
      notes,
      created_by,
      called_at,
      client_id
    )
    VALUES (
      p_lead_id,
      p_disposition,
      p_notes,
      p_created_by,
      p_called_at,
      p_client_id
    )
    RETURNING * INTO v_call;
  EXCEPTION WHEN unique_violation THEN
    SELECT *
      INTO v_existing
      FROM lead_calls
      WHERE client_id = p_client_id;

    IF NOT FOUND
      OR v_existing.lead_id IS DISTINCT FROM p_lead_id
      OR v_existing.disposition IS DISTINCT FROM p_disposition
      OR v_existing.notes IS DISTINCT FROM p_notes
      OR v_existing.called_at IS DISTINCT FROM p_called_at
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
      'call', to_jsonb(v_existing),
      'statusChangedTo', NULL
    );
  END;

  v_is_newest :=
    v_lead.last_call_at IS NULL OR p_called_at >= v_lead.last_call_at;

  v_target_status := CASE
    WHEN v_disposition IN (
      'call_back',
      'appointment_set',
      'do_not_call',
      'not_interested'
    ) THEN 'contacted'::lead_status
    ELSE NULL
  END;

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
    call_count = COALESCE(call_count, 0) + 1,
    is_dnc = is_dnc OR v_disposition = 'do_not_call',
    last_call_at = CASE
      WHEN v_is_newest THEN p_called_at
      ELSE last_call_at
    END,
    last_call_disposition = CASE
      WHEN v_is_newest THEN p_disposition
      ELSE last_call_disposition
    END,
    status = COALESCE(v_status_changed, status)
  WHERE id = p_lead_id;

  v_label := CASE v_disposition
    WHEN 'left_voicemail' THEN 'Left Voicemail'
    WHEN 'call_back' THEN 'Call Back'
    WHEN 'appointment_set' THEN 'Appointment Set'
    WHEN 'wrong_number' THEN 'Wrong Number'
    WHEN 'do_not_call' THEN 'Do Not Call'
    WHEN 'not_interested' THEN 'Not Interested'
    ELSE initcap(replace(v_disposition, '_', ' '))
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
    'call',
    'Cold called — ' || v_label ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END,
    p_created_by,
    p_called_at
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
      p_called_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'call', to_jsonb(v_call),
    'statusChangedTo', v_status_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION record_lead_call(
  UUID,
  cold_call_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_lead_call(
  UUID,
  cold_call_disposition,
  TEXT,
  UUID,
  TIMESTAMPTZ,
  UUID
) TO service_role;
