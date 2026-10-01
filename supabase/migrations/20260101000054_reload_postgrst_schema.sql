-- Reload PostgREST's schema cache.
--
-- 0052 granted USAGE on `maintenance` to `authenticator`, and PostgREST still
-- answered PGRST106. It caches the schemas it exposes and the functions in them, and
-- a GRANT is not among the changes it watches for -- so the schema stayed invisible
-- until the cache was told to re-read.
--
-- This is the documented way to say so, and it is idempotent, which matters because
-- a second reload is a no-op rather than an error.
--
-- Supabase usually reloads on its own after a migration, which is presumably why this
-- has not been needed before; this migration exists only because a GRANT-only change
-- slipped under that. Kept as its own file so it can be deleted the moment the
-- behaviour is confirmed as automatic.

notify pgrst, 'reload schema';
