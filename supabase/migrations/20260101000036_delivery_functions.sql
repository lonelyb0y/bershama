-- The delivery lifecycle: plan a run, dispatch it, work the stops, sign for it.
--
-- ── why these are functions and not direct writes ───────────────────────────
--
-- The same reason as the catalogue and requisition writes: a client cannot write
-- these tables directly, because the tenant policies call `private.*` and a
-- client role has no USAGE on that schema.
--
-- But there is a second reason specific to this milestone, which is the more
-- interesting one. A delivery is a chain of state transitions that each have to
-- hold given the ones before: you cannot arrive at a stop that is not PENDING,
-- you cannot sign for a stop that is not ARRIVED, you cannot dispatch a run with
-- no vehicle. Spread across four separate writes from a client, those rules live
-- in application code, and application code is the wrong place for rules about
-- physical reality. A driver with a stale phone must not be able to sign for a
-- stop nobody arrived at.
--
-- So each function is the transaction that enforces one step, and it refuses with
-- a message a driver can act on.
--
-- ── no private type appears in any parameter list ────────────────────────────
--
-- A `private.*` type in an api function's INPUT parameters makes the function
-- uncallable from the browser, because PostgREST resolves the parameter's type
-- name when a value is passed and that needs USAGE on `private`. rls_coverage
-- asserts the property now, after it bit three functions earlier. Every enum
-- parameter below is therefore `text`, cast inside where the cast runs as the
-- owner -- and the cast still rejects a value that is not a member, so the
-- database continues to validate.

-- ── planning ────────────────────────────────────────────────────────────────

create or replace function api.create_vehicle(p_code text, p_description text default null, p_plate_number text default null)
returns public.vehicles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.vehicles;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if btrim(coalesce(p_code, '')) = '' then
    raise exception 'a vehicle needs a code' using errcode = '22023';
  end if;

  insert into public.vehicles (tenant_id, code, description, plate_number)
  values (v_tenant, btrim(p_code),
          nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_plate_number, '')), ''))
  returning * into v_row;

  return v_row;
end
$$;

create or replace function api.create_trip(p_run_date date, p_vehicle_id uuid default null, p_notes text default null)
returns public.trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.trips;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'DISPATCHER')) then
    raise exception 'your role cannot plan a run' using errcode = '42501';
  end if;

  if p_run_date is null then
    raise exception 'a run needs a date' using errcode = '22023';
  end if;

  -- Checked here with a message rather than by the unique index alone, because a
  -- duplicate-key error does not say which vehicle is already out.
  if p_vehicle_id is not null and exists (
    select 1 from public.trips t
    where t.tenant_id = v_tenant and t.vehicle_id = p_vehicle_id and t.run_date = p_run_date
      and t.status <> 'CANCELLED'
  ) then
    raise exception 'that vehicle is already out on %', p_run_date using errcode = '22023';
  end if;

  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id and v.tenant_id = v_tenant and v.is_active
  ) then
    raise exception 'no active vehicle % in this tenant', p_vehicle_id using errcode = 'P0002';
  end if;

  insert into public.trips (tenant_id, vehicle_id, run_date, status, notes)
  values (v_tenant, p_vehicle_id, p_run_date, 'PLANNED',
          nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_row;

  return v_row;
end
$$;

-- The stop, and the requisition it serves, are one call.
--
-- An ALLOCATED requisition is the demand, so adding a stop for one is the normal
-- case. A stop with no requisition is allowed and is genuinely useful: a scheduled
-- call to take a return, or a run planned before stock is approved. That is the
-- order things actually happen in, and requiring a requisition would make it
-- impossible to plan ahead of approval.
create or replace function api.add_trip_stop(p_trip_id uuid, p_facility_id uuid, p_requisition_id uuid default null, p_sequence integer default null)
returns public.delivery_stops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_trip   public.trips;
  v_next   integer;
  v_row    public.delivery_stops;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'DISPATCHER')) then
    raise exception 'your role cannot plan stops' using errcode = '42501';
  end if;

  select * into v_trip from public.trips t
  where t.id = p_trip_id and t.tenant_id = v_tenant;

  if not found then
    raise exception 'no trip % in this tenant', p_trip_id using errcode = 'P0002';
  end if;

  -- Stops are added to a plan, not to a run on the road. A dispatcher who needs a
  -- different order should cancel and re-plan, because the driver's phone holds
  -- the stop list it was given.
  if v_trip.status <> 'PLANNED' then
    raise exception 'this run is %, stops are only added while it is PLANNED', v_trip.status
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.facilities f
    where f.id = p_facility_id and f.tenant_id = v_tenant and f.is_active
  ) then
    raise exception 'no active facility % in this tenant', p_facility_id using errcode = 'P0002';
  end if;

  -- A requisition may only be served by its own facility's run. Without this, a
  -- dispatcher could route a pharmacy's order to a stop at a different pharmacy and
  -- the delivery would be recorded against the wrong site.
  if p_requisition_id is not null then
    if not exists (
      select 1 from public.requisitions r
      where r.id = p_requisition_id and r.tenant_id = v_tenant and r.status = 'ALLOCATED'
        and r.facility_id = p_facility_id
    ) then
      raise exception 'requisition % is not an allocated request for that facility', p_requisition_id
        using errcode = 'P0002';
    end if;
  end if;

  if p_sequence is null then
    -- Appended, so the default is "after everything already planned" rather than
    -- a number somebody has to keep in their head.
    select coalesce(max(sequence), 0) + 1 into v_next
    from public.delivery_stops s where s.trip_id = p_trip_id;
  else
    v_next := p_sequence;
  end if;

  insert into public.delivery_stops (tenant_id, trip_id, requisition_id, facility_id, sequence, status)
  values (v_tenant, p_trip_id, p_requisition_id, p_facility_id, v_next, 'PENDING')
  returning * into v_row;

  return v_row;
end
$$;

-- ── dispatch ────────────────────────────────────────────────────────────────

create or replace function api.dispatch_trip(p_trip_id uuid, p_driver_id uuid)
returns public.trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.trips;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'DISPATCHER')) then
    raise exception 'your role cannot dispatch a run' using errcode = '42501';
  end if;

  select * into v_row from public.trips t
  where t.id = p_trip_id and t.tenant_id = v_tenant for update;

  if not found then
    raise exception 'no trip % in this tenant', p_trip_id using errcode = 'P0002';
  end if;

  if v_row.status <> 'PLANNED' then
    raise exception 'this run is already %', v_row.status using errcode = '22023';
  end if;

  if v_row.vehicle_id is null then
    raise exception 'assign a vehicle before dispatching' using errcode = '22023';
  end if;

  if not exists (select 1 from public.delivery_stops s where s.trip_id = p_trip_id) then
    raise exception 'a run with no stops would send a driver nowhere' using errcode = '22023';
  end if;

  -- The driver has to be somebody who can drive: a warehouse manager on a run is
  -- not a driver, and the trip view would then show them a signature they are not
  -- authorised to take.
  if not exists (
    select 1 from public.profiles p
    where p.id = p_driver_id and p.tenant_id = v_tenant and p.is_active
      and p.role in ('DRIVER', 'DISPATCHER')
  ) then
    raise exception 'that person is not a driver in this tenant' using errcode = 'P0002';
  end if;

  update public.trips t
  set driver_id = p_driver_id, status = 'DISPATCHED', updated_at = now()
  where t.id = p_trip_id
  returning * into v_row;

  return v_row;
end
$$;

create or replace function api.start_trip(p_trip_id uuid)
returns public.trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.trips;
begin
  -- The driver starts their own run. Not a role check: identity is the point, and
  -- "is this my run" is the question a phone with a stale session can ask wrongly.
  if not exists (select 1 from public.trips t
                 where t.id = p_trip_id and t.tenant_id = v_tenant
                   and t.driver_id = (select auth.uid())) then
    raise exception 'this run is not assigned to you' using errcode = 'P0002';
  end if;

  select * into v_row from public.trips t where t.id = p_trip_id for update;

  if v_row.status <> 'DISPATCHED' then
    raise exception 'this run is %, only a dispatched one can be started', v_row.status
      using errcode = '22023';
  end if;

  update public.trips t
  set status = 'IN_TRANSIT', started_at = now(), updated_at = now()
  where t.id = p_trip_id
  returning * into v_row;

  return v_row;
end
$$;

-- ── working a stop ──────────────────────────────────────────────────────────
--
-- Arrive, then sign. Two steps, because they happen at different moments and are
-- different facts: the van is at the pharmacy, and somebody accepted the goods.
-- One call that did both would record a delivery at a moment the driver had not
-- yet handed anything over.

create or replace function api.arrive_at_stop(p_stop_id uuid, p_latitude numeric default null, p_longitude numeric default null)
returns public.delivery_stops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.delivery_stops;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  -- May only be worked by the driver this run is assigned to.
  if not exists (
    select 1 from public.delivery_stops s
    join public.trips t on t.id = s.trip_id
    where s.id = p_stop_id and s.tenant_id = v_tenant and t.driver_id = (select auth.uid())
  ) then
    raise exception 'this stop is not on your run' using errcode = 'P0002';
  end if;

  select * into v_row from public.delivery_stops s where s.id = p_stop_id for update;

  if v_row.status <> 'PENDING' then
    raise exception 'this stop is already %', v_row.status using errcode = '22023';
  end if;

  update public.delivery_stops s
  set status = 'ARRIVED',
      arrived_at = now(),
      latitude = coalesce(p_latitude, s.latitude),
      longitude = coalesce(p_longitude, s.longitude),
      updated_at = now()
  where s.id = p_stop_id
  returning * into v_row;

  return v_row;
end
$$;

-- Proof of delivery is written here, in the same transaction that closes the
-- stop. A signature and a delivery recorded separately could disagree -- a signed
-- delivery nobody closed, or a closed delivery with no evidence -- and the second
-- of those is the case that matters in a dispute.
create or replace function api.complete_stop(
  p_stop_id uuid,
  p_recipient_name text,
  p_meaning text,
  p_signature_data text default null,
  p_photo_url text default null,
  p_device_id text default null,
  p_unsigned_reason text default null,
  p_latitude numeric default null,
  p_longitude numeric default null
)
returns public.delivery_stops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_stop    public.delivery_stops;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.delivery_stops s
    join public.trips t on t.id = s.trip_id
    where s.id = p_stop_id and s.tenant_id = v_tenant and t.driver_id = (select auth.uid())
  ) then
    raise exception 'this stop is not on your run' using errcode = 'P0002';
  end if;

  select * into v_stop from public.delivery_stops s where s.id = p_stop_id for update;

  if v_stop.status <> 'ARRIVED' then
    -- Arrive first. A signature on a stop nobody arrived at is the exact record
    -- that a disputed delivery turns on.
    raise exception 'this stop is %, arrive before signing for it', v_stop.status
      using errcode = '22023';
  end if;

  if btrim(coalesce(p_recipient_name, '')) = '' then
    raise exception 'record who took the delivery' using errcode = '22023';
  end if;

  if btrim(coalesce(p_meaning, '')) = '' then
    -- A signature with no declared meaning attests to nothing specific.
    raise exception 'state what the signature means' using errcode = '22023';
  end if;

  -- A delivery that happened but was not signed is a real outcome. Requiring a
  -- signature would mean either losing the delivery or inventing one, and the
  -- unsigned_reason is what makes it accountable.
  if p_signature_data is null and btrim(coalesce(p_unsigned_reason, '')) = '' then
    raise exception 'sign, or say why the delivery was not signed' using errcode = '22023';
  end if;

  insert into public.proofs_of_delivery (
    tenant_id, stop_id, recipient_name, signature_data, photo_url, signed_at, device_id, meaning, unsigned_reason
  )
  values (
    v_tenant, p_stop_id, btrim(p_recipient_name),
    p_signature_data, nullif(btrim(coalesce(p_photo_url, '')), ''),
    now(), nullif(btrim(coalesce(p_device_id, '')), ''),
    btrim(p_meaning), nullif(btrim(coalesce(p_unsigned_reason, '')), '')
  );

  update public.delivery_stops s
  set status = 'DELIVERED',
      delivered_at = now(),
      latitude = coalesce(p_latitude, s.latitude),
      longitude = coalesce(p_longitude, s.longitude),
      updated_at = now()
  where s.id = p_stop_id
  returning * into v_stop;

  return v_stop;
end
$$;

create or replace function api.fail_stop(p_stop_id uuid, p_reason text)
returns public.delivery_stops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.delivery_stops;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    -- A dispatcher deciding whether to call again, reschedule or cancel needs
    -- three different answers, and "failed" without a reason is none of them.
    raise exception 'a failed stop needs a reason' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.delivery_stops s
    join public.trips t on t.id = s.trip_id
    where s.id = p_stop_id and s.tenant_id = v_tenant and t.driver_id = (select auth.uid())
  ) then
    raise exception 'this stop is not on your run' using errcode = 'P0002';
  end if;

  update public.delivery_stops s
  set status = 'FAILED',
      failure_reason = btrim(p_reason),
      delivered_at = now(),
      updated_at = now()
  where s.id = p_stop_id and s.status in ('PENDING', 'ARRIVED')
  returning * into v_row;

  if not found then
    raise exception 'this stop cannot be failed from where it is' using errcode = '22023';
  end if;

  return v_row;
end
$$;

-- Closing the run. Every stop has to be accounted for first, because a run that
-- completes with an unvisited stop is a customer who was never called and nobody
-- knows it.
create or replace function api.complete_trip(p_trip_id uuid)
returns public.trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.trips;
  v_open   integer;
begin
  if not exists (select 1 from public.trips t
                 where t.id = p_trip_id and t.tenant_id = v_tenant
                   and t.driver_id = (select auth.uid())) then
    raise exception 'this run is not assigned to you' using errcode = 'P0002';
  end if;

  select * into v_row from public.trips t where t.id = p_trip_id for update;

  if v_row.status <> 'IN_TRANSIT' then
    raise exception 'this run is %, only one on the road can be completed', v_row.status
      using errcode = '22023';
  end if;

  select count(*) into v_open from public.delivery_stops s
  where s.trip_id = p_trip_id and s.status in ('PENDING', 'ARRIVED');

  if v_open > 0 then
    -- Named in the message, because "3 stops outstanding" is the difference
    -- between a driver who forgot and a dispatcher who can chase.
    raise exception '% stops on this run have not been delivered or failed', v_open
      using errcode = '22023';
  end if;

  update public.trips t
  set status = 'COMPLETED', ended_at = now(), updated_at = now()
  where t.id = p_trip_id
  returning * into v_row;

  return v_row;
end
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- revoke from PUBLIC as well as anon: postgres grants EXECUTE to PUBLIC on every
-- function it creates, and revoking from one named role leaves the other open.

grant execute on function api.create_vehicle(text, text, text) to authenticated, service_role;
grant execute on function api.create_trip(date, uuid, text) to authenticated, service_role;
grant execute on function api.add_trip_stop(uuid, uuid, uuid, integer) to authenticated, service_role;
grant execute on function api.dispatch_trip(uuid, uuid) to authenticated, service_role;
grant execute on function api.start_trip(uuid) to authenticated, service_role;
grant execute on function api.arrive_at_stop(uuid, numeric, numeric) to authenticated, service_role;
grant execute on function api.complete_stop(uuid, text, text, text, text, text, text, numeric, numeric) to authenticated, service_role;
grant execute on function api.fail_stop(uuid, text) to authenticated, service_role;
grant execute on function api.complete_trip(uuid) to authenticated, service_role;

revoke execute on function api.create_vehicle(text, text, text) from public;
revoke execute on function api.create_vehicle(text, text, text) from anon;
revoke execute on function api.create_trip(date, uuid, text) from public;
revoke execute on function api.create_trip(date, uuid, text) from anon;
revoke execute on function api.add_trip_stop(uuid, uuid, uuid, integer) from public;
revoke execute on function api.add_trip_stop(uuid, uuid, uuid, integer) from anon;
revoke execute on function api.dispatch_trip(uuid, uuid) from public;
revoke execute on function api.dispatch_trip(uuid, uuid) from anon;
revoke execute on function api.start_trip(uuid) from public;
revoke execute on function api.start_trip(uuid) from anon;
revoke execute on function api.arrive_at_stop(uuid, numeric, numeric) from public;
revoke execute on function api.arrive_at_stop(uuid, numeric, numeric) from anon;
revoke execute on function api.complete_stop(uuid, text, text, text, text, text, text, numeric, numeric) from public;
revoke execute on function api.complete_stop(uuid, text, text, text, text, text, text, numeric, numeric) from anon;
revoke execute on function api.fail_stop(uuid, text) from public;
revoke execute on function api.fail_stop(uuid, text) from anon;
revoke execute on function api.complete_trip(uuid) from public;
revoke execute on function api.complete_trip(uuid) from anon;

comment on function api.complete_stop(uuid, text, text, text, text, text, text, numeric, numeric) is
  'Sign for a stop and close it, in one transaction. Two writes could disagree -- a signed delivery nobody closed, or a closed delivery with no evidence -- and the second is what a dispute turns on. A signature is not required: a real delivery that was not signed is recorded with a reason rather than lost or invented.';
comment on function api.fail_stop(uuid, text) is
  'Fail a stop with a mandatory reason. A dispatcher deciding between calling again, rescheduling and cancelling needs three different answers and "failed" alone is none of them.';
comment on function api.complete_trip(uuid) is
  'Close a run. Refused while any stop is PENDING or ARRIVED, and says how many: a run that completes with an unvisited stop is a customer nobody called and nobody knows it.';
