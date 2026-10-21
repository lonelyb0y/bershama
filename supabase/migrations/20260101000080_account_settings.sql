-- The account settings that had nowhere to live.
--
-- ── why notifications are per person and not per organisation ────────────────
--
-- Two people on the same shift want different things told to them. One wants
-- to hear about every batch crossing its expiry window; the other only wants
-- to hear about the ones that are about to be written off. A tenant-wide
-- setting would force one of them to live with the other's answer.
--
-- So the preferences live on the profile, next to the name and the phone
-- number, and they are read by the alert centre as it builds its list.
--
-- ── the shape is fixed in the database, not in the application ───────────────
--
-- A jsonb column with nothing on it accepts anything, and a preferences blob
-- that grows a key nobody reads is a preferences blob that cannot be trusted.
-- The function below coerces the three keys it knows about and drops
-- everything else, so the column can only ever hold those three booleans --
-- and the constraint on the column says so, so a row written by anything else
-- is rejected rather than silently accepted.

alter table public.profiles
  add column if not exists notifications jsonb not null default '{}'::jsonb;

-- The three keys, and nothing else. A column that can hold a key nobody reads
-- is a column nobody can rely on.
alter table public.profiles
  drop constraint if exists profiles_notifications_shape;
alter table public.profiles
  add constraint profiles_notifications_shape check (
    notifications <@ jsonb_build_object('expiry', true, 'deliveries', true, 'requisitions', true)
    and jsonb_typeof(notifications -> 'expiry')    in ('boolean', 'null')
    and jsonb_typeof(notifications -> 'deliveries') in ('boolean', 'null')
    and jsonb_typeof(notifications -> 'requisitions') in ('boolean', 'null')
  );

-- ── the write ─────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER, like every other api.* function, because the client is not
-- allowed to update its own profile row directly -- RLS on profiles is written
-- for the application's reads, and a settings write has to go through the
-- audit ledger like everything else.

create or replace function api.update_my_notifications(
  p_expiry      boolean default null,
  p_deliveries  boolean default null,
  p_requisitions boolean default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before  jsonb;
  v_after   public.profiles;
  v_user    uuid := (select auth.uid());
  v_current jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select to_jsonb(p) into v_before from public.profiles p where p.id = v_user;
  select coalesce(notifications, '{}'::jsonb) into v_current
    from public.profiles p where p.id = v_user;

  -- Each key is kept unless the caller set it. A null argument means "leave
  -- this one alone", which is what makes a partial update partial rather than
  -- a reset of the other two.
  update public.profiles p
  set notifications = jsonb_build_object(
        'expiry',       coalesce(p_expiry,       (v_current ->> 'expiry')::boolean,       true),
        'deliveries',   coalesce(p_deliveries,   (v_current ->> 'deliveries')::boolean,   true),
        'requisitions', coalesce(p_requisitions, (v_current ->> 'requisitions')::boolean, true)
      )
  where p.id = v_user
  returning * into v_after;

  perform private.write_audit(
    'profile.notifications_updated', 'profile', v_user::text, v_before, to_jsonb(v_after)
  );

  return v_after;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and PUBLIC includes
-- anon. So the grant above is not enough: without this revoke the function is
-- callable by a request with no session at all, and the rls_coverage suite
-- fails on it. This is the same trap migration 0016 documents for whoami.
grant execute on function api.update_my_notifications(boolean, boolean, boolean)
  to authenticated, service_role;
revoke execute on function api.update_my_notifications(boolean, boolean, boolean)
  from anon, public;

-- ── the public wrapper ───────────────────────────────────────────────────────
--
-- PostgREST on this project serves only the `public` schema, so an api.*
-- function is unreachable over HTTP until it has a wrapper there. The wrappers
-- are generated from pg_proc rather than written out by hand -- forty-nine
-- hand-copied signatures drift the moment a function is added, and the drift
-- is silent: a missing wrapper surfaces as a PGRST202 at runtime, not as a
-- test failure.

do $$
declare
  f        record;
  v_call   text;
  v_body   text;
  v_vol    text;
begin
  for f in
    select p.proname,
           p.proretset,
           p.provolatile,
           pg_get_function_arguments(p.oid) as args,
           pg_get_function_result(p.oid)   as result,
           coalesce(
             (select string_agg('$' || t.ord::text, ', ' order by t.ord)
                from generate_series(1, p.pronargs) as t(ord)),
             ''
           ) as call_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.prokind = 'f'
  loop
    v_call := format('api.%I(%s)', f.proname, f.call_args);
    v_vol  := case f.provolatile
                when 'i' then 'immutable'
                when 's' then 'stable'
                else 'volatile'
              end;

    -- A SETOF/table function is projected with `select *`; a composite-returning one
    -- is returned whole. Both cases hand back exactly what api.* returned, so the
    -- wrapper cannot change what a caller sees.
    v_body := case when f.proretset
                   then format('select * from %s', v_call)
                   else format('select %s', v_call)
                 end;

    -- INVOKER, not SECURITY DEFINER. The wrapper adds a name, not a privilege:
    -- each api.* function keeps its own authorising checks against the caller's
    -- tenant and role. A SECURITY DEFINER wrapper would break the assertion in
    -- rls_coverage.test.sql that no SECURITY DEFINER function sits in `public`.
    execute format($ddl$
      create or replace function public.%I(%s)
      returns %s
      language sql
      %s
      set search_path = ''
      as %L
    $ddl$, f.proname, f.args, f.result, v_vol, v_body);
  end loop;
end;
$$;

-- The wrapper is INVOKER, so it needs the same execute grant the api.* function
-- has, and it must not be reachable by `anon`.
grant execute on function public.update_my_notifications(boolean, boolean, boolean)
  to authenticated, service_role;
revoke execute on function public.update_my_notifications(boolean, boolean, boolean)
  from anon;

-- ── whoami carries the settings too ──────────────────────────────────────────
--
-- The account settings page needs the phone number and the notification
-- preferences, and it needs them on first paint -- a settings page that
-- fetches its own fields after the page has rendered is a settings page with a
-- flash of empty inputs.
--
-- So whoami returns them. It is the one call the application already makes on
-- every authenticated request, and adding two columns to it is cheaper than
-- adding a second round trip.
--
-- The return type changed, so the function is dropped and recreated. That is
-- the trap migration 0015 documents: dropping a function to change its return
-- type throws away its grants with it, because postgres grants EXECUTE to
-- PUBLIC by default on every new function. So the revoke is restated here, in
-- the same breath, exactly as 0015 does it.

drop function if exists api.whoami();

create or replace function api.whoami()
returns table (
  user_id      uuid,
  tenant_id    uuid,
  role         private.app_role,
  full_name    text,
  full_name_ar text,
  phone        text,
  locale       text,
  notifications jsonb,
  tenant_slug  text,
  currency_code char(3),
  vat_rate     numeric,
  timezone     text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select auth.uid()),
    t.id,
    p.role,
    p.full_name,
    p.full_name_ar,
    p.phone,
    p.locale,
    p.notifications,
    t.slug,
    t.currency_code,
    t.vat_rate,
    t.timezone
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.id = (select auth.uid())
    and p.is_active
$$;

comment on function api.whoami() is
  'Identity, tenant, role and account settings of the caller. Returns zero rows for an unknown, inactive or profileless user, which every caller must read as "no session" rather than as a broken tenant.';

-- `public` as well as `anon`, and the order matters.
--
-- Postgres grants EXECUTE to PUBLIC on every new function, and PUBLIC includes
-- anon. So `revoke ... from anon` removes the DIRECT grant to anon and leaves
-- the inherited one, and `has_function_privilege('anon', ...)` still resolves to
-- true -- which is exactly what the rls_coverage suite asserts against.
--
-- Migration 0016 revoked from anon alone and passed, because the PUBLIC grant
-- had already been swept by migration 0076. Dropping and recreating the
-- function here gives it a fresh PUBLIC grant, so the sweep has to be restated.
grant execute on function api.whoami() to authenticated, service_role;
revoke execute on function api.whoami() from anon, public;
