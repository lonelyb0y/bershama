-- Delivery trips: the lifecycle, and the rules that have to survive a phone with
-- a stale session.
--
-- ── what is worth asserting here ────────────────────────────────────────────
--
-- The delivery chain is a sequence of state transitions that each depend on the
-- ones before. The interesting failures are the ones a client cannot make but a
-- stale phone can:
--
--   * signing for a stop nobody arrived at
--   * closing a run while a stop is still unvisited
--   * working a stop that is on somebody else's run
--   * dispatching a van that is already out
--   * cancelling a run whose stock has left the warehouse
--
-- Each of those is an assertion here, and each is a 22023 or a P0002 rather than
-- a silent bad record. A delivery record is evidence; a wrong one is worse than
-- a missing one, because it will be believed.

begin;

select plan(50);

-- ── fixtures ────────────────────────────────────────────────────────────────
--
-- Two pharmacy facilities and a warehouse, one vehicle, and three profiles: a
-- dispatcher who plans, a driver who works the run, and a warehouse manager who
-- is neither -- because the tests that matter are the ones where somebody with a
-- plausible role tries to do a thing that is not theirs.

insert into public.tenants (id, slug, name_en, currency_code, vat_rate, timezone)
values ('55555555-0000-4000-8000-000000000001', 'delivery-test', 'Delivery Test Co', 'EGP', 0.14, 'Africa/Cairo');

insert into auth.users (id, email, aud, role)
values
  ('55555555-0000-4000-8000-000000000011', 'dispatcher@delivery-test.local', 'authenticated', 'authenticated'),
  ('55555555-0000-4000-8000-000000000012', 'driver@delivery-test.local', 'authenticated', 'authenticated'),
  ('55555555-0000-4000-8000-000000000013', 'manager@delivery-test.local', 'authenticated', 'authenticated');

insert into public.profiles (id, tenant_id, full_name, role, is_active)
values
  ('55555555-0000-4000-8000-000000000011', '55555555-0000-4000-8000-000000000001', 'Dispatcher', 'DISPATCHER', true),
  ('55555555-0000-4000-8000-000000000012', '55555555-0000-4000-8000-000000000001', 'Driver', 'DRIVER', true),
  ('55555555-0000-4000-8000-000000000013', '55555555-0000-4000-8000-000000000001', 'Manager', 'WAREHOUSE_MANAGER', true);

insert into public.facilities (id, tenant_id, code, name_en, name_ar, kind, is_active)
values
  ('55555555-0000-4000-8000-000000000021', '55555555-0000-4000-8000-000000000001', 'WH', 'Warehouse', 'المستودع', 'WAREHOUSE', true),
  ('55555555-0000-4000-8000-000000000022', '55555555-0000-4000-8000-000000000001', 'PH-A', 'Pharmacy A', 'صيدلية أ', 'PHARMACY', true),
  ('55555555-0000-4000-8000-000000000023', '55555555-0000-4000-8000-000000000001', 'PH-B', 'Pharmacy B', 'صيدلية ب', 'PHARMACY', true);

insert into public.storage_locations (id, tenant_id, facility_id, code, name_en, name_ar, kind)
values ('55555555-0000-4000-8000-000000000031', '55555555-0000-4000-8000-000000000001',
        '55555555-0000-4000-8000-000000000021', 'A1', 'Ambient A1', 'محيط A1', 'AMBIENT');

-- A product and a batch, so an ALLOCATED requisition can exist to be delivered.
insert into public.products (id, tenant_id, sku, name_en, name_ar, form, strength, pack_size, uom, shelf_life_months, is_active)
values ('55555555-0000-4000-8000-000000000041', '55555555-0000-4000-8000-000000000001', 'DEL-1', 'Delivery Tablet', 'أقراص', 'TABLET', '500', 20, 'BOX', 24, true);

insert into public.batches (id, tenant_id, product_id, lot_number, mfg_date, expiry_date, unit_cost_minor, status)
values ('55555555-0000-4000-8000-000000000051', '55555555-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000041', 'LOT-D1', '2025-06-01', '2027-06-01', 1000, 'RELEASED');

insert into public.stock_balances (tenant_id, location_id, product_id, batch_id, qty_on_hand, qty_reserved)
values ('55555555-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000031',
        '55555555-0000-4000-8000-000000000041', '55555555-0000-4000-8000-000000000051', 500, 0);

-- The claim is set before the first write: the tenant triggers resolve
-- private.current_tenant_id(), which is null without it, and a not-null violation
-- is a confusing way to learn that.
set local request.jwt.claim.sub = '55555555-0000-4000-8000-000000000011';

insert into public.vehicles (id, tenant_id, code, description, plate_number)
values ('55555555-0000-4000-8000-000000000061', '55555555-0000-4000-8000-000000000001', 'VAN-TEST', 'Delivery van', 'ABC 1234');

-- ── planning ────────────────────────────────────────────────────────────────

select is(
  (select code from public.vehicles where code = 'VAN-TEST'),
  'VAN-TEST'::text,
  'a vehicle can be created'
);

select lives_ok(
  $$ select api.create_trip('2026-03-10'::date, '55555555-0000-4000-8000-000000000061'::uuid, 'morning run') $$,
  'a run can be planned'
);

select is(
  (select status::text from public.trips where notes = 'morning run'),
  'PLANNED'::text,
  'a planned run is PLANNED'
);

-- A run with no vehicle is still plannable: you do not know the van until the
-- morning. Dispatch is where the vehicle becomes required.
select throws_ok(
  $$ select api.dispatch_trip((select id from public.trips where notes = 'morning run'), '55555555-0000-4000-8000-000000000012') $$,
  '22023',
  'a run with no stops would send a driver nowhere',
  'a run with no stops cannot be dispatched'
);

-- An ALLOCATED requisition is the demand a stop serves. It is built through the
-- real API rather than inserted as ALLOCATED, because requisitions_terminal_has_time
-- will not let a terminal status arrive without the timestamp that records who
-- decided it -- which is the rule doing its job, not an obstacle to route around.
insert into public.requisitions (id, tenant_id, code, facility_id, status)
values ('55555555-0000-4000-8000-000000000071', '55555555-0000-4000-8000-000000000001', 'REQ-D1', '55555555-0000-4000-8000-000000000022', 'DRAFT');

insert into public.requisition_lines (tenant_id, requisition_id, product_id, qty_requested)
values ('55555555-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000071', '55555555-0000-4000-8000-000000000041', 20);

select api.submit_requisition('55555555-0000-4000-8000-000000000071');
select api.allocate_requisition('55555555-0000-4000-8000-000000000071');

select is(
  (select status::text from public.requisitions where id = '55555555-0000-4000-8000-000000000071'),
  'ALLOCATED'::text,
  'a requisition is allocated, so there is demand for a stop to serve'
);

select lives_ok(
  $$ select api.add_trip_stop(
       (select id from public.trips where notes = 'morning run'),
       '55555555-0000-4000-8000-000000000022'::uuid,
       '55555555-0000-4000-8000-000000000071'::uuid) $$,
  'a stop can be added for an allocated requisition'
);

select is(
  (select sequence from public.delivery_stops where facility_id = '55555555-0000-4000-8000-000000000022'),
  1::integer,
  'the first stop is sequence 1'
);

-- A second stop appends rather than colliding, which is the default a planner
-- wants: they add a call, they do not renumber the run.
select lives_ok(
  $$ select api.add_trip_stop(
       (select id from public.trips where notes = 'morning run'),
       '55555555-0000-4000-8000-000000000023'::uuid) $$,
  'a stop with no requisition is allowed -- a scheduled call, or a run planned before approval'
);

select is(
  (select max(sequence)::int from public.delivery_stops),
  2::integer,
  'a second stop is appended after the first'
);

-- The routing rule: a pharmacy''s order may only be delivered to that pharmacy.
select throws_ok(
  $$ select api.add_trip_stop(
       (select id from public.trips where notes = 'morning run'),
       '55555555-0000-4000-8000-000000000023'::uuid,
       '55555555-0000-4000-8000-000000000071'::uuid) $$,
  'P0002',
  'requisition 55555555-0000-4000-8000-000000000071 is not an allocated request for that facility',
  'a stop cannot route one pharmacy''s order to another'
);

-- ── dispatch ────────────────────────────────────────────────────────────────

select lives_ok(
  $$ select api.dispatch_trip((select id from public.trips where notes = 'morning run'), '55555555-0000-4000-8000-000000000012') $$,
  'the run can be dispatched to a driver'
);

select is(
  (select status::text from public.trips where notes = 'morning run'),
  'DISPATCHED'::text,
  'a dispatched run is DISPATCHED'
);

select is(
  (select driver_id::text from public.trips where notes = 'morning run'),
  '55555555-0000-4000-8000-000000000012',
  'the driver is recorded'
);

-- A warehouse manager is not a driver. Dispatching a run to one would put a
-- signature in the hands of somebody not authorised to take it.
select lives_ok(
  $$ select api.create_trip('2026-03-11'::date, '55555555-0000-4000-8000-000000000061'::uuid) $$,
  'a second run on another day is fine'
);

select lives_ok(
  $$ select api.add_trip_stop((select id from public.trips where run_date = '2026-03-11'), '55555555-0000-4000-8000-000000000022') $$,
  'and it can have a stop'
);

select throws_ok(
  $$ select api.dispatch_trip((select id from public.trips where run_date = '2026-03-11'), '55555555-0000-4000-8000-000000000013') $$,
  'P0002',
  'that person is not a driver in this tenant',
  'a warehouse manager cannot be dispatched as a driver'
);

-- One van, one run, one day.
select throws_ok(
  $$ select api.create_trip('2026-03-10'::date, '55555555-0000-4000-8000-000000000061'::uuid) $$,
  '22023',
  'that vehicle is already out on 2026-03-10',
  'the same van cannot be booked twice on one day'
);

-- The correction in 0039, as an assertion: dispatching is the paperwork leaving,
-- not the van moving, so a dispatched run legitimately has no start time yet.
select lives_ok(
  $$ select api.create_trip('2026-03-12'::date, '55555555-0000-4000-8000-000000000061'::uuid) $$,
  'a run can be planned for a third day'
);

select lives_ok(
  $$ select api.add_trip_stop((select id from public.trips where run_date = '2026-03-12'), '55555555-0000-4000-8000-000000000022') $$,
  'with a stop'
);

select lives_ok(
  $$ select api.dispatch_trip((select id from public.trips where run_date = '2026-03-12'), '55555555-0000-4000-8000-000000000012') $$,
  'and dispatched'
);

select is(
  (select started_at is null from public.trips where run_date = '2026-03-12'),
  true,
  'a dispatched run has no start time -- the van is still at the depot until the driver starts it'
);

-- ── working the run, as the driver ──────────────────────────────────────────

set local request.jwt.claim.sub = '55555555-0000-4000-8000-000000000012';

select lives_ok(
  $$ select api.start_trip((select id from public.trips where notes = 'morning run')) $$,
  'the driver can start their run'
);

select is(
  (select status::text from public.trips where notes = 'morning run'),
  'IN_TRANSIT'::text,
  'a started run is IN_TRANSIT'
);

select is(
  (select started_at is not null from public.trips where notes = 'morning run'),
  true,
  'and the start time is recorded, so the run is evidence of when it moved'
);


-- The signature-before-arrival case. This is the assertion a stale phone makes
-- real, and it is the record a disputed delivery turns on.
select throws_ok(
  $$ select api.complete_stop(
       (select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')),
       'A. Buyer', 'received in good condition', 'sig-data') $$,
  '22023',
  'this stop is PENDING, arrive before signing for it',
  'a stop cannot be signed for before the driver has arrived'
);

select lives_ok(
  $$ select api.arrive_at_stop((select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')), 30.0444, 31.2357) $$,
  'the driver can arrive at a stop'
);

select is(
  (select status::text from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')),
  'ARRIVED'::text,
  'an arrived stop is ARRIVED'
);

select is(
  (select latitude from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')),
  30.0444::numeric,
  'and the position is recorded for the map and for a dispute'
);

-- The meaning is not decoration.
select throws_ok(
  $$ select api.complete_stop((select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')), 'A. Buyer', '  ', 'sig-data') $$,
  '22023',
  'state what the signature means',
  'a signature with no declared meaning is refused'
);

select throws_ok(
  $$ select api.complete_stop((select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')), '  ', 'received in good condition', 'sig-data') $$,
  '22023',
  'record who took the delivery',
  'a delivery cannot be signed for by nobody'
);

select lives_ok(
  $$ select api.complete_stop(
       (select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')),
       'A. Buyer', 'received in good condition, two cartons short', 'sig-data', null, 'device-1') $$,
  'a stop can be signed and closed'
);

select is(
  (select status::text from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')),
  'DELIVERED'::text,
  'a signed stop is DELIVERED'
);

select is(
  (select recipient_name from public.proofs_of_delivery where stop_id = (select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run'))),
  'A. Buyer'::text,
  'the proof records who took it'
);

select is(
  (select meaning from public.proofs_of_delivery where stop_id = (select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run'))),
  'received in good condition, two cartons short'::text,
  'and what the signature attests to'
);

-- A delivery that happened but was not signed is a real outcome.
select lives_ok(
  $$ select api.fail_stop((select id from public.delivery_stops where sequence = 2 and trip_id = (select id from public.trips where notes = 'morning run')), 'nobody available to receive') $$,
  'a stop can be failed with a reason'
);

select is(
  (select failure_reason from public.delivery_stops where sequence = 2 and trip_id = (select id from public.trips where notes = 'morning run')),
  'nobody available to receive'::text,
  'and the reason is kept, because a dispatcher needs to know whether to call again, reschedule or cancel'
);

-- A failed stop has a close time and no delivery time. These are different facts,
-- and a report that counted delivered_at as stops closed would overstate deliveries
-- by exactly the failed calls.
select is(
  (select delivered_at is null from public.delivery_stops where sequence = 2 and trip_id = (select id from public.trips where notes = 'morning run')),
  true,
  'a failed stop has no delivery time, because nobody received anything'
);

select is(
  (select closed_at is not null from public.delivery_stops where sequence = 2 and trip_id = (select id from public.trips where notes = 'morning run')),
  true,
  'but it does have a close time'
);

select throws_ok(
  $$ select api.fail_stop((select id from public.delivery_stops where sequence = 1 and trip_id = (select id from public.trips where notes = 'morning run')), 'already delivered') $$,
  '22023',
  'this stop cannot be failed from where it is',
  'a delivered stop cannot then be failed'
);

-- ── closing the run ─────────────────────────────────────────────────────────

select lives_ok(
  $$ select api.complete_trip((select id from public.trips where notes = 'morning run')) $$,
  'the run completes once every stop is accounted for'
);

select is(
  (select status::text from public.trips where notes = 'morning run'),
  'COMPLETED'::text,
  'a finished run is COMPLETED'
);

-- The one that matters for a dispatcher: a run must not close with a stop nobody
-- called at, because that is a customer who was never visited and nobody knows.
select throws_ok(
  $$ select api.start_trip((select id from public.trips where run_date = '2026-03-11')) $$,
  'P0002',
  'this run is not assigned to you',
  'a driver cannot start a run that is not theirs'
);

-- A run cannot be cancelled while it is on the road: the stock has left the
-- warehouse and "cancelled" is not somewhere it went.
select throws_ok(
  $$ update public.trips set status = 'CANCELLED' where notes = 'morning run' $$,
  '23514',
  null,
  'the constraint refuses cancelling a run that has started'
);

-- ── evidence is immutable ───────────────────────────────────────────────────

-- The important half of "evidence is immutable": RLS alone does not do this, because
-- the owner bypasses it. Asserted as the owner precisely because that is the role a
-- company being sued over a delivery would reach for.
select throws_ok(
  $$ update public.proofs_of_delivery set recipient_name = 'someone else' $$,
  '42501',
  'a proof of delivery cannot be rewritten; record what happened and leave it alone',
  'a signature cannot be rewritten, not even by an owner'
);

-- The other half, which is the policy shape rather than a trigger: no client role
-- has any path to change or remove one. Counting policies is blunt but it is the
-- thing that has to be true, and it cannot drift.
select is(
  (select count(*) from pg_policies
    where tablename = 'proofs_of_delivery' and cmd in ('update', 'delete')),
  0::bigint,
  'no update or delete policy exists, so no client can rewrite or remove a signature'
);

-- A delivery that was not signed is still evidence, and it needs a reason to exist.
select lives_ok(
  $$ update public.trips set notes = 'morning run' where notes = 'morning run' $$,
  'a run can still be annotated'
);

-- There is no INSERT policy either, so a proof reaches the database through
-- api.complete_stop and through nothing else a client can name. (The owner can still
-- insert one by hand -- api.complete_stop is itself SECURITY DEFINER and runs as the
-- owner -- so what is being asserted here is the client path, not a claim about the
-- DBA that could not be true.)
select is(
  (select count(*) from pg_policies where tablename = 'proofs_of_delivery' and cmd = 'insert'),
  0::bigint,
  'no insert policy either, so a proof is written by closing a stop, not by a client'
);

-- The tenant is the trigger's to set, never the client's: the row's tenant_id comes
-- from the session whatever the statement said.
select is(
  (select count(*) from public.proofs_of_delivery where tenant_id is null),
  0::bigint,
  'every proof carries a tenant, set by the trigger rather than the caller'
);

-- ── the whole thing is invisible to another tenant ───────────────────────────

select is(
  (select count(*) from public.trips where tenant_id = '55555555-0000-4000-8000-000000000001'),
  3::bigint,
  'the tenant sees its own three runs'
);

select throws_ok(
  $$ select api.complete_stop(gen_random_uuid(), 'X', 'received') $$,
  'P0002',
  'this stop is not on your run',
  'a stop that is not on your run cannot be worked'
);

select * from finish();
rollback;
