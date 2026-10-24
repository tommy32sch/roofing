-- Return the import duplicate-lookup context as ONE JSONB value.
--
-- find_lead_duplicate_context (029) returns a row per incoming lead plus a row
-- per existing candidate. Through the API that set is capped at 1,000 rows, so
-- a 1,084-row file came back incomplete and every import of it failed. Reading
-- the set in pages fixed the cap but re-ran the function per page: an import
-- landing between two pages could shift the numbering and silently drop a
-- candidate, which would let a duplicate through as a new original.
--
-- This wrapper runs the lookup once, in one statement — one snapshot — and
-- returns it as a single JSONB array (one row, so no row cap applies). The
-- array keeps the function's own record_order ordering.

CREATE OR REPLACE FUNCTION public.find_lead_duplicate_context_json(p_leads JSONB)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    jsonb_agg(to_jsonb(context) ORDER BY context.record_order),
    '[]'::JSONB
  )
  FROM public.find_lead_duplicate_context(p_leads) AS context;
$$;

-- Same exposure as the function it wraps: an internal service-role primitive.
REVOKE ALL ON FUNCTION public.find_lead_duplicate_context_json(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_lead_duplicate_context_json(JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.find_lead_duplicate_context_json(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_lead_duplicate_context_json(JSONB) TO service_role;
