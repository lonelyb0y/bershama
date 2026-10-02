-- 0060: let the demo run be re-armed by a signed-in warehouse manager, and re-date it
--
-- ── the problem ────────────────────────────────────────────────────────────────
--
-- The demo trip was seeded once, with a `run_date` that was "today" on the day the
-- seed ran and is a fixed past date ever after. Two things depended on that being
-- today's date and neither said so:
--
--   * The dashboard's "on the road today" panel, which correctly showed
--     "No run is planned for today" -- true, and not obviously broken.
--   * `deliveries.spec.ts`, which signs in as the driver and needs an *undelivered*
--     stop to act on. Two of its tests failed once the date rolled past the seed,
--     and nothing in the failure said why. They looked like application bugs.
--
-- Re-arming already existed as `api.reset_demo_run()`, but it was granted to
-- `service_role` alone, because it is a test-support script and the safe answer to
-- "should an end user be able to wipe proofs of delivery" was no.
--
-- ── what changes, and why it is still scoped ───────────────────────────────────
--
-- Two changes, both narrow:
--
--   1. The trip is re-dated to `current_date`, so "today" is today again.
--   2. Execute is granted to `authenticated` as well, behind the same role gate every
--      other `api` write function uses.
--
-- The scoping is what makes the second change acceptable, and it is unchanged from
-- 0056: the tenant is a *constant* in the function body and the trip is found by that
-- tenant plus the note `Morning run`. There is no argument a caller can pass to widen
-- either. A warehouse manager who calls this can reset the demo run and nothing else
-- -- no customer's deliveries, because those belong to other tenants and the constant
--   does not match them.
--
-- So the privilege is "reset the demo run", not "reset any run". That is a real
-- capability, and the demo tenant is the only place it does anything. It is granted
-- because the alternative was for the browser suite to hold a service-role key in CI
-- and write to the hosted database from a pull request, which is a far larger
-- capability than this one, held in a worse place.
--
-- ── why the role gate is inside, not implied by the grant ──────────────────────
--
-- Because `authenticated` includes every signed-in person, not warehouse managers. The
-- check is `private.has_role('WAREHOUSE_MANAGER', 'TENANT_ADMIN')`, the same pair the
-- catalogue and requisition writers use. A pharmacist calling this is refused.

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