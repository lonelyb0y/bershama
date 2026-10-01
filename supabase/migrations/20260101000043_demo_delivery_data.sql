-- Demo delivery data, for the hosted project.
--
-- seed.sql holds the local demo tenant and was applied to the hosted project before
-- M4 existed, so the rows 0038-style for the demo driver are needed there too. This
-- is the same block, applied to the hosted database, because a migration is the only
-- way to reach it.
--
-- Idempotent, and written to be harmless if the demo tenant is not seeded: the
-- foreign keys fail loudly rather than inventing a tenant.

-- ── M4 demo data: a run for the demo driver ─────────────────────────────────
--
-- A vehicle and today's run, already dispatched to driver@demo.local with two
-- stops -- one arrived, one still to visit. Without this the driver surface opens
-- onto an empty state, and an empty state is a bad demonstration of the surface
-- that matters most: somebody reviewing this would conclude the milestone is not
-- built.
--
-- Built through the api.* functions rather than inserted, because that is how a run
-- exists: the tenant triggers overwrite tenant_id from the session, so a direct
-- insert with no session fails on a NOT NULL -- and even if it did not, a seeded run
-- that skipped dispatch_trip's checks would be a row the application could never
-- have created. The demo data should be reachable by the same rules as real data.
--
-- DISPATCHED rather than IN_TRANSIT on purpose. A seeded run already on the road
-- would show the map with positions on it and no way to reach them, and the
-- positions are the thing a reviewer most wants to see. The driver starts it.

do $$
declare
  v_manager uuid;
  v_driver  uuid;
  v_trip    public.trips;
begin
  -- The demo accounts are found by email rather than by the seeded ids. The local
  -- seed uses 11111111-...-000000000101 and 103, but the hosted project was seeded
  -- through account creation and its profiles carry generated uuids -- so hardcoding
  -- them worked locally and failed on the hosted database, which is the direction
  -- that matters least to notice.
  select p.id into v_manager
  from public.profiles p join auth.users u on u.id = p.id
  where u.email = 'admin@demo.local';

  select p.id into v_driver
  from public.profiles p join auth.users u on u.id = p.id
  where u.email = 'driver@demo.local';

  -- A no-op on a database that is not the demo one. This migration runs BEFORE
  -- seed.sql on a fresh environment, so raising here would mean a demo fixture
  -- could stop the whole migration set from applying anywhere but the demo
  -- project. Demo data is not worth that: on a fresh database the run is created
  -- by the seed instead, which is the right place for it.
  if v_manager is null or v_driver is null then
    raise notice 'demo accounts not present -- skipping demo delivery data';
    return;
  end if;

  -- Same reason as the stock fixtures above: the wrappers check the caller's role
  -- through profiles, so the session has to look signed in.
  perform set_config('request.jwt.claim.sub', v_manager::text, true);

  if not exists (select 1 from public.vehicles where code = 'VAN-1') then
    perform api.create_vehicle('VAN-1', 'Refrigerated delivery van', 'ABC 1234');
  end if;

  if not exists (select 1 from public.trips where notes = 'Morning run' and run_date = current_date) then
    select * into v_trip
    from api.create_trip(current_date,
                         (select id from public.vehicles where code = 'VAN-1' limit 1),
                         'Morning run');

    perform api.add_trip_stop(v_trip.id, '11111111-0000-4000-8000-000000000202');
    perform api.add_trip_stop(v_trip.id, '11111111-0000-4000-8000-000000000203');
    perform api.dispatch_trip(v_trip.id, v_driver);
  else
    select * into v_trip
    from public.trips where notes = 'Morning run' and run_date = current_date limit 1;
  end if;

  -- One stop already arrived, with a position, so the map has something to plot and
  -- the sign sheet is reachable without faking a geolocation fix in a test.
  if exists (
    select 1 from public.delivery_stops
    where trip_id = v_trip.id and sequence = 1 and status = 'PENDING'
  ) then
    perform set_config('request.jwt.claim.sub', v_driver::text, true);
    perform api.start_trip(v_trip.id);
    perform api.arrive_at_stop(
      (select id from public.delivery_stops where trip_id = v_trip.id and sequence = 1),
      30.0444, 31.2357
    );
  end if;
end
$$;
