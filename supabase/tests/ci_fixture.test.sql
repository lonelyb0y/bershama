-- The browser-suite fixture must actually produce a usable fixture.
--
-- ── why this test exists ───────────────────────────────────────────────────────────
--
-- Migration 20260101000077 replaced the demo accounts the Browser job used to sign in
-- with, because a production deployment should not ship throwaway credentials for a CI
-- job to be able to log in. The replacement is a fixture the job creates and destroys
-- around the run.
--
-- A fixture is only worth having if it works, and "works" is not obvious from reading
-- it: it has to raise an alert, or alerts.spec.ts fails against a page that is fine; it
-- has to land each account on its own surface, or auth.spec.ts fails with no clue why;
-- and it has to be replaceable, or the second run of a series cannot start.
--
-- ── what this test cannot check ───────────────────────────────────────────────────
--
-- It cannot check that the accounts can sign in. That is GoTrue's business, and the
-- failure mode is specifically invisible from the database: an earlier version of the
-- migration inserted auth.users rows itself and every column was correct, while every
-- sign-in returned invalid_credentials. Only scripts/ci-fixture.sh creating the accounts
-- through the Admin API fixed it, and the only thing that could have caught the
-- difference was a real sign-in — which is what the Browser job now does.
--
-- The auth rows below exist so profiles has something to point its foreign key at. They
-- are not the accounts the job uses.

select plan(11);

-- ── the accounts it adopts ───────────────────────────────────────────────────────

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('22222222-0000-4000-8000-000000000101', 'ci-admin@bershama.test',
   crypt('Bershama#2026', gen_salt('bf', 10)), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
  ('22222222-0000-4000-8000-000000000102', 'ci-pharmacy@bershama.test',
   crypt('Bershama#2026', gen_salt('bf', 10)), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
  ('22222222-0000-4000-8000-000000000103', 'ci-driver@bershama.test',
   crypt('Bershama#2026', gen_salt('bf', 10)), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated');

-- ── refusal of an account that is not ours ────────────────────────────────────────
--
-- The caller supplies three ids, which is the one input that could reach outside the
-- constant scope the function otherwise relies on.

select throws_ok(
  $$select api.ci_seed_fixture(null, null, null)$$,
  '22023',
  null,
  'the fixture refuses to seed without three account ids'
);

-- And the adoption guard, which is the other half of the same argument: an id that is
-- not one of ours is refused even though it names a real account. Without this, anyone
-- could attach their own user to the fixture tenant and sign in as its administrator.
select throws_ok(
  $$
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, aud, role)
  values ('22222222-0000-4000-8000-000000000199', 'not-ours@example.test',
          crypt('x', gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          'authenticated', 'authenticated');

  select api.ci_seed_fixture(
    '22222222-0000-4000-8000-000000000199',
    '22222222-0000-4000-8000-000000000102',
    '22222222-0000-4000-8000-000000000103'
  )$$,
  '42501',
  null,
  'the fixture refuses to adopt an account that is not one of its own'
);

-- ── seeding ──────────────────────────────────────────────────────────────────────

select is(
  api.ci_seed_fixture(
    '22222222-0000-4000-8000-000000000101',
    '22222222-0000-4000-8000-000000000102',
    '22222222-0000-4000-8000-000000000103'
  ) is not null,
  true,
  'the fixture seeds and returns a summary'
);

select is(
  (select count(*) from public.tenants where slug = 'ci-fixture'),
  1::bigint,
  'exactly one fixture tenant exists'
);

-- The roles are what decide which surface each sign-in lands on, so a fixture that
-- created three administrators would fail every sign-in assertion with a message about
-- the wrong URL.
select is(
  (select string_agg(role::text, ',' order by role::text)
     from public.profiles
    where tenant_id = (select id from public.tenants where slug = 'ci-fixture')),
  'DRIVER,PHARMACY_MANAGER,TENANT_ADMIN',
  'the fixture has one account per role the suite signs in as'
);

-- The one that matters most. alerts.spec.ts asserts the scan raises something; if the
-- fixture seeded and the scan found nothing, that spec fails as though the alert centre
-- were broken.
select ok(
  (select count(*) from public.alert_events a
     join public.tenants t on t.id = a.tenant_id
    where t.slug = 'ci-fixture') > 0,
  'seeding raises at least one alert for the alert centre to show'
);

select ok(
  (select count(*) from public.stock_balances sb
     join public.tenants t on t.id = sb.tenant_id
    where t.slug = 'ci-fixture' and sb.qty_on_hand > 0) > 0,
  'the fixture holds stock, which is what the scan looks for'
);

-- ── re-seeding is a replacement, not an accumulation ────────────────────────────

select is(
  api.ci_seed_fixture(
    '22222222-0000-4000-8000-000000000101',
    '22222222-0000-4000-8000-000000000102',
    '22222222-0000-4000-8000-000000000103'
  ) is not null,
  true,
  'the fixture can be seeded again without erroring'
);

select is(
  (select count(*) from public.tenants where slug = 'ci-fixture'),
  1::bigint,
  're-seeding replaces the tenant rather than creating a second one'
);

-- ── teardown ─────────────────────────────────────────────────────────────────────

select ok(
  api.ci_teardown_fixture() is not null,
  'the fixture tears down'
);

select is(
  (select count(*) from public.tenants where slug = 'ci-fixture'),
  0::bigint,
  'the fixture tenant is gone after teardown'
);

select * from finish();
rollback;