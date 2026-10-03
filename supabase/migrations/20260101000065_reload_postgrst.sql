-- 0065: tell PostgREST to re-read its schema
--
-- The third time this has been needed (0054, 0061, now). 0063 and 0064 both add or
-- replace a function in the exposed `api` schema, and PostgREST does not notice until
-- something tells it to look again:
--
--   PGRST202  Searched for the function public.run_alert_scan without parameters
--             in the schema cache
--
-- It is a cache with no expiry and nothing in the push path signals it, so a migration
-- that adds an api function is not callable until this statement runs somewhere.
--
-- The error names `public` even though the function is in `api`, because that is the
-- schema PostgREST searched. It sends you looking in the wrong place.
--
-- `scripts/verify-db.sh` asserts the same thing for the local cluster; this is the
-- hosted equivalent, and it is the only part of a migration that has to be repeated
-- by hand.

notify pgrst, 'reload schema';
