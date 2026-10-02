-- 0062: repair 0060's role lookup on databases where it was already applied
--
-- 0060 called `private.current_app_role()`. No such function exists -- it is
-- `private.current_role()` -- so every invocation failed at runtime with
--
--   42883: function private.current_app_role() does not exist
--
-- which is the sort of mistake that survives every check this project has: a plpgsql
-- body is not resolved when the function is created, so `make test-db` applied it
-- without complaint, TypeScript never sees it, and `check-api-types.py` only compares
-- argument names. It was found by calling the function.
--
-- 0060 is also corrected in place, so a database built from scratch applies the right
-- body directly. This migration exists because 0060 is already applied here and
-- recorded in the hosted project's migration history -- editing it alone would fix
-- future builds and leave the deployed database broken, which is the drift this
-- repository goes out of its way to avoid.
--
-- The body below is identical to 0060's corrected one. Applying both in order is
-- harmless: the second definition replaces the first.

create or replace function api.reset_demo_run()
returns table (stops_reset integer, proofs_removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Unchanged from 0056: a constant, never an argument.
  v_tenant constant uuid := '11111111-0000-4000-8000-000000000001';
  v_trip   uuid;
  v_stops  integer;
  v_proofs integer;
  v_role   private.app_role;
begin
  -- `private.current_role()`, not `current_app_role()`: the first version of this
  -- migration named a function that does not exist, and the failure was a runtime
  -- `42883` from the database rather than anything the linter or the type checker
  -- could see, because a plpgsql body is not resolved when it is created.
  --
  -- service_role has no row in profiles, so current_role() is null there. A null role
  -- is the service role; anything else has to clear the gate.
  v_role := private.current_role();

  if v_role is not null
     and not (select private.has_role('WAREHOUSE_MANAGER', 'TENANT_ADMIN')) then
    raise exception 'only a warehouse manager may reset the demo run' using errcode = '42501';
  end if;

  select t.id into v_trip
  from public.trips t
  where t.tenant_id = v_tenant and t.notes = 'Morning run'
  order by t.run_date desc
  limit 1;

  if v_trip is null then
    raise exception 'no demo run in the demo tenant' using errcode = 'P0002';
  end if;

  -- Proofs first: delivery_stops carries a check that a closed stop has a close time,
  -- so clearing the stop's timestamps while its evidence still exists would fail.
  with removed as (
    delete from public.proofs_of_delivery p
    using public.delivery_stops s
    where p.stop_id = s.id and s.trip_id = v_trip
    returning 1
  )
  select count(*) into v_proofs from removed;

  update public.delivery_stops s
  set status = case when s.sequence = 1 then 'ARRIVED'::private.stop_status else 'PENDING'::private.stop_status end,
      arrived_at = case when s.sequence = 1 then now() else null end,
      delivered_at = null,
      closed_at = null,
      failure_reason = null,
      -- The position the seed recorded, so the map has something to plot on the first
      -- stop. Without it the driver screen shows its empty state and the map
      -- demonstrates nothing.
      latitude = case when s.sequence = 1 then 30.0444 else null end,
      longitude = case when s.sequence = 1 then 31.2357 else null end,
      updated_at = now()
  where s.trip_id = v_trip;

  get diagnostics v_stops = row_count;

  -- Re-dated, which is the reason this migration exists: "today" stopped being today
  -- the moment the seed was written, and every "on the road today" surface since then
  -- has been reporting an empty day that looked like a bug rather than a stale fixture.
  update public.trips t
  set status = 'IN_TRANSIT'::private.trip_status,
      run_date = current_date,
      ended_at = null,
      updated_at = now()
  where t.id = v_trip;

  return query select v_stops, v_proofs;
end
$$;

grant execute on function api.reset_demo_run() to service_role;
grant execute on function api.reset_demo_run() to authenticated;
revoke execute on function api.reset_demo_run() from public;
revoke execute on function api.reset_demo_run() from anon;