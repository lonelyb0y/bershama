-- ============================================================================
-- 20260101000013_expose_api_schema_to_postgrest.sql
--
-- Tell PostgREST the `api` schema exists, in the database.
--
-- ── why this is a migration and not just a dashboard setting ─────────────────
--
-- The dashboard's "Exposed schemas" list did not reach the running PostgREST on
-- a real project. Verified, not assumed: the dashboard showed
-- `public, graphql_public, api` and showed as saved, while
--
--     select setconfig from pg_db_role_setting s
--       join pg_roles r on r.oid = s.setrole
--      where r.rolname = 'authenticator';
--
-- returned no `pgrst.db_schemas` entry at all. The dashboard had updated a
-- runtime setting; the role PostgREST actually reads had never been told.
--
-- This is a known Supabase behaviour rather than a local misconfiguration --
-- "The updated Exposed Schemas setting is not reflected in the supabase
-- console" (supabase discussion #12270), and #45904 describes the same class of
-- drift where the dashboard and the runtime disagree.
--
-- So the setting is made where PostgREST reads it, which is also the fix the
-- Supabase troubleshooting guide gives for PGRST106:
--
--   "the authenticator role's pgrst.db_schemas setting does not include the
--    desired schema ... update the pgrst.db_schemas setting for the
--    authenticator role"
--
-- ── 'reload config', not 'reload schema' ────────────────────────────────────
--
-- Both notifications are needed and they are not interchangeable. A changed
-- schema LIST is a configuration change, so PostgREST needs
--
--     NOTIFY pgrst, 'reload config'
--
-- and a changed set of objects is a cache change, so it needs
--
--     NOTIFY pgrst, 'reload schema'
--
-- Sending only 'reload schema' -- which is what the debugging in this project's
-- history did for a long time -- reloads the cache while PostgREST is still
-- configured to expose a single schema, and the api functions stay invisible
-- however many times it is sent. That is what made this look like a privilege
-- problem for so long.
--
-- The notifications are NOT part of this migration. A migration cannot
-- usefully signal the PostgREST process on every environment, and on a hosted
-- project the process may not be listening on the pgrst channel at all. Use
-- `make db-expose-api` for that half, which does both.
--
-- ── what this does and does not change ──────────────────────────────────────
--
-- It adds `api` to the list of schemas PostgREST may route. It grants nothing.
-- The privilege boundary is unchanged and still enforced by three separate
-- things that this migration does not touch:
--
--   * `private` is absent from the list, and absent from USAGE for every role,
--     so the balance trigger and the single writer of the ledger stay
--     unreachable over HTTP. Asserted in rls_coverage.test.sql.
--   * EXECUTE on each api function is per function, granted only to
--     `authenticated`. `anon` holds none of them.
--   * Every write is a SECURITY DEFINER function that re-checks the caller's
--     role and tenant through private.require_inventory_write(), and RLS
--     decides the rows.
--
-- Making the schema routable exposes the ROUTE, not the data. An unauthenticated
-- request to any of these functions is refused exactly as it was before, and
-- rls_coverage asserts the negative half of all of that.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- db_schemas, plural. The singular db_schema is a legacy alias that works
    -- for environment variables and config files but NOT for in-database
    -- configuration, so the obvious-looking name silently does nothing here.
    -- (postgrest-docs#487: "the in-database configuration does not support the
    -- backwards compatible alias".)

    -- Preserved in the order given, because the FIRST schema is the default one
    -- PostgREST resolves unqualified names against. public must stay first: the
    -- application queries public tables without qualifying them, and moving api
    -- to the front would break every one of those queries instead of fixing
    -- this one.
    execute $grant$alter role authenticator set pgrst.db_schemas = 'public, graphql_public, api'$grant$;
  end if;
end
$$;
