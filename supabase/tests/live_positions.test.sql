-- ============================================================================
-- live_positions.test.sql
--
-- api.report_position() is the first thing in this system where a *moving* thing writes
-- its own coordinates continuously, rather than recording a fact once during a
-- transaction. That changes what can go wrong.
--
-- The failures that matter here are not "the row is wrong". They are:
--
--   - a driver placing a vehicle in another tenant's run;
--   - a driver writing a position for a run they are not driving;
--   - a stale queued report arriving late and dragging the marker backwards to where the
--     van used to be, which is the failure that would make a live map quietly wrong;
--   - a marker that never moves again because a finished run still accepts positions.
--
-- The assertions are mostly refusals, and the ordering guard below is the one that would
-- not have been found by reading the function.
-- ============================================================================

begin;

select plan(16);

-- Two drivers and two tenants, so "another tenant" and "another run" are two different
-- mistakes and both are reachable.
insert into auth.users (id, email, email_confirmed_at)
values
  ('44444444-0000-4000-8000-000000000001', 'live-driver@signup.test',  now()),
  ('44444444-0000-4000-8000-000000000002', 'other-driver@signup.test', now());

-- The tenant trigger overwrites tenant_id with the *caller's* tenant, so a setup insert
-- with no caller is rejected outright. That is the behaviour this suite later relies on,
-- which makes it an awkward thing to have to work around: the same rule that stops a driver
-- writing into another tenant's run also stops a test creating one from nothing. So the
-- caller is established here, before the first row that carries a tenant_id, and switched
-- per assertion afterwards.
set local request.jwt.claim.sub = '44444444-0000-4000-8000-000000000001';

insert into public.tenants (id, slug, name_en, country_code, currency_code)
values ('22222222-0000-4000-8000-000000000001', 'live-test-co', 'Live Test Co', 'EG', 'EGP')
on conflict (id) do nothing;

insert into public.profiles (id, tenant_id, role, full_name, is_active, locale)
values
  ('44444444-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001', 'DRIVER', 'Live Driver', true, 'en'),
  ('44444444-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-000000000001', 'DRIVER', 'Other Driver', true, 'en')
on conflict (id) do nothing;

-- Two vehicles, because trips is UNIQUE (tenant_id, vehicle_id, run_date): one van cannot
-- be on two runs on the same day. That constraint is right and the fixture was wrong, so
-- the fix is a second van rather than a second date -- a run dated yesterday would stop
-- being "today's run" and quietly stop meaning anything.
insert into public.vehicles (id, tenant_id, code, description, plate_number)
values
  ('33333333-0000-4000-8000-000000000001',
   '22222222-0000-4000-8000-000000000001', 'LIVE-1', 'Live test van', 'TEST-1'),
  ('33333333-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-000000000001', 'LIVE-2', 'Second test van', 'TEST-2')
on conflict (id) do nothing;

insert into public.trips (id, tenant_id, vehicle_id, driver_id, run_date, status, started_at)
values ('55555555-0000-4000-8000-000000000001',
        '22222222-0000-4000-8000-000000000001',
        '33333333-0000-4000-8000-000000000001',
        '44444444-0000-4000-8000-000000000001',
        current_date, 'IN_TRANSIT', now())
on conflict (id) do nothing;

insert into public.trips (id, tenant_id, vehicle_id, driver_id, run_date, status, started_at)
values ('55555555-0000-4000-8000-000000000002',
        '22222222-0000-4000-8000-000000000001',
        '33333333-0000-4000-8000-000000000002',
        '44444444-0000-4000-8000-000000000002',
        current_date, 'IN_TRANSIT', now())
on conflict (id) do nothing;

-- ── 1. the happy path ──────────────────────────────────────────────────────────

select ok(
  api.report_position('55555555-0000-4000-8000-000000000001', 30.0444, 31.2357) is not null,
  'the driver on the run reports a position'
);

select is(
  (select latitude::text || ',' || longitude::text
     from public.live_positions
    where trip_id = '55555555-0000-4000-8000-000000000001'),
  '30.0444,31.2357',
  'and the coordinates are stored as reported'
);
-- and numerically, which is the comparison that actually holds

select is(
  (select tenant_id from public.live_positions
    where trip_id = '55555555-0000-4000-8000-000000000001'),
  '22222222-0000-4000-8000-000000000001'::uuid,
  'the row carries the trip''s tenant'
);

-- ── 2. who may not write ───────────────────────────────────────────────────────

select throws_ok(
  $$select api.report_position('55555555-0000-4000-8000-000000000002', 30.0, 31.0)$$,
  '42501',
  'only the driver on this run may report its position',
  'a driver cannot report for a run somebody else is driving'
);

select throws_ok(
  $$select api.report_position('55555555-0000-4000-8000-000000000001', 999, 31.0)$$,
  '22023',
  'latitude out of range',
  'a latitude outside the world is refused'
);

select throws_ok(
  $$select api.report_position('55555555-0000-4000-8000-000000000001', 30.0, 31.0,
                               now() + interval '2 hours')$$,
  '22023',
  'recorded_at is in the future',
  'a timestamp from the future is refused: it would freeze the marker at that fix'
);

select is_empty(
  $$select 1 from public.live_positions where latitude > 90 or longitude > 180$$,
  'no out-of-range coordinate was written'
);

-- ── 3. the ordering guard ──────────────────────────────────────────────────────
--
-- This is the assertion the whole `where excluded.recorded_at >= lp.recorded_at` clause
-- exists for. The offline queue flushes when a driver comes back into signal, and two
-- reports queued minutes apart can arrive in either order. Without the guard the marker
-- jumps *backwards* to where the van was, and the map looks live while being wrong.

select ok(
  api.report_position('55555555-0000-4000-8000-000000000001', 30.1000, 31.1000) is not null,
  'a second, newer fix is accepted'
);

-- Replay the *first* fix, late. Its recorded_at is older than what is stored.
select ok(
  api.report_position('55555555-0000-4000-8000-000000000001', 30.0444, 31.2357,
                      now() - interval '2 minutes') is not null,
  'a late-arriving older report is not an error'
);

-- Compared numerically, and that is the whole correction. The first version asserted
-- `latitude::text = '30.1'` and failed against a stored value of 30.1000 -- correct
-- number, wrong test. Postgres `numeric` preserves the scale it was given, so a text
-- comparison against a value that happens to render the same way is a coin flip.
--
-- Self-describing on purpose: the stored value is in the assertion message, so a failure
-- says what the marker actually ended up on. The shim truncates messages, which is exactly
-- why it is here in the text.
select ok(
  (select latitude = 30.1::numeric
     from public.live_positions where trip_id = '55555555-0000-4000-8000-000000000001'),
  'the stale replay did NOT overwrite the newer fix; stored latitude is '
    || (select latitude::text from public.live_positions
         where trip_id = '55555555-0000-4000-8000-000000000001')
    || ' (expected 30.1)'
);

-- ── 4. one row per trip ────────────────────────────────────────────────────────

select is(
  (select count(*) from public.live_positions
    where trip_id = '55555555-0000-4000-8000-000000000001'),
  1::bigint,
  'repeated reports update one row rather than accumulating'
);

-- ── 5. a finished run ──────────────────────────────────────────────────────────

-- PLANNED rather than COMPLETED. Completing a run trips a check constraint that all its
-- stops are closed, which is a real rule about runs and nothing to do with positions --
-- satisfying it here would mean inventing a stop. PLANNED exercises the identical guard
-- (`status <> 'IN_TRANSIT'`) without borrowing an unrelated domain rule to set it up.
update public.trips set status = 'PLANNED'
 where id = '55555555-0000-4000-8000-000000000002';

-- Become that run's driver before reporting against it. The first version of this suite
-- forgot, and it failed with 'only the driver on this run may report its position' --
-- because report_position checks the driver before the status, so the status guard was
-- never reached. A test that exercises the wrong guard still fails, which is the dangerous
-- kind of failure: it looks like coverage and is not.
set local request.jwt.claim.sub = '44444444-0000-4000-8000-000000000002';

select throws_ok(
  $$select api.report_position('55555555-0000-4000-8000-000000000002', 30.0, 31.0)$$,
  '22023',
  'run is not in transit',
  'a run that is not in transit accepts no further positions, so the marker cannot park for ever'
);

-- ── 6. a re-armed demo run carries no vehicle ───────────────────────────────────
--
-- The re-arm puts the demo run back into IN_TRANSIT -- the one status the dispatcher map
-- draws a vehicle for -- and used to leave the previous run's position row in place. So a
-- re-armed demo rendered a marker on the fresh run at wherever the van was before the
-- reset, drawn as current. It surfaced as two browser tests that passed alone and failed
-- in a full run; the reset was what was incomplete, not the tests.
--
-- TENANT_ADMIN rather than a warehouse manager because the demo tenant has no warehouse
-- manager, and reset_demo_run() accepts either.

set local request.jwt.claim.sub = '11111111-0000-4000-8000-000000000101';

insert into public.live_positions (tenant_id, trip_id, latitude, longitude, recorded_at)
select t.tenant_id, t.id, 30.5, 31.5, now() - interval '90 minutes'
  from public.trips t
 where t.tenant_id = '11111111-0000-4000-8000-000000000001'
   and t.notes = 'Morning run'
 order by t.run_date desc
 limit 1;

select is(
  (select count(*) from public.live_positions lp
    join public.trips t on t.id = lp.trip_id
   where t.notes = 'Morning run'),
  1::bigint,
  'precondition: the demo run carries a position from the run that just ended'
);

select is(
  (select positions_cleared from api.reset_demo_run()),
  1::integer,
  'the re-arm clears the previous run''s position and says so'
);

select is_empty(
  $$select 1 from public.live_positions lp
    join public.trips t on t.id = lp.trip_id
   where t.notes = 'Morning run'$$,
  'and no marker survives on the re-armed run'
);

-- The reason the clear was necessary rather than tidy: the re-arm leaves the run in the
-- status that makes the map draw a vehicle. Without this the two assertions above would
-- pass just as well if the trip had been left COMPLETED, and would then be testing
-- nothing about staleness.
select is(
  (select t.status::text from public.trips t
    where t.notes = 'Morning run' order by t.run_date desc limit 1),
  'IN_TRANSIT',
  'the re-armed run is in transit, so the stale marker would have been drawn'
);

select * from finish();
rollback;
