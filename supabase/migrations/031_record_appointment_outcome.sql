-- Record an appointment result and its lead-history event as one transaction.
--
-- Today makes outcome capture a primary workflow. The appointment row and its
-- timeline entry must therefore either both commit or both roll back; two
-- separate service calls can leave reporting and visible history inconsistent.

CREATE OR REPLACE FUNCTION public.record_appointment_outcome(
  p_lead_id UUID,
  p_appointment_id UUID,
  p_outcome appointment_outcome,
  p_recorded_by UUID,
  p_expected_outcome appointment_outcome,
  p_expected_outcome_by UUID,
  p_allow_overwrite BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing lead_appointments%ROWTYPE;
  v_updated lead_appointments%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_type_label TEXT;
  v_outcome_label TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'record_appointment_outcome requires service role';
  END IF;

  IF p_recorded_by IS NULL THEN
    RAISE EXCEPTION 'record_appointment_outcome requires an actor';
  END IF;

  SELECT *
    INTO v_existing
    FROM lead_appointments
    WHERE id = p_appointment_id
      AND lead_id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'appointment_not_found');
  END IF;

  -- Repeating the current result is idempotent. Do not create duplicate
  -- history entries or replace the original attribution time.
  IF v_existing.outcome IS NOT DISTINCT FROM p_outcome THEN
    RETURN jsonb_build_object(
      'success', true,
      'changed', false,
      'appointment', to_jsonb(v_existing)
    );
  END IF;

  -- The application made its ownership decision from the expected state. A
  -- non-admin must not overwrite a result that changed while this request was
  -- in flight. Admins can deliberately correct any result.
  IF NOT p_allow_overwrite AND (
    v_existing.outcome IS DISTINCT FROM p_expected_outcome OR
    v_existing.outcome_by IS DISTINCT FROM p_expected_outcome_by
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'appointment_changed');
  END IF;

  UPDATE lead_appointments
  SET
    outcome = p_outcome,
    outcome_at = CASE WHEN p_outcome = 'scheduled' THEN NULL ELSE v_now END,
    outcome_by = CASE WHEN p_outcome = 'scheduled' THEN NULL ELSE p_recorded_by END,
    updated_at = v_now
  WHERE id = p_appointment_id
    AND lead_id = p_lead_id
  RETURNING * INTO v_updated;

  v_type_label := CASE v_existing.appointment_type::TEXT
    WHEN 'adjuster' THEN 'Adjuster'
    ELSE 'Inspection'
  END;
  v_outcome_label := CASE p_outcome::TEXT
    WHEN 'no_show' THEN 'no-show'
    ELSE REPLACE(p_outcome::TEXT, '_', ' ')
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
    'updated',
    v_type_label || ' appointment marked ' || v_outcome_label,
    p_recorded_by,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'appointment', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_appointment_outcome(
  UUID,
  UUID,
  appointment_outcome,
  UUID,
  appointment_outcome,
  UUID,
  BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_appointment_outcome(
  UUID,
  UUID,
  appointment_outcome,
  UUID,
  appointment_outcome,
  UUID,
  BOOLEAN
) TO service_role;
