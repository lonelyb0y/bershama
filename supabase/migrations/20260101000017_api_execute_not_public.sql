-- Drop PUBLIC execute on every api function, not just anon's direct grant.
--
-- The third attempt at this, and the one that is actually correct.
--
-- postgres grants EXECUTE to PUBLIC on every function it creates. 0014 revoked
-- from `anon` only, which was sufficient then, but 0015 had to `drop function
-- api.whoami()` in order to change its return type (postgres refuses 42P13 on
-- create or replace), and the recreated function came back with the default
-- PUBLIC grant. Revoking from `anon` again did not clear it:
-- has_function_privilege('anon', ...) still answered true by inheritance, and
-- rls_coverage.test.sql assertion 16 -- "anon cannot EXECUTE any function in
-- the api schema" -- failed on every run.
--
-- The lesson generalises past whoami: the property 0014 wanted to establish is
-- "no unauthenticated caller can reach the api schema", and revoking one role
-- does not establish it when PUBLIC is in the picture. So this revokes from
-- PUBLIC across the whole schema, and keeps the explicit grants to the two
-- roles that are supposed to have them.
--
-- Looped for the same reason 0014 was: there is no blanket "revoke on all
-- routines in schema", and the list will grow.

do $$
declare
  v_record record;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    for v_record in
      select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api'
    loop
      execute format('revoke execute on function %s from public', v_record.signature);
      execute format('revoke execute on function %s from anon', v_record.signature);
    end loop;
  end if;
end
$$;

grant execute on all functions in schema api to authenticated, service_role;
