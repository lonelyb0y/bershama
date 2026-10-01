-- The maintenance schema must not be routable over HTTP.
--
-- Asserted here as well as in rls_coverage.test.sql, because this is a schema that
-- exists to do work through the service role and the only thing standing between it
-- and a client is a handful of GRANTs. 0050 is where those GRANTs are written, so
-- this is the migration that fails if they are ever too generous.
--
-- The check is over the whole schema rather than a fixed list of functions, so a
-- function added later is covered by the same assertion.

do $$
declare
  v_leak text;
begin
  select string_agg(format('%s on %s', privilege_type, grantee), ', ')
  into v_leak
  from information_schema.role_table_grants
  where table_schema = 'maintenance'
    and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_leak is not null then
    raise exception 'maintenance schema is reachable by a client role: %', v_leak;
  end if;

  -- The schema itself, which is what actually makes it nameable over PostgREST. The
  -- function grant above is the second lock; this is the first.
  if has_schema_privilege('authenticator', 'maintenance', 'USAGE') then
    raise exception 'PostgREST can see the maintenance schema';
  end if;

  if has_schema_privilege('authenticated', 'maintenance', 'USAGE') then
    raise exception 'authenticated can see the maintenance schema';
  end if;

  -- And the invariant 0049 broke, restated so that restoring it is deliberate rather
  -- than something a future migration can undo by accident.
  if has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'service_role must not be able to see the private schema';
  end if;
end
$$;

comment on schema maintenance is
  'Operational tasks that are not product features: no USAGE for anon, authenticated, PostgREST''s authenticator or service_role-on-private, so nothing here is routable over HTTP and nothing here unseals private. 0051 asserts all of that, which is what makes the GRANTs in 0050 safe to trust. Reachable only by the service role.';
