-- Import duplicate detection must scale with the incoming file, not with the
-- entire leads table. Keep the canonical address beside each lead so PostgreSQL
-- can answer candidate lookups through an index. A generated column makes the
-- database responsible for keeping the key current across every insert/update
-- path; callers cannot forget to maintain it.

CREATE OR REPLACE FUNCTION public.normalize_lead_street(p_street TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog
AS $$
DECLARE
  cleaned TEXT;
  token TEXT;
  mapped TEXT;
  result TEXT[] := ARRAY[]::TEXT[];
BEGIN
  cleaned := LOWER(p_street);
  cleaned := REPLACE(cleaned, '#', ' # ');
  cleaned := REGEXP_REPLACE(cleaned, '[^a-z0-9# ]+', ' ', 'g');
  cleaned := BTRIM(REGEXP_REPLACE(cleaned, ' +', ' ', 'g'));

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  FOREACH token IN ARRAY REGEXP_SPLIT_TO_ARRAY(cleaned, ' ')
  LOOP
    mapped := CASE
      WHEN token IN ('apt', 'apartment', 'unit', 'ste', 'suite', 'bldg',
                     'building', 'lot', 'trlr', 'rm', 'room', 'fl', 'floor',
                     'spc', 'space') THEN '#'
      WHEN token IN ('north', 'n') THEN 'n'
      WHEN token IN ('south', 's') THEN 's'
      WHEN token IN ('east', 'e') THEN 'e'
      WHEN token IN ('west', 'w') THEN 'w'
      WHEN token IN ('northeast', 'ne') THEN 'ne'
      WHEN token IN ('northwest', 'nw') THEN 'nw'
      WHEN token IN ('southeast', 'se') THEN 'se'
      WHEN token IN ('southwest', 'sw') THEN 'sw'
      WHEN token IN ('street', 'st') THEN 'st'
      WHEN token IN ('avenue', 'ave', 'av') THEN 'ave'
      WHEN token IN ('road', 'rd') THEN 'rd'
      WHEN token IN ('drive', 'dr') THEN 'dr'
      WHEN token IN ('lane', 'ln') THEN 'ln'
      WHEN token IN ('boulevard', 'blvd', 'blv') THEN 'blvd'
      WHEN token IN ('court', 'ct') THEN 'ct'
      WHEN token IN ('circle', 'cir') THEN 'cir'
      WHEN token IN ('place', 'pl') THEN 'pl'
      WHEN token IN ('trail', 'trl') THEN 'trl'
      WHEN token IN ('parkway', 'pkwy', 'pky') THEN 'pkwy'
      WHEN token IN ('highway', 'hwy') THEN 'hwy'
      WHEN token IN ('terrace', 'ter', 'terr') THEN 'ter'
      WHEN token IN ('square', 'sq') THEN 'sq'
      WHEN token IN ('point', 'pt') THEN 'pt'
      WHEN token IN ('crossing', 'xing') THEN 'xing'
      ELSE token
    END;

    -- "apt #4" produces two adjacent markers; the TypeScript rule collapses
    -- them, so the indexed database key must do the same.
    IF mapped = '#'
      AND COALESCE(ARRAY_LENGTH(result, 1), 0) > 0
      AND result[ARRAY_LENGTH(result, 1)] = '#'
    THEN
      CONTINUE;
    END IF;

    result := ARRAY_APPEND(result, mapped);
  END LOOP;

  RETURN NULLIF(ARRAY_TO_STRING(result, ' '), '');
END;
$$;

ALTER TABLE leads
  ADD COLUMN address_dedupe_key TEXT
  GENERATED ALWAYS AS (public.normalize_lead_street(address_street)) STORED;

-- Imports only match against canonical/original leads. Rows already classified
-- as duplicates must never become the parent of a later duplicate cluster.
CREATE INDEX idx_leads_dedupe_street_original
  ON leads(address_dedupe_key, created_at, id)
  WHERE is_flagged_duplicate = false AND address_dedupe_key IS NOT NULL;

CREATE INDEX idx_leads_dedupe_apn_original
  ON leads((BTRIM(apn)), created_at, id)
  WHERE is_flagged_duplicate = false AND apn IS NOT NULL AND BTRIM(apn) <> '';

-- Return only the existing rows that can match this import, followed by every
-- incoming row with its database-normalized key. The application keeps the
-- policy decision (APN precedence and city/ZIP conflict handling), while this
-- function owns scalable candidate selection and canonical street parsing.
CREATE OR REPLACE FUNCTION public.find_lead_duplicate_context(p_leads JSONB)
RETURNS TABLE (
  record_order BIGINT,
  id TEXT,
  apn TEXT,
  address_street TEXT,
  address_city TEXT,
  address_zip TEXT,
  address_dedupe_key TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  WITH incoming AS MATERIALIZED (
    SELECT
      item.ordinality AS input_position,
      COALESCE(NULLIF(item.value->>'id', ''), 'new:' || (item.ordinality - 1)::TEXT) AS id,
      NULLIF(BTRIM(item.value->>'apn'), '') AS apn,
      NULLIF(item.value->>'address_street', '') AS address_street,
      NULLIF(item.value->>'address_city', '') AS address_city,
      NULLIF(item.value->>'address_zip', '') AS address_zip,
      public.normalize_lead_street(item.value->>'address_street') AS address_dedupe_key
    FROM JSONB_ARRAY_ELEMENTS(
      CASE WHEN JSONB_TYPEOF(p_leads) = 'array' THEN p_leads ELSE '[]'::JSONB END
    ) WITH ORDINALITY AS item(value, ordinality)
  ),
  candidate_ids AS MATERIALIZED (
    SELECT candidate.id
    FROM incoming candidate_input
    JOIN leads candidate
      ON candidate.address_dedupe_key = candidate_input.address_dedupe_key
    WHERE candidate_input.address_dedupe_key IS NOT NULL
      AND candidate.is_flagged_duplicate = false
      AND candidate.address_dedupe_key IS NOT NULL

    UNION

    SELECT candidate.id
    FROM incoming candidate_input
    JOIN leads candidate
      ON BTRIM(candidate.apn) = candidate_input.apn
    WHERE candidate_input.apn IS NOT NULL
      AND candidate.is_flagged_duplicate = false
      AND candidate.apn IS NOT NULL
      AND BTRIM(candidate.apn) <> ''
  ),
  existing AS MATERIALIZED (
    SELECT
      ROW_NUMBER() OVER (ORDER BY candidate.created_at ASC NULLS FIRST, candidate.id) AS record_order,
      candidate.id::TEXT AS id,
      candidate.apn,
      candidate.address_street,
      candidate.address_city,
      candidate.address_zip,
      candidate.address_dedupe_key
    FROM leads candidate
    JOIN candidate_ids ON candidate_ids.id = candidate.id
  )
  SELECT
    existing.record_order,
    existing.id,
    existing.apn,
    existing.address_street,
    existing.address_city,
    existing.address_zip,
    existing.address_dedupe_key
  FROM existing

  UNION ALL

  SELECT
    (SELECT COUNT(*) FROM existing) + incoming.input_position,
    incoming.id,
    incoming.apn,
    incoming.address_street,
    incoming.address_city,
    incoming.address_zip,
    incoming.address_dedupe_key
  FROM incoming

  ORDER BY record_order;
$$;

-- The function exposes lead addresses and is only an internal service-role
-- primitive. Signed-in browser clients must go through the application policy.
REVOKE ALL ON FUNCTION public.find_lead_duplicate_context(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_lead_duplicate_context(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.find_lead_duplicate_context(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_lead_duplicate_context(JSONB) TO service_role;
