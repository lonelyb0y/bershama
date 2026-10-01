-- The reset lives in `api`, and the `maintenance` schema goes away.
--
-- 0050 through 0055 built a `maintenance` schema to hold maintenance.reset_demo_run(),
-- granted its USAGE to the PostgREST authenticator (0052), asserted the privilege
-- shape (0053), notified a reload (0054) and called pgrst.reload_schema() (0055).
-- It still answered PGRST106, and the reason is not any of those:
--
-- PostgREST only routes schemas that are in the project's exposed-schema list. That
-- list is project configuration, not a privilege, so no GRANT can add to it -- and a
-- function in an unexposed schema is unreachable by everyone, including the service
-- role it was written for. Four migrations of increasingly careful reasoning about a
-- problem that was never about privileges.
--
-- So the function goes where the other security-definer functions already are.
--
-- ── why `api` is safe for this ───────────────────────────────────────────────
-- Being in `api` does not make it callable. EXECUTE is granted per function, and
-- this one is granted to service_role alone; a client that reaches it is refused by
-- PostgreSQL, which is what rls_coverage asserts for every function in the schema.
--
-- And being in `api` has a real advantage over the schema I invented: rls_coverage
-- enumerates the allow-listed wrappers, so this function is now named in a test that
-- fails if anyone adds an unlisted one. The `maintenance` schema was a place nobody
-- reviewed, which was the opposite of the intention.
--
-- What it does NOT become is a product feature. It is not on any surface, the
-- dashboard does not call it, and the only caller is scripts/reset-demo-delivery.sh.

create or replace function api.reset_demo_run()
returns table (stops_reset integer, proofs_removed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Scoped by the demo tenant's constant and by the run's note, never by an argument:
  -- there is no version of this call that can reach a customer's deliveries.
  v_tenant constant uuid := '11111111-0000-4000-8000-000000000001';
  v_trip   uuid;
  v_stops  integer;
  v_proofs integer;
begin
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

  update public.trips t
  set status = 'IN_TRANSIT'::private.trip_status, ended_at = null, updated_at = now()
  where t.id = v_trip;

  return query select v_stops, v_proofs;
end
$$;

grant execute on function api.reset_demo_run() to service_role;
revoke execute on function api.reset_demo_run() from public;
revoke execute on function api.reset_demo_run() from anon;
revoke execute on function api.reset_demo_run() from authenticated;

comment on function api.reset_demo_run() is
  'Puts the demo tenant''s morning run back to a demonstrable state: stop 1 ARRIVED with its position, stop 2 PENDING, trip IN_TRANSIT, and the run''s proofs of delivery deleted. Exists because working the stops consumes them -- once both are DELIVERED the driver screen opens onto a finished run and there is nothing left to show. Scoped to the demo tenant by constant rather than by argument, and executable only by the service role. Not a product feature: no surface calls it and the only caller is scripts/reset-demo-delivery.sh.';

-- ── removing the schema that did not work ───────────────────────────────────
--
-- Cascade, because the function inside it is the only object and it is now duplicated
-- above. Anything else left in here in the meantime would be removed silently, so the
-- emptiness is asserted first: if somebody has added a second object to a schema that
-- was never routable, this migration should say so rather than delete it.
do $$
declare
  v_objects integer;
begin
  select count(*) into v_objects
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'maintenance' and c.relkind in ('r', 'v', 'm', 'S');

  if v_objects > 0 then
    raise exception 'maintenance schema holds % relation(s) -- inspect before dropping', v_objects;
  end if;
end
$$;

drop schema if exists maintenance cascade;
