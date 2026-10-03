-- Live vehicle position.
--
-- ── the gap this closes ─────────────────────────────────────────────────────────
--
-- delivery_stops.latitude and .longitude are written by api.arrive_at_stop(), which means
-- a position exists only for a stop somebody has *already reached*. Between the warehouse
-- and the first pharmacy, and between every pair of stops after that, the system has no
-- idea where the vehicle is. A dispatcher watching a run has a list of stops and no way to
-- answer "is it stuck on the ring road or three minutes away" -- which is the only
-- question a dispatcher opens the screen to ask.
--
-- So this is the missing table rather than a missing column. A column on `trips` would
-- hold one point, and one point is a snapshot rather than a live position: it says where
-- the van was when it last reported, with no way to tell a van parked at a pharmacy from a
-- van stationary at a traffic light.
--
-- ── one row per trip, not a breadcrumb trail ────────────────────────────────────
--
-- Deliberately a current-position table, not a history. A dispatcher needs "where is it
-- now", and a trail is a compliance feature with different retention, access and volume
-- requirements -- building it by accident is how a table ends up holding every place a
-- vehicle has been for six months with no deletion policy.
--
-- The `recorded_at` column is what makes a stale position visible rather than
-- misleading. A dispatcher looking at a van whose last report was twenty minutes ago
-- should be able to see that, and a dispatcher looking at a *current* marker for a vehicle
-- that stopped reporting without being told is being told a lie. Age is the difference.
--
-- ── why the driver writes through a function ────────────────────────────────────
--
-- A driver must not be able to write a position for a trip they are not driving, and must
-- not be able to backdate `recorded_at` to hide a gap. Neither is expressible as a column
-- grant, so the write is api.report_position() and the table is read-only to clients.

create table if not exists public.live_positions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  latitude    numeric not null,
  longitude   numeric not null,
  -- When the device recorded it, not when the server received it. The difference matters
  -- when a queued report finally flushes after a driver came back into signal.
  recorded_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint live_positions_latitude_range  check (latitude  between  -90 and  90),
  constraint live_positions_longitude_range check (longitude between -180 and 180),
  -- One position per trip. The primary key is on trip_id, so the upsert in
  -- report_position() cannot leave two rows racing to describe the same vehicle.
  constraint live_positions_trip_unique unique (trip_id)
);

comment on table public.live_positions is
  'Latest reported vehicle position per trip. A current-position table, not a history: '
  'recorded_at is what makes a stale position visible rather than misleading.';
comment on column public.live_positions.recorded_at is
  'When the device recorded the position, not when the server received it.';

create index if not exists live_positions_tenant_idx on public.live_positions (tenant_id);
create index if not exists live_positions_recorded_idx on public.live_positions (recorded_at desc);

-- ── read access ─────────────────────────────────────────────────────────────────
--
-- The dispatcher surface and anyone supervising a run. A driver does not need to read
-- this table: their own position comes back from the write, and reading it would only
-- invite a second, conflicting source of truth on the handset.
--
-- Analyst is included deliberately. Watching where vehicles are is a read, and the
-- read-only role exists to be able to read things without acting on them -- the same
-- reasoning that keeps `analytics` out of READ_ONLY_HIDDEN in the navigation.

alter table public.live_positions enable row level security;

create policy "supervisors read live positions"
  on public.live_positions
  for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role(variadic array[
      'TENANT_ADMIN'::private.app_role,
      'WAREHOUSE_MANAGER'::private.app_role,
      'DISPATCHER'::private.app_role,
      'ANALYST'::private.app_role
    ]))
  );

-- No insert, update or delete policy on purpose. The only writer is
-- api.report_position(), and a client that could write this table directly could place a
-- van anywhere in Egypt.

create or replace function api.report_position(
  p_trip_id     uuid,
  p_latitude    numeric,
  p_longitude   numeric,
  p_recorded_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller    uuid := auth.uid();
  v_tenant    uuid;
  v_driver    uuid;
  v_status    private.trip_status;
  v_when      timestamptz;
begin
  if v_caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select t.tenant_id, t.driver_id, t.status
    into v_tenant, v_driver, v_status
    from public.trips t
   where t.id = p_trip_id;

  if v_tenant is null then
    raise exception 'no such trip' using errcode = 'P0002';
  end if;

  -- The caller's own tenant, from the profile, not from the trip. Comparing the two is
  -- what makes a cross-tenant read-and-write impossible: a driver who guesses another
  -- tenant's trip id is refused here rather than writing into somebody else's run.
  if v_tenant <> private.current_tenant_id() then
    raise exception 'trip belongs to another tenant' using errcode = '42501';
  end if;

  if v_driver is distinct from v_caller then
    raise exception 'only the driver on this run may report its position' using errcode = '42501';
  end if;

  -- Only while the van is actually out. A finished run has no live position: letting one
  -- be written would leave a marker parked at the last pharmacy for ever, which reads as
  -- a vehicle that never got home.
  --
  -- IN_TRANSIT, not IN_PROGRESS -- that was the first guess and private.trip_status has no
  -- such value, so the function would have raised on every legitimate call rather than on
  -- the bad ones. The enum is PLANNED, DISPATCHED, IN_TRANSIT, COMPLETED, CANCELLED.
  if v_status <> 'IN_TRANSIT' then
    raise exception 'run is not in transit' using errcode = '22023';
  end if;

  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
    raise exception 'latitude out of range' using errcode = '22023';
  end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'longitude out of range' using errcode = '22023';
  end if;

  -- Accepted as given, within a generous window. A device clock can be wrong, and a
  -- position stamped in the future would sort as the newest forever and freeze the marker
  -- at that point. An old timestamp is not clamped, because that is the honest reading:
  -- the driver really was last seen then, and the age is the information.
  v_when := coalesce(p_recorded_at, now());
  if v_when > now() + interval '5 minutes' then
    raise exception 'recorded_at is in the future' using errcode = '22023';
  end if;

  insert into public.live_positions as lp (tenant_id, trip_id, latitude, longitude, recorded_at)
  values (v_tenant, p_trip_id, p_latitude, p_longitude, v_when)
  on conflict (trip_id) do update
    set latitude    = excluded.latitude,
        longitude   = excluded.longitude,
        recorded_at = excluded.recorded_at,
        updated_at  = now()
    -- Guard against a late-arriving queued report overwriting a newer one. The offline
    -- queue can flush out of order when a driver drives back into signal, and without
    -- this the marker jumps backwards to where the van used to be.
    where excluded.recorded_at >= lp.recorded_at;

  return v_when;
end;
$$;

comment on function api.report_position(uuid, numeric, numeric, timestamptz) is
  'Record the driver''s current position for a run in progress. One row per trip; an '
  'out-of-order replay does not overwrite a newer fix.';

revoke execute on function api.report_position(uuid, numeric, numeric, timestamptz)
  from public, anon;
grant execute on function api.report_position(uuid, numeric, numeric, timestamptz)
  to authenticated;

-- The position is operational telemetry, not a business record, so it is not audited.
-- An audit row per fix would be one row every few seconds per vehicle, which is a table
-- that grows without bound and answers no question anybody asks.
notify pgrst, 'reload schema';
