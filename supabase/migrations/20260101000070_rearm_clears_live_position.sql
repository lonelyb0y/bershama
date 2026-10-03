-- 0070: a re-armed demo run must not keep the last run's vehicle position
--
-- ── the bug this fixes ──────────────────────────────────────────────────────────
--
-- api.reset_demo_run() resets the stops, deletes the proofs and re-dates the trip back
-- to IN_TRANSIT. It did not touch public.live_positions. So after a re-arm:
--
--   * the trip is IN_TRANSIT, which is the one status the dispatcher map draws a vehicle
--     for;
--   * the position row from the run that just ended is still there, with its original
--     recorded_at.
--
-- The map therefore renders a marker on the freshly re-armed run at a place the van was
-- before the reset. That is the exact failure the age fade in StopMap was written to
-- prevent -- "we last saw it here" drawn as though it were now -- except the age fade
-- cannot help, because a re-arm is supposed to be a clean slate and the stale marker is
-- the only thing on it.
--
-- It surfaced as two failing browser tests that only failed in a full run and passed in
-- isolation: a leftover row from the previous spec. A test that depends on there being no
-- vehicle yet is the right test to have written. The reset was what was incomplete.
--
-- ── why this is a delete and not a timestamp bump ────────────────────────────────
--
-- Backdating the existing row to now() would make it look *fresher*, which is strictly
-- worse: a live-looking marker with a position recorded hours ago is a lie the age
-- calculation can no longer detect. The row has to go.
--
-- ── scoping ─────────────────────────────────────────────────────────────────────
--
-- Scoped to v_trip, the same trip every other statement in this function touches, found
-- by the same constant tenant and the same `notes = 'Morning run'`. No argument widens
-- it. This adds no capability beyond what reset_demo_run() already had.
--
-- `on delete cascade` from trips does not save us here: the trip is not deleted, only
-- re-dated, so nothing cascades.

-- DROP first, not CREATE OR REPLACE: the return type gains a column, and PostgreSQL
-- refuses to change a function's return type in place ("cannot change return type of
-- existing function"). A drop and recreate also drops the grants with it, which is why
-- they are all restated at the bottom rather than assumed to survive.
drop function if exists api.reset_demo_run();

create function api.reset_demo_run()
returns table (stops_reset integer, proofs_removed integer, positions_cleared integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Unchanged from 0056: a constant, never an argument.
  v_tenant    constant uuid := '11111111-0000-4000-8000-000000000001';
  v_trip      uuid;
  v_stops     integer;
  v_proofs    integer;
  v_positions integer;
  v_role      private.app_role;
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

  -- The vehicle position, gone rather than refreshed. See the header: a re-arm that
  -- leaves the last run's fix in place draws it as current, because the trip is about to
  -- be put back into the one status the map draws a vehicle for.
  with cleared as (
    delete from public.live_positions lp
    where lp.trip_id = v_trip
    returning 1
  )
  select count(*) into v_positions from cleared;

  update public.delivery_stops s
  set status = case when s.sequence = 1 then 'ARRIVED'::private.stop_status else 'PENDING'::private.stop_status end,
      arrived_at = case when s.sequence = 1 then now() else null end,
      delivered_at = null,
      closed_at = null,
      failure_reason = null,
      -- The position the seed recorded, so the map has something to plot on the first
      -- stop. Without it the driver screen shows its empty state and the map
      -- demonstrates nothing.
      --
      -- This is the *stop's* location -- where the van was when it got there -- and is a
      -- different thing from live_positions, which is where the van is now. Overwriting
      -- the stop to 30.0444 and leaving a live row somewhere else would show the two
      -- disagreeing on the same map.
      latitude = case when s.sequence = 1 then 30.0444 else null end,
      longitude = case when s.sequence = 1 then 31.2357 else null end,
      updated_at = now()
  where s.trip_id = v_trip;

  get diagnostics v_stops = row_count;

  -- Re-dated, which is the reason the original migration exists: "today" stopped being
  -- today the moment the seed was written, and every "on the road today" surface since
  -- then has been reporting an empty day that looked like a bug rather than a stale
  -- fixture.
  update public.trips t
  set status = 'IN_TRANSIT'::private.trip_status,
      run_date = current_date,
      ended_at = null,
      updated_at = now()
  where t.id = v_trip;

  return query select v_stops, v_proofs, v_positions;
end
$$;

comment on function api.reset_demo_run() is
  'Reset the demo run in the constant demo tenant: stops back to their seeded statuses, '
  'proofs and live vehicle position deleted, trip re-dated to today and IN_TRANSIT. Scoped '
  'to one trip found by a constant tenant and note; no argument widens it.';

grant execute on function api.reset_demo_run() to service_role;
grant execute on function api.reset_demo_run() to authenticated;
revoke execute on function api.reset_demo_run() from public;
revoke execute on function api.reset_demo_run() from anon;

notify pgrst, 'reload schema';