# Advanced Bulk Lead Assignment (list-first)

Plan: `/Users/tommyschwieger/.claude/plans/gentle-dazzling-storm.md`
Branch: `feat/bulk-assignment`

## Tasks
- [x] `LIMITS.BULK_ASSIGN_MAX: 500` in validation.ts
- [x] Pure deterministic distribution algorithm `src/lib/leads/distribute.ts` (LPT greedy; count = round-robin)
- [x] POST `/api/admin/leads/bulk-assign` — single + distribute modes, dry_run preview, chunked .in(), bulk activity log
- [x] GET `/api/admin/leads/streets` — filter-aware street grouping with per-lead values
- [x] `BulkAssignDialog` — role, rep checkboxes, unassign, strategy, dry-run preview table
- [x] `StreetSelectSheet` — street list w/ counts + $, indeterminate checkboxes, no-street hint
- [x] Leads page — admin-only checkbox column, select-all header, sticky action bar, By Street button
- [x] Verify: tsc, lint (no new issues), build, algorithm spot-checks, live API e2e

## Review

**Status:** complete + verified on branch `feat/bulk-assignment` (NOT yet deployed).

**What was built:** admins can select leads on the list (individually, whole page, or
by street via a side panel) and bulk-assign them to setters/closers — to one rep,
unassign, or auto-distribute among 2+ reps balanced by # of leads or by estimated
roof value, with an exact dry-run preview before committing. Setters/closers see no
UI change; both new endpoints return 403 for them. No schema changes.

**Verification (all green):**
- `tsc --noEmit` clean; lint has zero new issues (same 2 pre-existing errors in
  untouched webhooks/email); `next build` exit 0 with both new routes registered
- Algorithm spot-checks: 7/2 count → 4/3; value balance $37k/$33k; all-null → 2/2/2;
  deterministic across runs
- Live e2e against dev server with minted JWTs: 401 (no cookie), 403 (setter token)
  on both routes; streets grouping correct; dry-run single ($67,200/5 leads) and
  distribute-by-value ($33,700 vs $33,500) correct; all validation errors (bad uuid,
  bad mode, 1-user distribute, wrong-role target) return clean 400s; ghost lead →
  skipped:1; REAL write test on test lead "123 main st": assign → column set +
  "Bulk assigned setter" activity → unassign → reverted to null

**Notes:**
- Distribution preview uses server dry_run so preview always equals commit
- The future map view reuses POST /bulk-assign unchanged
- Deploy = push main (Vercel auto-deploys); no migrations needed this time
