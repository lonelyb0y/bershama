-- A CI-owned fixture, so the browser suite stops depending on demo accounts.
--
-- ── why this exists ────────────────────────────────────────────────────────────
--
-- The Browser (end-to-end) job signs in as admin@demo.local, pharmacy@demo.local and
-- driver@demo.local against the *hosted* database — a Vercel preview deployment shares
-- the project's database, so there is no isolated environment for it to use.
--
-- That worked while the demo tenant was in place. It is now in production data that
-- nobody should be signing into: the demo accounts are throwaway credentials, and a real
-- deployment does not ship them. Deleting them was right, and it turned every pull
-- request's browser job red.
--
-- Re-seeding the demo accounts to make the job green would undo that. So the suite gets
-- its own fixture instead: accounts named ci-*@pharmaflow.test, in a tenant of its own,
-- created before the run and removed after it. They are not demo data, they are job
-- data — and they exist only while a job is using them.
--
-- ── why the accounts are created outside this function ──────────────────────────
--
-- The first version wrote auth.users rows itself, exactly as supabase/seed.sql does.
-- That seeds cleanly and produces accounts that cannot be logged into: GoTrue returns
-- invalid_credentials for a user whose hash, confirmation and identities are all
-- correct, and the only way to find out is to try. Writing auth rows directly also means
-- going around whatever the auth server does to them, which is not a thing this database
-- should be doing on a hosted project.
--
-- So the accounts are created through the Admin API by scripts/ci-fixture.sh, and this
-- function is handed their ids. profiles.id is a foreign key to auth.users, so it could
-- not do it any other way — and the division of labour is the right one regardless:
-- GoTrue owns Auth, this function owns the warehouse.
--
-- ── the grant, and why it is the same bargain as reset_demo_run ────────────────
--
-- rls_coverage.test.sql requires that EVERY function in `api` be executable by
-- `authenticated`. A service_role-only function would fail that assertion, so these are
-- granted to authenticated like everything else — and scoped instead, which is the
-- arrangement 20260101000056 already uses for api.reset_demo_run().
--
-- So there is no version of this call that can reach anybody's data. It writes to one
-- tenant, identified by a slug that is a constant here, and the only thing a caller
-- supplies is three user ids that have no meaning outside this fixture. Calling it twice
-- is not resource creation — it replaces the same tenant — which is the failure mode
-- 20260101000067 was careful to avoid for api.provision_tenant(), where a caller really
-- can loop and manufacture tenants.
--
-- ── why the scan function is separate ──────────────────────────────────────────
--
-- api.run_alert_scan_for_tenant() hardcodes the demo tenant as a constant, so it can
-- never scan this one. Rather than change that constant — it is doing real work for the
-- nightly worker — there is a sibling here scoped to the fixture.

create or replace function api.ci_seed_fixture(
  p_admin    uuid,
  p_pharmacy uuid,
  p_driver   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_slug     constant text := 'ci-fixture';
  c_tenant   constant uuid := '22222222-0000-4000-8000-000000000001';
  c_facility constant uuid := '22222222-0000-4000-8000-000000000201';
  c_loc_a    constant uuid := '22222222-0000-4000-8000-000000000202';
  c_loc_b    constant uuid := '22222222-0000-4000-8000-000000000203';
  c_prod_a   constant uuid := '22222222-0000-4000-8000-000000000301';
  c_prod_b   constant uuid := '22222222-0000-4000-8000-000000000302';
  -- Fixed batch ids, so re-seeding replaces the same lots rather than accumulating
  -- new ones and leaving the previous run's near-expiry stock still on the books.
  v_batch_short constant uuid := '22222222-0000-4000-8000-000000000401';
  v_batch_fresh constant uuid := '22222222-0000-4000-8000-000000000402';
  v_raised integer;
begin
  if p_admin is null or p_pharmacy is null or p_driver is null then
    raise exception 'the fixture needs three account ids; create them first'
      using errcode = '22023';
  end if;

  -- Refuse an id that is not one of ours, rather than attaching somebody's real
  -- account to the fixture tenant. The caller supplies ids, so this is the one input
  -- that could reach outside the constant scope the rest of this function relies on.
  if exists (
    select 1 from auth.users u
     where u.id in (p_admin, p_pharmacy, p_driver)
       and u.email not like 'ci-%@pharmaflow.test'
  ) then
    raise exception 'the fixture only adopts ci-*@pharmaflow.test accounts'
      using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  -- Idempotent by replacement rather than by error: a rerun after a partial failure
  -- should converge, not need a human to work out which half of the last run landed.
  --
  -- The existing tenant is dropped and rebuilt rather than topped up. Re-inserting over
  -- it would leave the previous run's ledger rows, alerts and balances in place, and
  -- the alert scan would then bump `occurrences` on alerts that are already open -- which
  -- writes to the audit trail, and audit_logs refuses updates. A fixture that could only
  -- ever be created once would be useless, since CI seeds on every run.
  --
  -- The immutability guards are suspended for that drop and restored immediately after,
  -- in the same transaction: a failure below rolls the suspension back with it.
  alter table public.audit_logs         disable trigger audit_logs_immutable;
  alter table public.stock_ledger       disable trigger stock_ledger_immutable;
  alter table public.proofs_of_delivery disable trigger proofs_of_delivery_immutable;

  delete from public.tenants where slug = c_slug;

  alter table public.audit_logs         enable trigger audit_logs_immutable;
  alter table public.stock_ledger       enable trigger stock_ledger_immutable;
  alter table public.proofs_of_delivery enable trigger proofs_of_delivery_immutable;

  insert into public.tenants (id, slug, name_en, name_ar, country_code, currency_code, vat_rate, timezone, locale_default)
  values (c_tenant, c_slug, 'CI Fixture', 'منشأة الاختبار', 'EG', 'EGP', 14, 'Africa/Cairo', 'en');

  insert into public.profiles (id, tenant_id, role, full_name, is_active, locale)
  values
    (p_admin,    c_tenant, 'TENANT_ADMIN',     'CI Admin',    true, 'en'),
    (p_pharmacy, c_tenant, 'PHARMACY_MANAGER', 'CI Pharmacy', true, 'en'),
    (p_driver,   c_tenant, 'DRIVER',           'CI Driver',   true, 'en');

  -- Enough inventory for the alert scan to have something to raise. The dates are
  -- relative to now() rather than fixed, because a fixture with a fixed expiry stops
  -- testing anything the day it passes -- which is the failure this migration exists to
  -- end, repeated one level down.
  insert into public.facilities (id, tenant_id, kind, code, name_en, name_ar)
  values (c_facility, c_tenant, 'WAREHOUSE', 'CI-WH', 'CI Warehouse', 'مستودع الاختبار');

  insert into public.storage_locations (id, tenant_id, facility_id, kind, code, name_en, name_ar)
  values
    (c_loc_a, c_tenant, c_facility, 'AMBIENT', 'CI-A1', 'CI Aisle 1', 'ممر أ'),
    (c_loc_b, c_tenant, c_facility, 'COLD',    'CI-C1', 'CI Cold',    'ثلاجة');

  insert into public.products (id, tenant_id, sku, name_en, name_ar, form, strength, uom, pack_size)
  values
    (c_prod_a, c_tenant, 'CI-001', 'CI Paracetamol 500mg', 'باراسيتامول', 'TABLET', '500mg', 'BOX', 10),
    (c_prod_b, c_tenant, 'CI-002', 'CI Vaccine 5ml',       'لقاح',        'VIAL',    '5ml',  'VIAL', 1);

  insert into public.batches (id, tenant_id, product_id, lot_number, mfg_date, expiry_date,
                              unit_cost_minor, supplier_name, supplier_ref, status)
  values
    -- Short shelf life: the alert the smoke suite asserts on. RELEASED, so the scan
    -- considers it stock rather than quarantined stock it should be ignoring.
    (v_batch_short, c_tenant, c_prod_a, 'CI-LOT-SHORT',
     current_date - 700, current_date + 20, 4500,
     'CI Supplier', 'CI-PO-0001', 'RELEASED'),
    -- Comfortably in date, so the alert centre also has something it should NOT raise.
    -- A fixture where everything alerts cannot tell a broken alert centre from a
    -- working one.
    (v_batch_fresh, c_tenant, c_prod_b, 'CI-LOT-FRESH',
     current_date - 10, current_date + 500, 12800,
     'CI Supplier', 'CI-PO-0002', 'RELEASED');

  -- Stock is created by writing to the ledger, never by inserting a balance.
  --
  -- The alert scan only considers a batch that is *holding* stock -- its candidate
  -- query requires a positive qty_on_hand -- so a fixture with batches and no stock
  -- raises nothing and alerts.spec.ts fails against a page that is working.
  --
  -- stock_balances is deliberately derived: writing to it directly is how a client
  -- would invent inventory that never arrived, which is why every movement in this
  -- schema goes through the ledger. The fixture follows the same rule rather than
  -- reaching past it, and the balance trigger does the rest.
  insert into public.stock_ledger (
    tenant_id, facility_id, location_id, product_id, batch_id,
    qty_delta, txn_type, reference_type, unit_cost_minor, actor_user_id, notes
  ) values
    (c_tenant, c_facility, c_loc_a, c_prod_a, v_batch_short,
     100, 'RECEIPT', 'CI_FIXTURE', 4500, p_admin, 'CI fixture receipt'),
    (c_tenant, c_facility, c_loc_b, c_prod_b, v_batch_fresh,
     40, 'RECEIPT', 'CI_FIXTURE', 12800, p_admin, 'CI fixture receipt');

  -- Raise the alerts now rather than making the test wait for a scan it did not ask
  -- for, and so a fixture that cannot raise anything fails at seed time.
  select raised into v_raised from api.ci_run_alert_scan();

  return jsonb_build_object(
    'tenant', c_tenant,
    'admin', p_admin,
    'pharmacy', p_pharmacy,
    'driver', p_driver,
    'alerts_raised', coalesce(v_raised, 0)
  );
end;
$$;

comment on function api.ci_seed_fixture(uuid, uuid, uuid) is
  'Create or replace the browser-suite fixture: one tenant, three ci-* accounts given roles, and enough inventory to raise an alert. Scoped to a constant tenant.';

-- ── the scan, scoped to the fixture ────────────────────────────────────────────
--
-- The same shape as api.run_alert_scan_for_tenant(), and for the same reason: it has to
-- impersonate an administrator of *its* tenant, because the alert scan writes on behalf
-- of one and the MFA policies would otherwise refuse it.

create or replace function api.ci_run_alert_scan()
returns table (raised integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tenant constant uuid := '22222222-0000-4000-8000-000000000001';
  v_sub   uuid;
begin
  select p.id into v_sub
    from public.profiles p
   where p.tenant_id = c_tenant and p.is_active
   order by (p.role = 'TENANT_ADMIN') desc nulls last, p.created_at
   limit 1;

  if v_sub is null then
    raise exception 'the fixture has no administrator to run the scan as'
      using errcode = 'P0002';
  end if;

  -- Both GUCs are set, and that is not belt-and-braces.
  --
  -- auth.uid() reads the `request.jwt.claim.sub` custom GUC -- which is what
  -- supabase/seed.sql impersonates with, and what the local compat shim implements.
  -- The `request.jwt.claims` JSON carries the `role` and `aal` claims, and is what
  -- 20260101000075 sets for the nightly worker. Setting only one of the two leaves a
  -- function that resolves no tenant in one environment and works in the other.
  perform set_config('request.jwt.claim.sub', v_sub::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_sub::text,
    'aal', 'aal2',
    'role', 'authenticated'
  )::text, true);

  select * into raised, skipped from api.run_alert_scan();

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  return next;
end;
$$;

-- ── teardown ───────────────────────────────────────────────────────────────────
--
-- Always runs, even when the suite failed, so a red build does not leave a tenant behind
-- for the next one to trip over.
--
-- It removes the tenant and the profiles, but NOT the auth users: those belong to the
-- script, which created them through the Admin API and can remove them the same way.
-- Deleting them from here would leave GoTrue's cache holding users the database no longer
-- has, and the next seed would fail the adoption check above.

create or replace function api.ci_teardown_fixture()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_slug   constant text := 'ci-fixture';
  v_tenant uuid;
begin
  select t.id into v_tenant from public.tenants t where t.slug = c_slug;

  if v_tenant is null then
    return jsonb_build_object('tenant', null, 'removed', false);
  end if;

  -- The append-only guards refuse the cascade: dropping the tenant deletes its ledger
  -- rows and its audit trail, and both tables are immutable by trigger. That immutability
  -- is the right default -- it is what stops a client rewriting history -- and dropping a
  -- fixture tenant is precisely the one case where the history is not worth keeping. So it
  -- is suspended for exactly this statement and restored in the same transaction, which
  -- also means a failure here cannot leave it disabled.
  alter table public.audit_logs         disable trigger audit_logs_immutable;
  alter table public.stock_ledger       disable trigger stock_ledger_immutable;
  alter table public.proofs_of_delivery disable trigger proofs_of_delivery_immutable;

  delete from public.tenants where id = v_tenant;

  alter table public.audit_logs         enable trigger audit_logs_immutable;
  alter table public.stock_ledger       enable trigger stock_ledger_immutable;
  alter table public.proofs_of_delivery enable trigger proofs_of_delivery_immutable;

  return jsonb_build_object('tenant', v_tenant, 'removed', true);
end;
$$;

comment on function api.ci_teardown_fixture() is
  'Remove the browser-suite fixture tenant. Scoped to a constant slug. Auth users are removed by the calling script, which created them through the Admin API.';

-- ── grants ─────────────────────────────────────────────────────────────────────
--
-- To authenticated, because rls_coverage.test.sql requires every api function to be
-- executable by authenticated and there is no service_role-only exception. The scoping
-- argument is above and it is the same one 20260101000056 makes.
--
-- Revoked from anon first, and from PUBLIC, which is what actually decides whether an
-- anonymous request can reach it -- naming anon in the REVOKE alone would not, because an
-- inherited PUBLIC grant survives it.

revoke execute on function api.ci_seed_fixture(uuid, uuid, uuid) from public, anon;
revoke execute on function api.ci_run_alert_scan() from public, anon;
revoke execute on function api.ci_teardown_fixture() from public, anon;

grant execute on function api.ci_seed_fixture(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function api.ci_run_alert_scan() to authenticated, service_role;
grant execute on function api.ci_teardown_fixture() to authenticated, service_role;

-- The public wrappers generated by 20260101000076 exist for a PostgREST that cannot
-- route the api schema. Regenerate the two new entries by hand here, so the fixture is
-- callable on the hosted project as well as locally.

create or replace function public.ci_seed_fixture(p_admin uuid, p_pharmacy uuid, p_driver uuid)
returns jsonb
language sql volatile set search_path = ''
as $$ select api.ci_seed_fixture(p_admin, p_pharmacy, p_driver) $$;

create or replace function public.ci_run_alert_scan()
returns table (raised integer, skipped integer)
language sql volatile set search_path = ''
as $$ select * from api.ci_run_alert_scan() $$;

create or replace function public.ci_teardown_fixture()
returns jsonb
language sql volatile set search_path = ''
as $$ select api.ci_teardown_fixture() $$;

revoke execute on function public.ci_seed_fixture(uuid, uuid, uuid) from public, anon;
revoke execute on function public.ci_run_alert_scan() from public, anon;
revoke execute on function public.ci_teardown_fixture() from public, anon;
grant execute on function public.ci_seed_fixture(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.ci_run_alert_scan() to authenticated, service_role;
grant execute on function public.ci_teardown_fixture() to authenticated, service_role;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';