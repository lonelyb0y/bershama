-- ============================================================================
-- 20260101000014_anon_has_no_api_execute.sql
--
-- `anon` must not be able to execute anything in the `api` schema.
--
-- ── why this needs saying in a migration ────────────────────────────────────
--
-- The dashboard's Data API settings has an "Exposed functions" list, and ticking
-- a function there grants EXECUTE to the API roles. On this project that toggle
-- was used to expose three functions and in fact granted EXECUTE to `anon` on all
-- eighteen, including `api.stock_take` -- a SECURITY DEFINER function that moves
-- stock.
--
-- It was inert, because `anon` has no USAGE on the `api` schema and USAGE is
-- required before a function in it can be reached. But that is one checkbox away
-- from an unauthenticated caller invoking stock movements, and an invariant that
-- holds only because of a setting in a dashboard is not an invariant.
--
-- So it is revoked here, in the same transaction as everything else, and asserted
-- in rls_coverage.test.sql. The dashboard can still be used to expose functions;
-- it just cannot quietly make the privileged surface public, and if it does,
-- `make test-db` says so.
--
-- ── why EXECUTE for anon is wrong even with USAGE ────────────────────────────
--
-- `authenticated` is the role a signed-in user acts as, and every api function
-- re-checks that role inside itself through private.require_inventory_write(),
-- which is where the actual authorisation decision is made. `anon` is nobody, and
-- has no profile, no role and no tenant -- so the function would refuse it anyway,
-- but only after the request had reached privileged code. Refusing at the door
-- is the difference between a rejected request and an error in a security-definer
-- path.
--
-- `service_role` is untouched: it is the trusted server-side key and bypasses RLS
-- by design, and nothing in this schema is exposed to a browser through it.
-- ============================================================================

do $$
declare
  v_record record;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- Looped rather than a blanket statement, because there is no `revoke
    -- execute on all routines in schema` and the list will grow. New functions in
    -- `api` are therefore not covered by this migration, which is why
    -- rls_coverage.test.sql asserts the property over the whole schema rather than
    -- over a fixed list.
    for v_record in
      select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api'
    loop
      execute format('revoke execute on function %s from anon', v_record.signature);
    end loop;
  end if;
end
$$;

-- The schema itself. `anon` never needs to name `api` in a request, and USAGE is
-- what turns an exposed function into a reachable one.
revoke usage on schema api from anon;
