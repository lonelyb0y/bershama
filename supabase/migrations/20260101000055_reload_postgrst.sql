-- Reload PostgREST's schema cache, by calling its function rather than notifying it.
--
-- 0054 sent `notify pgrst, 'reload schema'` and the maintenance schema still came
-- back PGRST106. That notification is ignored when a project runs PostgREST with
-- db-channel notifications disabled, which is a per-project setting rather than
-- something the migration can turn on.
--
-- pgrst.reload_schema() is the other documented mechanism and it is a function call,
-- so it works regardless of the notification setting. This migration exists only to
-- run it; there is nothing else in it, and it is idempotent.
--
-- It is worth knowing why this is needed at all rather than being surprised by it
-- again: PostgREST decides which schemas it exposes when it starts and when it is
-- told to re-read, so a schema added by a migration is invisible until then. A new
-- schema is therefore a two-step deploy -- migrate, then reload -- and that is a
-- thing to write down rather than rediscover.

do $$
begin
  -- Guarded, because pgrst.reload_schema() exists only when PostgREST is installed,
  -- and this database is also run locally for the test suites where it is not.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'pgrst' and p.proname = 'reload_schema') then
    perform pgrst.reload_schema();
    raise notice 'PostgREST schema cache reloaded';
  else
    raise notice 'pgrst.reload_schema() not present -- local database, nothing to reload';
  end if;
end
$$;
