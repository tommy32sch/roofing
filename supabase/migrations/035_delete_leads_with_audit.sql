-- Delete leads and record each deletion in one transaction.
--
-- Single and bulk deletion share this one path. Before it, the API route
-- counted child rows, inserted the lead_deletions snapshot, and then deleted the
-- lead as separate requests. That works for one lead, but a bulk delete made the
-- same way could record deletions that never happened (a later chunk fails) or
-- count fieldwork that changed in between. Here the leads are locked first, so
-- no knock, call, photo or appointment can be added to them while the snapshot
-- is taken, and the audit rows and the delete commit or fail together.
--
-- p_dry_run computes the same counts and writes nothing. The confirmation
-- dialog shows those numbers, so what the operator is warned about and what the
-- audit record says come from one definition.
--
-- Leads that no longer exist are skipped, not an error: the operator wanted
-- them gone and they are. found_count tells the caller how many were real.
--
-- photo_paths lists the Storage objects of the deleted leads' photos. Storage
-- is outside the database transaction, so the API removes those files after
-- this commits.

CREATE OR REPLACE FUNCTION public.delete_leads_with_audit(
  p_actor_id UUID,
  p_lead_ids UUID[],
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested INTEGER;
  v_actor_name TEXT;
  v_actor_email TEXT;
  v_actor_role TEXT;
  v_found INTEGER;
  v_worked INTEGER;
  v_activities INTEGER;
  v_knocks INTEGER;
  v_calls INTEGER;
  v_photos INTEGER;
  v_appointments INTEGER;
  v_recorded INTEGER;
  v_deleted INTEGER := 0;
  v_photo_paths TEXT[] := '{}';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'delete_leads_with_audit requires service role';
  END IF;

  v_requested := COALESCE(cardinality(p_lead_ids), 0);
  IF v_requested < 1 OR v_requested > 500 THEN
    RAISE EXCEPTION 'Lead IDs must contain 1-500 rows';
  END IF;

  -- COUNT(DISTINCT) ignores NULL, so this also rejects NULL elements.
  IF (SELECT COUNT(DISTINCT input.lead_id) FROM unnest(p_lead_ids) AS input(lead_id)) <> v_requested THEN
    RAISE EXCEPTION 'Lead IDs must be distinct and not null';
  END IF;

  SELECT name, email, role::TEXT
  INTO v_actor_name, v_actor_email, v_actor_role
  FROM admin_users
  WHERE id = p_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit actor not found';
  END IF;

  -- The route checks the role from the session. This checks the account as it
  -- is now, so a service caller cannot delete on behalf of a non-admin.
  IF v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only admins can delete leads';
  END IF;

  IF NOT p_dry_run THEN
    -- A child insert takes a key-share lock on its lead, which conflicts with
    -- this lock. New fieldwork waits, then fails its foreign key once the lead
    -- is gone, so the counts below are exact.
    PERFORM 1 FROM leads WHERE id = ANY(p_lead_ids) FOR UPDATE;

    SELECT COALESCE(array_agg(photo.storage_path), '{}')
    INTO v_photo_paths
    FROM lead_photos photo
    WHERE photo.lead_id = ANY(p_lead_ids);
  END IF;

  -- "Worked" matches isSignificantDeletion() in src/lib/leads/lead-deletion.ts:
  -- a knock, a call or an appointment means real fieldwork was destroyed.
  WITH doomed AS (
    SELECT
      lead.*,
      (SELECT COUNT(*) FROM lead_activities child WHERE child.lead_id = lead.id)::INTEGER AS n_activities,
      (SELECT COUNT(*) FROM lead_knocks child WHERE child.lead_id = lead.id)::INTEGER AS n_knocks,
      (SELECT COUNT(*) FROM lead_calls child WHERE child.lead_id = lead.id)::INTEGER AS n_calls,
      (SELECT COUNT(*) FROM lead_photos child WHERE child.lead_id = lead.id)::INTEGER AS n_photos,
      (SELECT COUNT(*) FROM lead_appointments child WHERE child.lead_id = lead.id)::INTEGER AS n_appointments
    FROM leads lead
    WHERE lead.id = ANY(p_lead_ids)
  ),
  recorded AS (
    INSERT INTO lead_deletions (
      lead_id,
      first_name,
      last_name,
      phone,
      email,
      address_street,
      address_city,
      address_state,
      address_zip,
      status,
      deal_value,
      market_id,
      assigned_setter_id,
      assigned_closer_id,
      lead_created_at,
      lead_created_by,
      deleted_by,
      deleted_by_name,
      deleted_by_role,
      activities_destroyed,
      knocks_destroyed,
      calls_destroyed,
      photos_destroyed,
      appointments_destroyed
    )
    SELECT
      doomed.id,
      doomed.first_name,
      doomed.last_name,
      doomed.phone,
      doomed.email,
      doomed.address_street,
      doomed.address_city,
      doomed.address_state,
      doomed.address_zip,
      doomed.status::TEXT,
      doomed.deal_value,
      doomed.market_id,
      doomed.assigned_setter_id,
      doomed.assigned_closer_id,
      doomed.created_at,
      doomed.created_by,
      p_actor_id,
      -- Copied, not joined, so the record still reads correctly after the
      -- account is renamed or removed.
      COALESCE(NULLIF(BTRIM(v_actor_name), ''), v_actor_email),
      v_actor_role,
      doomed.n_activities,
      doomed.n_knocks,
      doomed.n_calls,
      doomed.n_photos,
      doomed.n_appointments
    FROM doomed
    WHERE NOT p_dry_run
    RETURNING lead_id
  )
  SELECT
    COUNT(*)::INTEGER,
    (COUNT(*) FILTER (
      WHERE doomed.n_knocks > 0 OR doomed.n_calls > 0 OR doomed.n_appointments > 0
    ))::INTEGER,
    COALESCE(SUM(doomed.n_activities), 0)::INTEGER,
    COALESCE(SUM(doomed.n_knocks), 0)::INTEGER,
    COALESCE(SUM(doomed.n_calls), 0)::INTEGER,
    COALESCE(SUM(doomed.n_photos), 0)::INTEGER,
    COALESCE(SUM(doomed.n_appointments), 0)::INTEGER,
    (SELECT COUNT(*) FROM recorded)::INTEGER
  INTO v_found, v_worked, v_activities, v_knocks, v_calls, v_photos, v_appointments, v_recorded
  FROM doomed;

  IF NOT p_dry_run THEN
    DELETE FROM leads WHERE id = ANY(p_lead_ids);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    -- The rows are locked, so this cannot differ. If it ever does, roll back
    -- rather than keep a deletion with no record or a record with no deletion.
    IF v_deleted <> v_recorded OR v_recorded <> v_found THEN
      RAISE EXCEPTION 'Lead deletion did not match its audit records';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'requested_count', v_requested,
    'found_count', v_found,
    'deleted_count', v_deleted,
    'worked_count', v_worked,
    'activities', v_activities,
    'knocks', v_knocks,
    'calls', v_calls,
    'photos', v_photos,
    'appointments', v_appointments,
    'photo_paths', to_jsonb(v_photo_paths)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_leads_with_audit(
  UUID,
  UUID[],
  BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.delete_leads_with_audit(
  UUID,
  UUID[],
  BOOLEAN
) TO service_role;
