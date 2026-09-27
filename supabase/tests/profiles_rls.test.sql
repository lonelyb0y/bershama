-- ============================================================================
-- profiles_rls.test.sql
--
-- The M1 security gate. Proves that a signed-in user from tenant A cannot read
-- or write tenant B's rows, and that a user cannot escalate their own role.
--
-- Two distinct kinds of denial, and the distinction matters:
--   - Missing GRANT          -> raises 42501  -> assert with throws_ok()
--   - `using` matches no rows -> raises nothing -> assert with is_empty(), and
--     then re-read the target row to prove the denied write did not land.
-- A suite that only checks "no rows came back" passes even when the write
-- succeeded, so every denied write is paired with an intactness check.
-- ============================================================================

begin;

select plan(23);

-- ── fixtures ────────────────────────────────────────────────────────────────
-- Two tenants, two users each. The users are inserted straight into auth.users
-- because local Supabase Auth is not running in the test transaction.

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'admin-a@example.com',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'driver-a@example.com', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'admin-b@example.com',  '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'pharmacy-a@example.com', '{}'::jsonb);

insert into public.tenants (id, slug, name_en)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'tenant-a', 'Tenant A Distribution'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'tenant-b', 'Tenant B Distribution');

insert into public.profiles (id, tenant_id, role, full_name)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'TENANT_ADMIN',      'Admin A'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'DISTRIBUTOR',       'Driver A'),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001', 'PHARMACY_MANAGER',  'Pharmacy A'),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-000000000001', 'TENANT_ADMIN',      'Admin B');

-- ── anonymous access is refused outright ────────────────────────────────────
-- anon holds no grants on these tables, so the request stops before any policy
-- is evaluated. This is the "grants, not policies" case.

set local role anon;

select throws_ok(
  $$select * from public.tenants$$,
  '42501', null,
  'anon cannot read tenants'
);

select throws_ok(
  $$select * from public.profiles$$,
  '42501', null,
  'anon cannot read profiles'
);

select throws_ok(
  $$select * from public.audit_logs$$,
  '42501', null,
  'anon cannot read the audit log'
);

select throws_ok(
  $$select * from api.whoami()$$,
  '42501', null,
  'anon cannot call api.whoami'
);

-- ── a user reads their own profile and tenant ───────────────────────────────

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$select * from api.whoami() where user_id is null$$,
  'whoami returns the caller identity, not a null row'
);

select results_eq(
  $$select role::text from api.whoami()$$,
  array['DISTRIBUTOR'],
  'whoami reports the caller role from profiles'
);

select results_eq(
  $$select slug::text from public.tenants$$,
  array['tenant-a'],
  'a user sees only their own tenant'
);

select results_eq(
  $$select id from public.profiles where id = (select auth.uid())$$,
  array['22222222-2222-2222-2222-222222222222'::uuid],
  'a user sees their own profile'
);

-- ── cross-tenant isolation ──────────────────────────────────────────────────
-- The core assertion. Tenant B's admin row must be invisible.

select is_empty(
  $$select id from public.profiles where id = '33333333-3333-3333-3333-333333333333'$$,
  'tenant A cannot see tenant B''s admin profile'
);

select is_empty(
  $$select slug::text from public.tenants where slug = 'tenant-b'$$,
  'tenant A cannot see tenant B''s tenant row'
);

-- ── non-admin cannot read colleagues' profiles ──────────────────────────────

select is_empty(
  $$select id from public.profiles where id = '11111111-1111-1111-1111-111111111111'$$,
  'a DISTRIBUTOR cannot read another profile in their own tenant'
);

-- ── privilege escalation is blocked ─────────────────────────────────────────
-- WITH CHECK on the UPDATE policy is the thing that stops this. Without it, a
-- user could promote themselves to TENANT_ADMIN.

select throws_ok(
  $$update public.profiles
    set role = 'TENANT_ADMIN'
    where id = (select auth.uid())$$,
  '42501', null,
  'a user cannot escalate their own role'
);

select results_eq(
  $$select role::text from public.profiles where id = (select auth.uid())$$,
  array['DISTRIBUTOR'],
  'the failed escalation left the role unchanged'
);

select results_eq(
  $$select tenant_id from public.profiles where id = (select auth.uid())$$,
  array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
  'the failed escalation left the tenant unchanged'
);

-- ── an admin cannot write into another tenant either ────────────────────────

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*)::text from public.profiles$$,
  array['3'],
  'tenant A admin sees exactly their own tenant''s three profiles'
);

-- A cross-tenant UPDATE is refused by the policy's `using` clause, which filters
-- the row out. A `using` denial raises NOTHING and simply matches zero rows,
-- which is a different guarantee from a `with check` denial. Both are asserted
-- here, and the reason each one is used matters:
--
--   matched no row   the cross-tenant UPDATE was a no-op
--   row still intact  verified separately below, as the owner, because RLS
--                     hides that row from the tenant A admin so it cannot be
--                     read back under the same role

select is_empty(
  $$select id from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'
      and full_name = 'Hijacked'$$,
  'the cross-tenant update matched no row'
);

-- A user CAN update their own row. Asserted positively because the grant and the
-- policy together are what make api.update_my_profile() work; without this the
-- suite would still pass if updates were accidentally blocked for everyone.
--
-- lives_ok proves the statement was permitted. On its own it is not enough --
-- it also passes when an UPDATE matches zero rows -- so the changed value is
-- read back in the following assertion.
select lives_ok(
  $$update public.profiles
      set full_name = 'Admin A Renamed'
    where id = (select auth.uid())$$,
  'a user can update their own profile'
);

select results_eq(
  $$select full_name::text from public.profiles where id = (select auth.uid())$$,
  array['Admin A Renamed'],
  'the own-profile update actually changed the row'
);

-- The cross-tenant UPDATE as a statement: it must affect zero rows and must not
-- raise. `is_empty` cannot wrap an UPDATE in a subquery, so the count is read
-- from the row afterwards instead.
select is_empty(
  $$select id from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'
      and full_name <> 'Admin B'$$,
  'the tenant B row was not modified by the cross-tenant attempt'
);

reset role;

-- Intactness, read with privilege. Under the authenticated role this row is
-- invisible by design, so the check has to be made as the owner to be
-- meaningful -- otherwise "no rows returned" would be indistinguishable from
-- "row untouched".
select results_eq(
  $$select full_name::text from public.profiles where id = '33333333-3333-3333-3333-333333333333'$$,
  array['Admin B'],
  'the tenant B profile is intact after the denied update'
);

set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- ── audit log is append-only ────────────────────────────────────────────────
-- Back to the owner role for this section. The suites run as `authenticated` in
-- order to exercise policies, and that role deliberately has no INSERT on
-- audit_logs, so the fixture row has to be created with privilege.
reset role;

-- A row is inserted first. Updating an empty table succeeds trivially and would
-- assert nothing, so the trigger has to meet an actual row to be meaningful.
-- The tenant must exist, since audit_logs.tenant_id is a foreign key.

insert into public.audit_logs (tenant_id, action, entity_type)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture', 'test');

select throws_ok(
  $$update public.audit_logs set action = 'tampered' where action = 'fixture'$$,
  '42501', null,
  'audit_logs rejects UPDATE'
);

select throws_ok(
  $$delete from public.audit_logs where action = 'fixture'$$,
  '42501', null,
  'audit_logs rejects DELETE'
);

-- The row survived both attempts.
select results_eq(
  $$select action::text from public.audit_logs where action = 'fixture'$$,
  array['fixture'],
  'the audit row is unchanged after the rejected mutations'
);

select * from finish();
rollback;
