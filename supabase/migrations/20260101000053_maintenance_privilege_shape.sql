-- The privilege shape of `maintenance`, asserted.
--
-- A single function in a schema nobody reviews is a privilege waiting to be widened
-- by a well-meaning migration. These assertions are the shape that must hold, written
-- down where a change to it will fail rather than pass review.
--
-- Three properties, and each is a distinct way this could go wrong:
--
--   1. PostgREST can route it. Without USAGE for `authenticator` the function is
--      unreachable by anyone (PGRST106, which is what 0051's assertion caused).
--   2. No client can call it. anon and authenticated have neither USAGE nor EXECUTE,
--      so a client cannot even name it, and a service-role request is the only one
--      that can reach the body.
--   3. `private` is still sealed to service_role. This restates the invariant 0049
--      breached so that re-granting it has to be a deliberate edit here.

do $$
declare
  v_name text;
begin
  -- (2) first, because it is the property that matters most.
  if has_schema_privilege('anon', 'maintenance', 'USAGE')
     or has_schema_privilege('authenticated', 'maintenance', 'USAGE') then
    raise exception 'a client role can see the maintenance schema';
  end if;

  select p.proname into v_name
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'maintenance'
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_name is not null then
    raise exception 'anon can execute maintenance.%', v_name;
  end if;

  select p.proname into v_name
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'maintenance'
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if v_name is not null then
    raise exception 'authenticated can execute maintenance.%', v_name;
  end if;

  -- (1) PostgREST must be able to route, or the function is decorative.
  if not has_schema_privilege('authenticator', 'maintenance', 'USAGE') then
    raise exception 'PostgREST cannot route the maintenance schema';
  end if;

  -- (3) the invariant from 0026/0050.
  if has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'service_role must not be able to see the private schema';
  end if;
end
$$;
