-- Direct table writes by a client role.
--
-- ── the bug this file exists for ────────────────────────────────────────────
--
-- A signed-in user could not insert a product. Every catalogue form submit
-- returned:
--
--   42501 permission denied for schema private
--
-- and nothing caught it, because 181 unit tests, 169 pgTAP assertions and 33
-- Playwright tests all *read*. M1's writes went through api.* functions, which
-- are SECURITY DEFINER, so the direct path was never exercised. M2 shipped a
-- create form that writes the table directly -- correctly, since RLS is the
-- right mechanism for it -- and the first hand-run write against the hosted
-- project found it.
--
-- ── why `set role` is the whole point of this file ──────────────────────────
--
-- The other suites run as the owner, and a superuser bypasses both RLS and
-- privilege checks. That is correct for testing policy *logic* and useless for
-- testing whether a policy is *reachable*. `set role authenticated` puts the
-- session in exactly the position PostgREST puts it in, so a missing grant on
-- `private` shows up here as the same 42501 rather than in production.
--
-- The local cluster has no GoTrue, so auth.uid() is driven by
-- `request.jwt.claim.sub`, which is what the compat harness reads.

begin;

select plan(9);

insert into public.tenants (id, slug, name_en, currency_code, vat_rate, timezone)
values ('44444444-0000-4000-8000-000000000001', 'write-test', 'Write Test Co', 'EGP', 0.14, 'Africa/Cairo');

insert into auth.users (id, email, aud, role)
values ('44444444-0000-4000-8000-000000000001', 'writer@write-test.local', 'authenticated', 'authenticated');

insert into public.profiles (id, tenant_id, full_name, role, is_active)
values ('44444444-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001', 'Writer', 'TENANT_ADMIN', true);

-- The claim has to be set BEFORE the role switch, because the tenant trigger
-- resolves current_tenant_id() during the first insert.
-- `set local`, not `select set_config(...)`. check-assertions.py treats any line
-- beginning `select <fn>(` as a pgTAP assertion, and set_config is not one, so
-- the setup statement was reported as a portability failure.
set local request.jwt.claim.sub = '44444444-0000-4000-8000-000000000001';

set role authenticated;

-- ── the write that was broken ───────────────────────────────────────────────

select lives_ok(
  $$
  -- tenant_id is deliberately NOT in this statement. It is not a field anyone
  -- should be filling in, so the real form omits it, and the original version of
  -- this test supplied it -- which tested the one path that already worked and
  -- passed while the catalogue form was returning 42501 in production.
  insert into public.products
    (sku, name_en, name_ar, form, strength, pack_size, uom, shelf_life_months)
  values
    ('WRITE-1', 'Writable', 'قابل للكتابة', 'TABLET', '500', 20, 'BOX', 24)
  $$,
  'a client role can insert a product'
);

select lives_ok(
  $$
  insert into public.facilities (code, name_en, name_ar, kind)
  values ('WR-1', 'Writable Facility', 'منشأة', 'WAREHOUSE')
  $$,
  'a client role can insert a facility'
);

select lives_ok(
  $$
  insert into public.storage_locations (facility_id, code, name_en, name_ar, kind)
  values (
          (select id from public.facilities where code = 'WR-1'),
          'WR-A1', 'Writable shelf', 'رف', 'AMBIENT')
  $$,
  'a client role can insert a storage location'
);

-- ── and the tenant is still not the caller's to choose ──────────────────────
--
-- The trigger now overwrites tenant_id rather than refusing a mismatch, which is
-- the stronger claim: a client that sends someone else's tenant gets its own
-- written over the top. This asserts that, because an overwrite that did not
-- happen would be a silent cross-tenant write.

select is(
  (select tenant_id::text from public.products where sku = 'WRITE-1'),
  '44444444-0000-4000-8000-000000000001',
  'the tenant is the caller''s, whatever the row was submitted with'
);

select throws_ok(
  $$
  update public.products
  set tenant_id = '55555555-0000-4000-8000-000000000001'
  where sku = 'WRITE-1'
  $$,
  '42501',
  'tenant_id 55555555-0000-4000-8000-000000000001 does not match the caller tenant 44444444-0000-4000-8000-000000000001',
  'moving a row to another tenant is still refused on update'
);

-- ── requisitions, which have their own triggers ─────────────────────────────

select lives_ok(
  $$
  insert into public.requisitions (code, facility_id, justification)
  values ('WR-REQ-1',
          (select id from public.facilities where code = 'WR-1'), 'write check')
  $$,
  'a client role can insert a requisition'
);

select lives_ok(
  $$
  insert into public.requisition_lines (requisition_id, product_id, qty_requested)
  values (
          (select id from public.requisitions where code = 'WR-REQ-1'),
          (select id from public.products where sku = 'WRITE-1'),
          5)
  $$,
  'a client role can insert a requisition line'
);

select is(
  (select tenant_id::text from public.requisition_lines where qty_requested = 5),
  '44444444-0000-4000-8000-000000000001',
  'the line is in the caller''s tenant'
);

select is(
  (select requested_by::text from public.requisitions where code = 'WR-REQ-1'),
  '44444444-0000-4000-8000-000000000001',
  'requested_by is the caller, not something the form chose'
);

reset role;

select * from finish();
rollback;
