-- A failed stop has a time, but it is not a delivery time.
--
-- `api.fail_stop` was setting delivered_at, and delivery_stops_delivered_check --
-- correctly says delivered_at means the goods left somebody's hands, so a FAILED
-- stop was refused by the schema. The schema was right and the function was wrong.
--
-- The fix is not to loosen the check. A close time is a real fact about a stop and
-- it is genuinely different from a delivery time: "nobody was available at 14:20"
-- is when the stop closed, not when anything was delivered. Collapsing the two would
-- mean a report counting delivered_at as stops closed, which overstates deliveries
-- by exactly the number of failed calls -- which is the number a distributor is
-- most often accused of hiding.

alter table public.delivery_stops
  add column if not exists closed_at timestamptz;

comment on column public.delivery_stops.closed_at is
  'When the stop stopped being open, whatever the outcome. DELIVERED, FAILED, RETURNED and SKIPPED all have one; PENDING and ARRIVED never do.';

-- Existing rows: a delivered stop closed at the moment it was delivered.
update public.delivery_stops
set closed_at = delivered_at
where closed_at is null and delivered_at is not null;

alter table public.delivery_stops
  drop constraint if exists delivery_stops_delivered_check;

alter table public.delivery_stops
  add constraint delivery_stops_delivered_check
  -- Unchanged in meaning: delivered_at is a claim that somebody received goods.
  check (delivered_at is null or status in ('DELIVERED', 'RETURNED'));

alter table public.delivery_stops
  add constraint delivery_stops_closed_check
  -- A closed stop is one that can no longer be worked. An open stop must not carry
  -- a close time, for the same reason a PENDING stop must not carry an arrival time:
  -- a timestamp on a stop that has not happened becomes evidence of one.
  check (closed_at is null or status in ('DELIVERED', 'FAILED', 'RETURNED', 'SKIPPED'));

-- ── the two functions that close a stop ──────────────────────────────────────

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
      closed_at = now(),
      updated_at = now()
  where s.id = p_stop_id and s.status in ('PENDING', 'ARRIVED')
  returning * into v_row;

  if not found then
    raise exception 'this stop cannot be failed from where it is' using errcode = '22023';
  end if;

  return v_row;
end
$$;

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
      closed_at = now(),
      latitude = coalesce(p_latitude, s.latitude),
      longitude = coalesce(p_longitude, s.longitude),
      updated_at = now()
  where s.id = p_stop_id
  returning * into v_stop;

  return v_stop;
end
$$;

comment on function api.fail_stop(uuid, text) is
  'Fail a stop with a mandatory reason. A dispatcher deciding between calling again, rescheduling and cancelling needs three different answers and "failed" alone is none of them. Records closed_at, not delivered_at: nobody received anything, and a report counting delivered_at as stops closed would overstate deliveries by exactly the failed calls.';