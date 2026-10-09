-- 0073: cold chain readings, and the excursion rule that makes them worth recording.
--
-- ── the gap ────────────────────────────────────────────────────────────────────────
--
-- `storage_locations` already declares a temperature range (`temp_min_c`, `temp_max_c`)
-- and `location_kind` already has COLD and FREEZER. Nothing reads them, because nothing
-- writes a temperature. So a vaccine fridge and a shelf of paracetamol are currently
-- indistinguishable in this system, and a fridge that has been at 11 degrees for six hours
-- records nothing at all.
--
-- That is a compliance gap rather than a feature gap. Cold-chain excursions are the one
-- thing in pharmacy inventory where the answer "we did not measure" is not acceptable, and
-- the reason a reading is kept forever rather than summarised is that a discarded reading
-- is a reading nobody can defend.
--
-- ── why readings are immutable ────────────────────────────────────────────────────
--
-- No update policy, and no writer that takes a reading id. A temperature log that can be
-- edited is not evidence of anything, and the only thing this table must never be is a
-- place where yesterday's fridge temperature can be tidied up after the fact. Correcting a
-- mis-keyed reading is done by recording the true one and letting the excursion logic
-- treat the pair as a fault, not by rewriting history.
--
-- ── why the excursion verdict is stored ────────────────────────────────────────────
--
-- Because "was this reading in range" depends on the *location's* range at the time, and
-- that range can be edited. A reading taken against a fridge later re-rated from 2-8 to
-- 2-10 would silently change from a fault to a non-fault, which is precisely the kind of
-- retroactive change a compliance log exists to prevent. So the verdict travels with the
-- reading, taken once, at insert.
--
-- ── where this deliberately stops ──────────────────────────────────────────────────
--
-- It does not raise alerts and it does not call anybody. A fridge at 11 degrees needs a
-- phone call now, not a row that says it needs one. Automating that is a product decision
-- with regulatory consequences, and it is recorded here as deliberately out of scope
-- rather than forgotten.

create table if not exists public.cold_chain_readings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,

  -- The fridge, not the product. A reading is about an environment; which batch happened to
  -- be in it is a separate question with its own answer, and conflating them makes the log
  -- unreadable the moment a fridge holds two batches.
  location_id uuid not null references public.storage_locations (id) on delete restrict,

  -- Celsius, deliberately not an enum or a range of buckets. Recorded values are sometimes
  -- beyond the expected range and that is the whole point; a numeric column is what makes
  -- "how far out was it, and for how long" answerable.
  temp_c      numeric(6,2) not null,

  -- Denormalised from the location at insert time. See the header: this is the verdict
  -- taken once, not a view over a range that can be edited later.
  range_min_c numeric(6,2),
  range_max_c numeric(6,2),
  -- NULLABLE, and that is the point. NULL means "no range has been declared for this
  -- location", which is not the same as false and must never collapse into it: claiming a
  -- fridge was in spec when nobody ever specified what spec is, is the specific error this
  -- design exists to prevent. A NOT NULL boolean here -- which is what this column first
  -- was -- can only record false, and a query filtering on is_excursion then silently
  -- treats "unrated" as "passed".
  is_excursion boolean,
  -- How far outside the range, in degrees. Null when in range, so "excursion of 3.1
  -- degrees" is distinguishable from "no excursion" without comparing against the range.
  excursion_c  numeric(6,2),

  -- Where the number came from. "manual" is the common case: somebody with a thermometer
  -- writing it down, which is better than not measuring. A sensor id would be a lie if
  -- nothing wrote from a sensor.
  source      text not null default 'manual' check (source in ('manual', 'sensor', 'import')),

  read_at     timestamptz not null default now(),
  recorded_by uuid references public.profiles (id) on delete set null,
  note        text,

  created_at  timestamptz not null default now()
);

comment on table public.cold_chain_readings is
  'Temperature log for COLD and FREEZER locations. Immutable: no update policy and no writer '
  'that takes a reading id, because a temperature log that can be edited is not evidence.';
comment on column public.cold_chain_readings.is_excursion is
  'Whether the reading was outside the declared range. NULL when the location has no '
  'declared range, which is unknown rather than passed.';
comment on column public.cold_chain_readings.range_min_c is
  'The location range as it stood when the reading was taken. Stored so that re-rating a '
  'fridge cannot retroactively turn a fault into a non-fault.';
comment on column public.cold_chain_readings.excursion_c is
  'How far outside the range, in Celsius. Null when in range.';

-- The read path is always "this location's recent history", so that is the index.
create index if not exists cold_chain_readings_location_idx
  on public.cold_chain_readings (location_id, read_at desc);
create index if not exists cold_chain_readings_tenant_idx
  on public.cold_chain_readings (tenant_id, read_at desc);
-- Excursions are rare and are the only rows anyone alerts on, so they get their own index.
create index if not exists cold_chain_readings_excursion_idx
  on public.cold_chain_readings (tenant_id, read_at desc) where is_excursion;

-- ── read access ────────────────────────────────────────────────────────────────────
--
-- Cold-chain custody is a pharmacy manager's job and a warehouse manager's, and an analyst
-- needs the history to answer a question at audit. Driver is absent: a driver moving a box
-- from one fridge to another is recording a movement, not attesting to a temperature, and
-- granting that would make the log attestable by the person with the least reason to be
-- careful about it.

alter table public.cold_chain_readings enable row level security;

create policy "cold chain readers see readings"
  on public.cold_chain_readings
  for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role(variadic array[
      'TENANT_ADMIN'::private.app_role,
      'WAREHOUSE_MANAGER'::private.app_role,
      'PHARMACY_MANAGER'::private.app_role,
      'ANALYST'::private.app_role
    ]))
  );

-- ── the writer ─────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because it reads the location's range to compute the verdict, and that
-- read must not be forgeable by the caller. The verdict is computed here, once, from the
-- location's own range -- a client cannot submit `is_excursion: false` for a reading that
-- was out of range, which would otherwise be a way to file away any excursion at will.
--
-- Range null (an AMBIENT location, or a fridge nobody has specified yet) means "no range
-- declared", which is NOT "in range". Such a reading is recorded with a NULL verdict rather
-- than a false one: claiming a fridge was in spec when nobody declared a spec is the
-- specific error this design exists to prevent.

create or replace function api.record_cold_reading(
  p_location_id uuid,
  p_temp_c numeric,
  p_read_at timestamptz default null,
  p_source text default 'manual',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_min    numeric(6,2);
  v_max    numeric(6,2);
  v_when   timestamptz := coalesce(p_read_at, now());
  v_out    numeric(6,2);
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- The role gate, and it has to be *here* rather than left to RLS.
  --
  -- SECURITY DEFINER bypasses row-level security for the duration of the function, so the
  -- table's policies -- which grant write to nobody -- protect nothing on this path. The
  -- first version of this function checked only that somebody was signed in, so any driver
  -- could attest to a fridge temperature. The table comment claimed that could not happen
  -- and the code did not enforce it; the test is what found the gap.
  --
  -- This is the general trap: SECURITY DEFINER plus RLS means the *function* owns every
  -- check the policy would have made.
  if not (select private.has_role(
           'TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'PHARMACY_MANAGER'
         )) then
    raise exception 'only a pharmacy or warehouse manager may record a temperature'
      using errcode = '42501';
  end if;

  if p_temp_c is null or p_temp_c < -90 or p_temp_c > 90 then
    raise exception 'temperature out of range' using errcode = '22023';
  end if;

  if p_source not in ('manual', 'sensor', 'import') then
    raise exception 'unknown reading source' using errcode = '22023';
  end if;

  -- A reading dated in the future is a mistake, not a forecast. Backdating is allowed and
  -- legitimate: transcribing yesterday's paper log is how most of this data arrives.
  if v_when > now() + interval '5 minutes' then
    raise exception 'read_at is in the future' using errcode = '22023';
  end if;

  select l.tenant_id, l.temp_min_c, l.temp_max_c
    into v_tenant, v_min, v_max
  from public.storage_locations l
  where l.id = p_location_id;

  if v_tenant is null then
    raise exception 'no such location' using errcode = 'P0002';
  end if;

  -- Cross-tenant check against the caller's own tenant, not the location's, so a guessed
  -- location id writes a refusal rather than a row in somebody else's fridge.
  if v_tenant <> (select private.current_tenant_id()) then
    raise exception 'location belongs to another tenant' using errcode = '42501';
  end if;

  -- A temperature recorded against a shelf is not data, it is noise that has to be filtered
  -- out of every query for ever. Refused rather than accepted-and-ignored.
  if not exists (
    select 1 from public.storage_locations l
    where l.id = p_location_id
      and l.kind in ('COLD'::private.location_kind, 'FREEZER'::private.location_kind)
  ) then
    raise exception 'readings are only accepted for COLD or FREEZER locations' using errcode = '22023';
  end if;

  -- The verdict, computed once from the range as it stands now.
  v_out := case
    when v_min is null or v_max is null then null
    when p_temp_c < v_min then v_min - p_temp_c
    when p_temp_c > v_max then p_temp_c - v_max
    else 0
  end;

  insert into public.cold_chain_readings (
    tenant_id, location_id, temp_c, range_min_c, range_max_c,
    is_excursion, excursion_c, source, read_at, recorded_by, note
  )
  values (
    v_tenant, p_location_id, p_temp_c, v_min, v_max,
    -- CASE, not `v_out is not null and v_out > 0`.
    --
    -- That looks equivalent and is not. Under SQL three-valued logic, `false AND null` is
    -- **false**, not null -- so an unrated fridge, whose v_out is null, was being recorded
    -- as is_excursion = false. Which is precisely the failure this column exists to prevent:
    -- a location nobody ever specified a range for was being stamped as having passed one,
    -- and any query filtering on is_excursion would treat it as compliant.
    --
    -- CASE short-circuits: the null case is returned without ever comparing it.
    case when v_out is null then null
         when v_out > 0 then true
         else false
    end,
    v_out,
    p_source, v_when, auth.uid(), p_note
  )
  returning id into v_id;

  return v_id;
end
$$;

comment on function api.record_cold_reading(uuid, numeric, timestamptz, text, text) is
  'Record a temperature for a COLD or FREEZER location and compute its excursion verdict '
  'once, from the range as it stands. A location with no declared range records a NULL '
  'verdict rather than a passing one. Enforces its own role gate because SECURITY DEFINER '
  'bypasses the table policies that would otherwise do it.';

revoke execute on function api.record_cold_reading(uuid, numeric, timestamptz, text, text)
  from public, anon;
grant execute on function api.record_cold_reading(uuid, numeric, timestamptz, text, text)
  to authenticated;

notify pgrst, 'reload schema';