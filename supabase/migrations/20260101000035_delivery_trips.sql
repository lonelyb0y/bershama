-- Trips, stops, and proof of delivery.
--
-- ── why a trip is a first-class object ──────────────────────────────────────
--
-- M3 allocates stock against a requisition. That answers "is there enough, and
-- from which batches". It does not answer the question the rest of the system is
-- for: a distributor's problem is not moving units from a shelf to a van, it is
-- getting them to the right pharmacy at a time somebody is awake to receive them.
--
-- So a trip groups stops for one run by one driver, and a stop is one facility on
-- that run. A requisition is the demand; a stop is the delivery. They are kept
-- separate because a pharmacy may receive part of a request, and one stop may
-- serve more than one request over a day.
--
-- ── why status is on the stop and not only the trip ─────────────────────────
--
-- Because a run does not fail as a unit. A driver whose third of four stops is
-- closed finds the pharmacy does not have a buyer available: that stop is FAILED
-- with a reason, the other three are delivered, and the trip completes. A single
-- trip-level status would have to be either "delivered", which is a lie, or
-- "failed", which discards three completed deliveries and their signatures.
--
-- FAILED carries a reason because "failed" without one is not actionable. A
-- dispatcher retrying a run needs to know whether to call again, reschedule, or
-- cancel, and those are three different decisions.
--
-- ── proof of delivery is evidence, so it is immutable ────────────────────────
--
-- The signature is stored inline with the delivery record rather than in Storage
-- with a reference, so it cannot be orphaned from the thing it evidences. There
-- is no update path and no delete path on proofs_of_delivery, and the RLS below
-- has no UPDATE or DELETE policy -- so the database refuses to rewrite evidence
-- even for an administrator.
--
-- `meaning` is not decoration. A signature with no stated meaning does not say
-- what was agreed: "received in good condition" and "received, one carton
-- short" are both a signature. Requiring the declarer to choose is the practice
-- that makes the signature worth anything, and it is why the column is not
-- nullable.

create type private.trip_status as enum (
  'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'
);

create type private.stop_status as enum (
  'PENDING', 'ARRIVED', 'DELIVERED', 'FAILED', 'RETURNED', 'SKIPPED'
);

comment on type private.trip_status is
  'A run fails as a unit; a stop does not. A closed stop with nobody available is FAILED with a reason while the rest of the run completes, because a single trip-level status would be either "delivered" (a lie) or "failed" (three deliveries discarded).';
comment on type private.stop_status is
  'Per-stop lifecycle. FAILED always carries failure_reason: a dispatcher deciding whether to call again, reschedule or cancel needs three different answers.';

-- ── vehicles ────────────────────────────────────────────────────────────────
--
-- A vehicle rather than free text on the trip, because the registration is what
-- identifies a van on a road and a receipt. It carries no engine, no insurance
-- and no MOT: that is a fleet system, and this is a distribution record.

create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  code            text not null,
  description     text,
  plate_number    text,
  -- Set false when the van is off the road. A trip may only be assigned a vehicle
  -- that is active, enforced in api.dispatch_trip rather than by a trigger, so
  -- the refusal has a message a dispatcher can act on.
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint vehicles_tenant_code_key unique (tenant_id, code)
);

comment on table public.vehicles is
  'A van, identified by the registration on the paperwork. Deliberately minimal: no engine, insurance or MOT state -- that is a fleet system, not a distribution record.';

-- ── trips ───────────────────────────────────────────────────────────────────

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  vehicle_id    uuid references public.vehicles (id),
  -- A profile with a driver or distributor role. Not a foreign key to a
  -- "drivers" table, because a driver is a person with a role here, not a
  -- separate kind of user; adding a drivers table would mean two places to
  -- deactivate somebody.
  driver_id     uuid references public.profiles (id),
  run_date      date not null,
  status        private.trip_status not null default 'PLANNED',
  notes         text,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One van, one run, one day. Two trips on the same vehicle and date is either a
  -- data-entry slip or two dispatchers working without seeing each other, and in
  -- both cases the second run has no idea the first has the vehicle.
  constraint trips_vehicle_day_key unique (tenant_id, vehicle_id, run_date),
  -- A run past PLANNED has left the depot, so it has a start time. Without this a
  -- status can be written without the timestamp that makes it evidence, and an
  -- IN_TRANSIT run with no start time tells a dispute nothing.
  constraint trips_started_has_time
    check (status = 'PLANNED' or started_at is not null),
  -- Finishing has a finish time, and a finish time implies a start.
  constraint trips_ended_has_time
    check (status <> 'COMPLETED' or (ended_at is not null and started_at is not null)),
  -- You cannot call a run cancelled while it is on the road. The stock has left the
  -- warehouse and has to be accounted for somewhere, and "cancelled" is not
  -- somewhere. Recalling a DISPATCHED van is allowed -- a dispatcher genuinely can
  -- do that -- so this pins only the contradiction.
  constraint trips_cancelled_not_in_transit
    check (not (status = 'CANCELLED' and started_at is not null))
);

comment on table public.trips is
  'One driver''s run for one day. Cancelling an IN_TRANSIT run is refused: the stock has left the warehouse and has to be accounted for somewhere, and a cancelled run is not somewhere.';

-- ── stops ───────────────────────────────────────────────────────────────────

create table public.delivery_stops (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  trip_id         uuid not null references public.trips (id) on delete cascade,
  -- Nullable: a stop may be a scheduled call with nothing allocated to it yet.
  -- Requiring a requisition would make it impossible to plan a run before stock
  -- is approved, which is the order things actually happen in.
  requisition_id  uuid references public.requisitions (id),
  facility_id     uuid not null references public.facilities (id),
  sequence        integer not null check (sequence > 0),
  status          private.stop_status not null default 'PENDING',
  eta             timestamptz,
  arrived_at      timestamptz,
  delivered_at    timestamptz,
  failure_reason  text,
  -- Where the driver was when the stop was closed. Evidence for a disputed
  -- delivery, and the only input to the live map.
  latitude        numeric(9, 6) check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude       numeric(9, 6) check (longitude is null or (longitude >= -180 and longitude <= 180)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One stop per facility per trip. A driver does not visit the same pharmacy
  -- twice in a run; if it needs a second visit, that is a second trip, and the two
  -- have separate signatures.
  constraint delivery_stops_leg unique (tenant_id, trip_id, facility_id),
  -- Failure is meaningless without a reason, and a reason on a stop that was not
  -- failed is noise. Both directions, so neither can be faked.
  constraint delivery_stops_failure_check
    check ((status = 'FAILED') = (failure_reason is not null and btrim(failure_reason) <> '')),
  -- A closed stop has a close time. A PENDING stop must not have one: an arrival
  -- time on a stop nobody arrived at is the kind of thing that quietly becomes
  -- evidence of a delivery that did not happen.
  constraint delivery_stops_arrived_check
    check (arrived_at is null or status <> 'PENDING'),
  constraint delivery_stops_delivered_check
    check (delivered_at is null or status in ('DELIVERED', 'RETURNED'))
);

comment on table public.delivery_stops is
  'One facility on one run. Failure_reason is required exactly when the stop failed, which is enforced as a check in both directions so neither half can be faked.';

-- ── proof of delivery ───────────────────────────────────────────────────────

create table public.proofs_of_delivery (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  stop_id         uuid not null references public.delivery_stops (id) on delete cascade,
  -- Who took the delivery. Not the profile: the point of a signature is that it is
  -- somebody other than the driver.
  recipient_name  text not null,
  -- Inline rather than a Storage reference, so the signature cannot be orphaned
  -- from the delivery it evidences. Small and immutable, which is why that is
  -- acceptable.
  signature_data  text,
  photo_url       text,
  signed_at       timestamptz not null default now(),
  device_id       text,
  -- What the signature attests to. NOT NULL and not decoration: a signature with
  -- no declared meaning does not say what was agreed, and "received in good
  -- condition" and "received, one carton short" are both a signature.
  meaning         text not null,
  -- Set by the driver when a stop is closed without a signature, with a reason.
  -- A delivery that happened but was not signed is a real outcome; pretending it
  -- is not would mean either losing the delivery or inventing a signature.
  unsigned_reason text,

  constraint proofs_signed_or_explained
    check (signature_data is not null or (unsigned_reason is not null and btrim(unsigned_reason) <> '')),
  constraint proofs_recipient_required check (btrim(recipient_name) <> '')
);

comment on table public.proofs_of_delivery is
  'Evidence. No update path, no delete path, and no UPDATE or DELETE policy -- the database refuses to rewrite a signature even for an administrator. `meaning` is required: a signature with no declared meaning attests to nothing specific.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
alter table public.delivery_stops enable row level security;
alter table public.proofs_of_delivery enable row level security;

-- Read: everyone in the tenant sees the network. A pharmacy manager needs to see
-- when their delivery is coming; a driver needs to see their own run.
create policy "read tenant vehicles" on public.vehicles for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "read tenant trips" on public.trips for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "read tenant stops" on public.delivery_stops for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- Proof of delivery is read-only for everyone. A driver records it once; nobody
-- edits or removes it. The absence of INSERT/UPDATE/DELETE here is the point.
create policy "read tenant proofs" on public.proofs_of_delivery for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- ── the tenant is never the client's to choose ──────────────────────────────

create or replace function private.set_m4_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.tenant_id := (select private.current_tenant_id());
  return new;
end
$$;

create trigger vehicles_set_tenant
  before insert on public.vehicles
  for each row execute function private.set_m4_tenant();

create trigger trips_set_tenant
  before insert on public.trips
  for each row execute function private.set_m4_tenant();

create trigger delivery_stops_set_tenant
  before insert on public.delivery_stops
  for each row execute function private.set_m4_tenant();

create trigger proofs_set_tenant
  before insert on public.proofs_of_delivery
  for each row execute function private.set_m4_tenant();

create or replace function private.touch_m4_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger vehicles_touch before update on public.vehicles
  for each row execute function private.touch_m4_updated_at();
create trigger trips_touch before update on public.trips
  for each row execute function private.touch_m4_updated_at();
create trigger delivery_stops_touch before update on public.delivery_stops
  for each row execute function private.touch_m4_updated_at();
