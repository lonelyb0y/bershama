-- Make the api surface reachable over PostgREST, and close an anon grant.
--
-- ── why this exists ────────────────────────────────────────────────────────────
--
-- The whole app reads and writes through supabase-js's `.rpc()`, which is PostgREST.
-- api.whoami() returning no rows means getSession() returns null, and every
-- authenticated page bounces the user to /login -- so if PostgREST cannot see the `api`
-- schema, the application has no data layer at all. It is not a degraded mode.
--
-- On this hosted project PostgREST serves exactly one schema. Measured, after applying
-- the correct setting through the Management API and restarting the services:
--
--   GET /v1/projects/{ref}/postgrest   -> "db_schema": "public,graphql_public,api"
--   ALTER ROLE authenticator           -> pgrst.db_schemas=public, graphql_public, api
--   NEW function in `public`           -> exposed by the next 'reload schema'
--   api.whoami()                       -> PGRST202, never exposed
--
-- That combination localises the fault. The schema cache is alive -- it picks up a new
-- `public` function within seconds -- so the list PostgREST is *configured* with simply
-- does not contain `api`, and neither the stored config nor the role setting reaches the
-- running container. NOTIFY 'reload config', NOTIFY 'reload schema', pause/restore and a
-- full service restart were each tried and each left the same single-schema surface.
--
-- This is a platform-side fault, so it cannot be fixed from here. What it *can* do is be
-- routed around, and the route is `public`.
--
-- ── why these wrappers are INVOKER ─────────────────────────────────────────────
--
-- rls_coverage.test.sql asserts that no SECURITY DEFINER function sits in `public`, and
-- that no SECURITY DEFINER function in an exposed schema is executable by `anon`. Both
-- hold here, and neither is weakened:
--
--   * The wrappers are INVOKER, so the assertion about `public` stays satisfied.
--   * The security boundary does not move. Each api.* function is still the thing that
--     runs; it keeps its own SECURITY DEFINER setting and its own authorising checks
--     against the caller's tenant and role. A wrapper adds a name, not a privilege.
--
-- A SECURITY DEFINER wrapper would have been the more obvious way to write this and would
-- have quietly broken the first assertion, which is exactly what that assertion exists to
-- catch.
--
-- ── why they are generated rather than written out ─────────────────────────────
--
-- Forty-nine hand-copied signatures drift the moment a function is added, and the drift
-- is silent: a missing wrapper surfaces as a PGRST202 at runtime, not as a test failure.
-- Generating from pg_proc means the set cannot lag. The wrapper is also given exactly the
-- argument list, defaults and return type of the function it fronts, so database.types.ts
-- stays correct as-is -- supabase-js keys RPC types by name and arguments, which do not
-- change.
--
-- ── the anon grant this also closes ────────────────────────────────────────────
--
-- While enumerating the catalog to write this, every api function reported
-- has_function_privilege('anon', ..., 'EXECUTE') = true, including the SECURITY DEFINER
-- writers. No migration in this repository grants EXECUTE on an api function to anon --
-- there is not one -- and 20260101000067 revokes it from provision_tenant explicitly,
-- yet the hosted database carried `anon=X/postgres` on all of them. CREATE OR REPLACE
-- FUNCTION does not reset an ACL, and a function created without an explicit REVOKE
-- inherits EXECUTE from PUBLIC, which is where the grant came from.
--
-- The bodies defend themselves -- they resolve a tenant from auth.uid(), which is NULL
-- for an anonymous caller, and refuse -- so this is defence in depth rather than a live
-- breach. But an ACL that contradicts the migrations is drift, and drift in a GRANT is the
-- kind that becomes a breach one refactor later. Revoked to match what the migrations
-- have always said.

-- ── 1. Make every api function reachable as public.<name>() ─────────────────────
--
-- search_path is pinned to '' on each wrapper, so nothing in the body can be captured by
-- a caller-controlled search_path. Both the function and the argument list are schema
-- qualified or positional, so there is nothing left to resolve.

do $$
declare
  f        record;
  v_call   text;
  v_body   text;
  v_vol    text;
begin
  for f in
    select p.proname,
           p.proretset,
           p.provolatile,
           pg_get_function_arguments(p.oid) as args,
           pg_get_function_result(p.oid)   as result,
           coalesce(
             (select string_agg('$' || t.ord::text, ', ' order by t.ord)
                from generate_series(1, p.pronargs) as t(ord)),
             ''
           ) as call_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.prokind = 'f'
  loop
    v_call := format('api.%I(%s)', f.proname, f.call_args);
    v_vol  := case f.provolatile
                when 'i' then 'immutable'
                when 's' then 'stable'
                else 'volatile'
              end;

    -- A SETOF/table function is projected with `select *`; a composite-returning one
    -- is returned whole. Both cases hand back exactly what api.* returned, so the
    -- wrapper cannot change what a caller sees.
    v_body := case when f.proretset
                   then format('select * from %s', v_call)
                   else format('select %s', v_call)
                 end;

    execute format($ddl$
      create or replace function public.%I(%s)
      returns %s
      language sql
      %s
      set search_path = ''
      as %L
    $ddl$, f.proname, f.args, f.result, v_vol, v_body);
  end loop;
end;
$$;

-- ── 2. Grants: authenticated only, on both surfaces ─────────────────────────────
--
-- PUBLIC is revoked before anything is granted, because a function that inherits EXECUTE
-- from PUBLIC is executable by anon whether or not anon is named. service_role is kept
-- for the cron worker, which authenticates as the service role rather than as a user.

do $$
declare
  f record;
begin
  -- `api` is swept in full, because the anon grant is on every function there. `public`
  -- is swept only where a wrapper of that name was just created above, so this migration
  -- cannot reach a function it did not write -- notably rls_auto_enable(), which is
  -- platform-owned and which rls_coverage.test.sql already accounts for separately.
  for f in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and (
        n.nspname = 'api'
        or (n.nspname = 'public' and exists (
              select 1 from pg_proc a
              join pg_namespace an on an.oid = a.pronamespace
              where an.nspname = 'api'
                and a.proname = p.proname
                and a.pronargs = p.pronargs
            ))
      )
  loop
    execute format('revoke execute on function %I.%I from public, anon',
                   f.nspname, f.proname);
    execute format('grant execute on function %I.%I to authenticated, service_role',
                   f.nspname, f.proname);
  end loop;
end;
$$;

-- ── 3. What deliberately does NOT change here ───────────────────────────────────
--
-- A wrapper around api.whoami() returns TABLE(..., role private.app_role, ...), and it
-- would be reasonable to assume PostgREST needs USAGE on `private` to introspect that
-- type -- after all, granting USAGE on `private` to `authenticator` is the standard way to
-- make a private type appear in an API schema.
--
-- It does not need it, and this must not be granted: rls_coverage.test.sql asserts that
-- PostgREST cannot see `private`, and its own comment explains why. authenticator is the
-- role every request passes through, and `private` holds the privileged surface, the
-- balance trigger and the single writer of the ledger, with no RLS in front of any of it.
-- One grant would put all of it one schema-list change away from being served.
--
-- Verified rather than assumed: with the grant revoked, a wrapper returning
-- private.app_role stays exposed and stays callable. PostgREST resolves the type through
-- the catalog without schema USAGE, so nothing in `private` is made nameable here.

-- ── 4. Load the cache ───────────────────────────────────────────────────────────
--
-- Both notifications, together. 'reload config' for the schema list, 'reload schema' for
-- the object set. The first alone leaves a cache built for the wrong schema; the second
-- alone never re-reads the list. scripts/expose-api-schema.sql documents the pairing.

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- ── removing this ───────────────────────────────────────────────────────────────
--
--   drop function public.<name>(<signature>);   -- for each of the 49
--
-- Nothing else needs undoing: no schema grant is taken and no existing function is
-- altered, only re-granted to the roles the migrations always named.
--
-- and then fix the underlying fault, which is why the wrappers should be treated as
-- temporary: once PostgREST serves the `api` schema directly, nothing here is load-bearing.