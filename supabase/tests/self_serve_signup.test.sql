-- ============================================================================
-- self_serve_signup.test.sql
--
-- api.provision_tenant() is the function behind the open front door, so it is the one
-- wrapper in this database whose abuse needs no bug at all: calling it once is
-- legitimate, and the design question is what stops it being called again, and by whom.
--
-- The assertions are mostly refusals. A provisioning function is easy to make work and
-- easy to leave too permissive; the interesting cases are the ones that must fail.
--
-- ── why half of these assertions are wrapped in plpgsql ────────────────────────
--
-- Under READ COMMITTED a plain SELECT takes its snapshot when the statement begins. So
--
--     select is(api.provision_tenant('Nile Pharmacy', ...),
--               (select tenant_id from public.profiles where id = '...'), '...');
--
-- fails, and fails *silently* as NULL: the subquery is resolved from the snapshot taken
-- before the function ran, so it cannot see the row the function inserted a moment
-- earlier. The function is fine; the assertion is looking at the past.
--
-- Every assertion below that reads a row the function just wrote therefore goes through
-- pg_temp.provision(), which runs the call and the read as two separate statements and
-- so gets a fresh snapshot for the second. It also returns a description rather than a
-- bare boolean, so a failure says what the two values actually were.
-- ============================================================================

begin;

select plan(17);

-- ── harness ───────────────────────────────────────────────────────────────────
--
-- `set local request.jwt.claim.sub` rather than the JSON `request.jwt.claims` blob,
-- because that is what every other suite in this repository uses and auth.uid() reads
-- both. One way to impersonate a user here, not three.

create or replace function pg_temp.impersonate(p_sub uuid)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_sub::text, true)::text
$$;

-- Calls the function and then reads back what it wrote, as two statements so the read
-- gets a fresh snapshot (see the header). Returns 'ok' or a description of the
-- divergence, so a failure tells you what the two values actually were rather than just
-- that they differed.
create or replace function pg_temp.provision_and_capture(
  p_org     text,
  p_name    text,
  p_country text,
  p_tz      text,
  p_sub     uuid
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_return uuid;
  v_tenant uuid;
  v_slug   text;
begin
  v_return := api.provision_tenant(p_org, p_name, p_country, p_tz);

  select p.tenant_id, t.slug
    into v_tenant, v_slug
    from public.profiles p
    join public.tenants t on t.id = p.tenant_id
   where p.id = p_sub;

  if v_return is null then
    return 'function returned NULL';
  end if;
  if v_tenant is null then
    return 'no profile row was written for ' || p_sub::text;
  end if;
  if v_return <> v_tenant then
    return 'returned ' || v_return::text || ' but the profile points at ' || v_tenant::text;
  end if;
  if v_slug is null then
    return 'the profile points at a tenant that does not exist';
  end if;
  return 'ok';
end $$;

-- ── 1. the happy path ──────────────────────────────────────────────────────────

insert into auth.users (id, email, email_confirmed_at)
values ('33333333-0000-4000-8000-0000000000a1', 'founder@signup.test', now());
select pg_temp.impersonate('33333333-0000-4000-8000-0000000000a1');

select is(
  pg_temp.provision_and_capture(
    '  Nile Pharmacy  ', 'Sara Nabil', 'eg', 'Africa/Cairo',
    '33333333-0000-4000-8000-0000000000a1'),
  'ok',
  'provisioning creates the organisation, its profile, and returns the tenant id'
);

select is(
  (select role::text from public.profiles where id = '33333333-0000-4000-8000-0000000000a1'),
  'TENANT_ADMIN',
  'the person who created the organisation administers it'
);

select is(
  (select tenant_id from public.profiles where id = '33333333-0000-4000-8000-0000000000a1')
    = (select id from public.tenants where slug = 'nile-pharmacy'),
  true,
  'the profile points at the tenant whose slug was derived from the name'
);

-- Trimming is not cosmetic. The CHECK on tenants.name_en is only "not blank", so an
-- all-spaces name passes it and renders as an organisation with no name.
select is(
  (select name_en from public.tenants where slug = 'nile-pharmacy'),
  'Nile Pharmacy',
  'the organisation name is stored trimmed'
);

-- country_code arrived lowercase and must be normalised, not stored as 'eg'.
select is(
  (select country_code from public.tenants where slug = 'nile-pharmacy'),
  'EG',
  'the country code is upper-cased rather than stored as sent'
);

-- ── 2. the gate that matters: one organisation per person ──────────────────────

select throws_ok(
  $$select api.provision_tenant('Second Pharmacy', 'Sara Nabil', 'EG', 'Africa/Cairo')$$,
  '42501',
  'already belongs to an organisation',
  'a second call is refused: one organisation per person, once'
);

-- The refusal must not have left a stray tenant behind. Raising after inserting is the
-- classic way to orphan rows.
select is_empty(
  $$select slug from public.tenants where slug like 'second-pharmacy%'$$,
  'the refused call created no tenant'
);

-- ── 3. a caller can never choose their own role or tenant ─────────────────────
--
-- The signature has no such parameters, and that is the point. Asserted structurally, so
-- a future convenience parameter cannot be added quietly.

select is_empty(
  $$
  select a
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral unnest(p.proargnames) a
  where n.nspname = 'api'
    and p.proname = 'provision_tenant'
    and a in ('tenant_id', 'role', 'p_tenant_id', 'p_role', 'currency_code')
  $$,
  'provision_tenant accepts no tenant, role or currency parameter to be overridden'
);

-- ── 4. validation ─────────────────────────────────────────────────────────────

insert into auth.users (id, email, email_confirmed_at)
values ('33333333-0000-4000-8000-0000000000a2', 'shorty@signup.test', now());
select pg_temp.impersonate('33333333-0000-4000-8000-0000000000a2');

select throws_ok(
  $$select api.provision_tenant('X', 'Too Short', 'EG', 'Africa/Cairo')$$,
  '22023',
  'organisation name is required',
  'a one-character organisation name is refused'
);

select throws_ok(
  $$select api.provision_tenant('Valid Name', '   ', 'EG', 'Africa/Cairo')$$,
  '22023',
  'your name is required',
  'a blank personal name is refused'
);

select throws_ok(
  $$select api.provision_tenant('Valid Name', 'Real Name', 'EGY', 'Africa/Cairo')$$,
  '22023',
  'country code must be two letters',
  'a three-letter country code is refused rather than silently truncated'
);

select is_empty(
  $$select slug from public.tenants where slug in ('x', 'valid-name') or slug like 'valid-name-%'$$,
  'none of the three rejected calls created a tenant'
);

-- ── 5. a name with no sluggable characters ────────────────────────────────────
--
-- Arabic and Chinese organisation names slugify to nothing. That is the common case for
-- this deployment and the one most likely to have been overlooked: the obvious
-- implementation returns an empty string and dies on the CHECK constraint.

insert into auth.users (id, email, email_confirmed_at)
values ('33333333-0000-4000-8000-0000000000a3', 'arabic@signup.test', now());
select pg_temp.impersonate('33333333-0000-4000-8000-0000000000a3');

select is(
  pg_temp.provision_and_capture(
    'صيدلية النيل', 'أحمد علي', 'EG', 'Africa/Cairo',
    '33333333-0000-4000-8000-0000000000a3'),
  'ok',
  'an Arabic-only organisation name still provisions'
);

select ok(
  (select slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' from public.tenants
    where name_en = 'صيدلية النيل'),
  'and the generated slug satisfies the tenants.slug CHECK constraint'
);

-- ── 6. collisions ─────────────────────────────────────────────────────────────
--
-- Two pharmacies will both be called "Pharmacy". The slug is display-only and the uuid is
-- the real key, so a numeric suffix is enough and needs no coordination.

insert into auth.users (id, email, email_confirmed_at)
values ('33333333-0000-4000-8000-0000000000a4', 'dup1@signup.test', now());
select pg_temp.impersonate('33333333-0000-4000-8000-0000000000a4');
select is(
  pg_temp.provision_and_capture('City Pharmacy', 'One', 'EG', 'Africa/Cairo',
                                '33333333-0000-4000-8000-0000000000a4'),
  'ok', 'first "City Pharmacy" takes the plain slug');

insert into auth.users (id, email, email_confirmed_at)
values ('33333333-0000-4000-8000-0000000000a5', 'dup2@signup.test', now());
select pg_temp.impersonate('33333333-0000-4000-8000-0000000000a5');
select is(
  pg_temp.provision_and_capture('City Pharmacy', 'Two', 'EG', 'Africa/Cairo',
                                '33333333-0000-4000-8000-0000000000a5'),
  'ok', 'a second "City Pharmacy" also provisions, under a suffixed slug');

select is(
  (select count(*)::int from public.tenants where slug in ('city-pharmacy', 'city-pharmacy-1')),
  2,
  'and the two organisations hold distinct slugs'
);

select * from finish();
rollback;
