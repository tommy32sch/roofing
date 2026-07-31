-- Let an admin sign off on a recorded deletion.
--
-- The deletions panel is a review queue, not a permanent list: once someone has
-- looked at a deletion and decided it was fine, it should stop demanding
-- attention. Without this it accumulates forever and stops being noticeable,
-- which defeats the point of showing it at all.
--
-- Reviewing MARKS the row, it does not remove it. Deleting the audit record to
-- clear the panel would undo the entire reason the record exists — the problem
-- being solved is that a lead deletion left no trace. So this stamps who
-- approved it and when, and the row stays queryable forever.

ALTER TABLE lead_deletions
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  -- Copied rather than joined, for the same reason deleted_by_name is: the
  -- record has to still read correctly after that account is renamed or removed.
  ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT;

-- The panel's default query is "not yet reviewed, newest first".
CREATE INDEX IF NOT EXISTS idx_lead_deletions_pending
  ON lead_deletions (deleted_at DESC)
  WHERE reviewed_at IS NULL;
