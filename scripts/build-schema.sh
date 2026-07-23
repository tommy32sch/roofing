#!/usr/bin/env bash
# Regenerate supabase/schema.sql — every migration concatenated in order.
# Paste the result into a NEW Supabase project's SQL editor to create an empty
# database matching production's structure (no data).
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- ============================================================"
  echo "-- Roof Leads CRM — complete schema"
  echo "--"
  echo "-- Generated from supabase/migrations/*.sql in order."
  echo "-- Paste into the SQL editor of a NEW Supabase project to create an"
  echo "-- empty database matching production's structure (no data)."
  echo "-- Regenerate with: npm run schema:build"
  echo "-- ============================================================"
  echo
  for f in supabase/migrations/*.sql; do
    echo "-- ------------------------------------------------------------"
    echo "-- $(basename "$f")"
    echo "-- ------------------------------------------------------------"
    cat "$f"
    echo
  done
} > supabase/schema.sql
echo "wrote supabase/schema.sql ($(wc -l < supabase/schema.sql | tr -d ' ') lines, $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations)"
