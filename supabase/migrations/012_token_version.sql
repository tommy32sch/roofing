-- Session revocation support.
-- Every JWT carries the user's token_version. getAuthenticatedAdmin() rejects a
-- token whose version doesn't match the current column value, so bumping this
-- (on role change, password change, "log out everywhere", or deletion)
-- invalidates that user's existing sessions immediately instead of waiting up to
-- 24h for the token to expire.
-- Additive and backward-compatible: existing code doesn't reference this column,
-- and existing tokens (which predate the tv claim) match the default of 0.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
