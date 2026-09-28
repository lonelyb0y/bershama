-- ============================================================================
-- 20260101000012_api_schema_usage.sql
--
-- The `api` schema was invisible to PostgREST.
--
-- ── the symptom ─────────────────────────────────────────────────────────────
--
-- Every function in `api` is SECURITY DEFINER and was granted EXECUTE to
-- `authenticated`, so the design was right. But PostgREST could not see the
-- schema at all:
--
--     POST /rest/v1/api/rpc/touch
--     PGRST125  Invalid path specified in request URL
--
-- and its OpenAPI document listed one path, `/`. Meanwhile a `public` table
-- returned rows, so the API was plainly up. The two facts together are the
-- signature of a schema missing from PostgREST's cache rather than a server
-- that was down.
--
-- ── the cause ───────────────────────────────────────────────────────────────
--
-- PostgREST connects as `authenticator` and only includes schemas it has USAGE
-- on. `api` had USAGE for `authenticated` and for nobody else:
--
--     nspname     | authenticator | authenticated | service_role
--     -------------+---------------+--------------+--------------
--     api         | f             | t            | f
--     public      | t             | t            | t
--     private     | f             | f            | f
--
-- So the schema holding every stock and batch operation was unreachable over
-- HTTP. Sign-in calls `api.whoami`, so the application could not authenticate
-- against this stack at all.
--
-- ── why this survived a green build ─────────────────────────────────────────
--
-- Because nothing tested the schema against a real server. The pgTAP suites
-- run as the owner over plain PostgreSQL, where schema visibility is not a
-- question, and the web tests used a stub that answered whatever it was asked.
-- A missing GRANT is invisible to both, and to `tsc`.
--
-- ── why USAGE is the right grant, and not something looser ─────────────────
--
-- USAGE on a schema is the *ability to see it named in a query*. It grants
-- nothing on its own. Access to an object inside is still decided per object:
--
--   * `authenticated` has EXECUTE on exactly the functions in the allow-list in
--     0009/0011, and RLS decides the rows. The rls_coverage suite asserts that
--     no unlisted function is reachable, so this cannot widen what a caller can
--     do.
--   * `authenticator` is PostgREST's own login role. It holds no table grants
--     and bypasses no policy; PostgREST switches to `authenticated` before
--     serving a request. Without USAGE it simply cannot build its schema cache.
--   * `service_role` bypasses RLS and is the trusted server-side key, already
--     used for the two operations RLS cannot perform (invitations, first
--     tenant provisioning).
--
-- `private` is deliberately left without USAGE for all three. That is the whole
-- point of the schema: the one place with no reachable surface at all. The
-- assertion below is what stops this migration from being "helpfully" extended
-- to it.
-- ============================================================================

-- Guarded on the roles existing.
--
-- `authenticator` is created by Supabase, not by these migrations, and
-- scripts/verify-db.sh applies them to plain PostgreSQL. An unguarded GRANT is a
-- migration that cannot be applied to the database its own test suite runs
-- against -- so either the suite is wrong or the migration is, and both were
-- true until this was found.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant usage on schema api to authenticator';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema api to service_role';
  end if;
end
$$;

comment on schema api is
  'The exposed surface for privileged operations. Reachable over HTTP because '
  'PostgREST connects as authenticator, which needs USAGE to build its schema '
  'cache. USAGE grants nothing on its own: EXECUTE is per function and RLS '
  'decides the rows. The private schema must never be given USAGE for any of '
  'these roles.';


-- ── the assertion, so this cannot regress ───────────────────────────────────
--
-- Added to rls_coverage.test.sql rather than left as a comment. A GRANT that is
-- missing is invisible to everything else in this repository: not to tsc, not to
-- a stub, and not to the pgTAP suites, which do not go through PostgREST at
-- all. It is the one thing here that has to be asserted to be believed.
--
-- The negative half matters as much as the positive. The obvious "fix" for a
-- missing GRANT is to grant broadly, and granting USAGE on `private` to
-- authenticator would expose every function in the schema to every request.
-- That is a one-line mistake with no test to catch it, so there is now one.
