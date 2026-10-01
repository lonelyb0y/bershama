-- Revoked again, and this time for a stated reason rather than a discovered one.
--
-- 0049 granted service_role USAGE on `private` so that scripts/reset-demo-delivery.sh
-- could PATCH a column whose type is private.stop_status -- writing an enum literal
-- means naming the type, and naming the type means USAGE on its schema. That made
-- the script work.
--
-- It also broke an assertion that has been in rls_coverage.test.sql since the private
-- schema was created: service_role must not be able to see `private`. The suite caught
-- it immediately, and the suite is right. USAGE on `private` is what makes the
-- SECURITY DEFINER functions in there nameable, and "no role can name them" is the
-- property the whole schema exists for. Trading it for the convenience of a demo
-- script is the wrong trade in both directions: it weakens a stated guarantee to
-- serve a maintenance task, and it does so invisibly, because the grant reads as
-- innocuous.
--
-- So: revoke it, and give the maintenance task a narrow entry point instead.

revoke usage on schema private from service_role;

comment on schema private is
  'Types and functions that no role may name. USAGE is withheld from anon, authenticated, service_role AND the PostgREST authenticator, which rls_coverage.test.sql asserts for each. Every function here is SECURITY DEFINER and is reachable only as a trigger or as the body of an api.* function -- never by name. A grant of USAGE to service_role was added in 0049 and removed in 0050: it lets a maintenance script write an enum-typed column, at the cost of the guarantee this schema exists to provide.';

-- ── a narrow way to put the demo run back ───────────────────────────────────
--
-- One schema, no USAGE for anybody over HTTP, one function, and it is scoped to the
-- demo tenant by construction rather than by argument -- so it cannot be pointed at
-- a customer's data even by somebody who finds it.
--
-- It is not an api.* function on purpose. api.* is the application's write surface:
-- every function there enforces a business rule and is on the dashboard's exposed
-- list. A function whose job is to un-deliver a stop does not belong beside those,
-- because the next person to read the schema would reasonably assume everything in
-- it is part of the product.
--
-- PostgREST cannot reach it: the schema has no USAGE for `authenticator`, and
-- rls_coverage asserts that over the whole of `api` and of `private`. This one is
-- asserted too, in 0051.

create schema if not exists maintenance;

comment on schema maintenance is
  'Operational tasks that are not product features. No USAGE for anon, authenticated or the PostgREST authenticator, so nothing here is routable over HTTP; reachable only by the service role, which bypasses RLS anyway. Anything added here should be a task an operator needs to run and a client must never be able to.';

revoke all on schema maintenance from public;
revoke all on schema maintenance from anon;
revoke all on schema maintenance from authenticated;
revoke all on schema maintenance from authenticator;

create or replace function maintenance.reset_demo_run()
returns table (stops_reset integer, proofs_removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := '11111111-0000-4000-8000-000000000001';
  v_trip   uuid;
  v_stops  integer;
  v_proofs integer;
begin
  -- Scoped by the tenant constant and the run's note, never by an argument: there is
  -- no version of this call that can reach a customer's deliveries.
  select t.id into v_trip
  from public.trips t
  where t.tenant_id = v_tenant and t.notes = 'Morning run'
  order by t.run_date desc
  limit 1;

  if v_trip is null then
    raise exception 'no demo run in the demo tenant' using errcode = 'P0002';
  end if;

  -- The proofs first. delivery_stops carries a check that a closed stop has a close
  -- time, so clearing the stop's timestamps while its evidence still exists would
  -- fail -- and the order matters for the same reason it does in the script.
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
      -- stop. Without it the driver screen shows the empty state and the demonstration
      -- of the map is a demonstration of nothing.
      latitude = case when s.sequence = 1 then 30.0444 else null end,
      longitude = case when s.sequence = 1 then 31.2357 else null end,
      updated_at = now()
  where s.trip_id = v_trip;

  get diagnostics v_stops = row_count;

  update public.trips t
  set status = 'IN_TRANSIT'::private.trip_status, ended_at = null, updated_at = now()
  where t.id = v_trip;

  return query select v_stops, v_proofs;
end
$$;

revoke all on function maintenance.reset_demo_run() from public;
revoke all on function maintenance.reset_demo_run() from anon;
revoke all on function maintenance.reset_demo_run() from authenticated;
revoke all on function maintenance.reset_demo_run() from authenticator;

grant execute on function maintenance.reset_demo_run() to service_role;

comment on function maintenance.reset_demo_run() is
  'Puts the demo tenant''s morning run back to a demonstrable state: stop 1 ARRIVED with its position, stop 2 PENDING, trip IN_TRANSIT, and the run''s proofs of delivery deleted. Exists because working the stops consumes them -- once both are DELIVERED the driver screen opens onto a finished run and there is nothing to show. Scoped to the demo tenant by constant rather than by argument, and reachable only by the service role.';
