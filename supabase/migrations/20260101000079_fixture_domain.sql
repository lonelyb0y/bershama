-- The browser fixture's accounts move to the new domain.
--
-- The project is now called Bershama, and the fixture's throwaway accounts were
-- named ci-*@pharmaflow.test. The adoption guard inside api.ci_seed_fixture() matches
-- on that domain, so it has to move with them -- otherwise the fixture would refuse
-- to seed accounts the script creates.
--
-- The guard itself is unchanged in shape: still a fixed pattern, still no argument a
-- caller can widen, still refusing anything that is not one of ours.
--
-- Migrations are not edited in place. 20260101000078 created this function and stays
-- exactly as it was applied; this replaces it. The body below is generated from that
-- file with the one string changed, so the two cannot drift apart by accident.

-- Make the CI fixture able to replace a tenant that has requisitions or trips.
--
-- ── why this exists ────────────────────────────────────────────────────────────
--
-- api.ci_seed_fixture() rebuilds its tenant from nothing, and it worked. Then a
-- requisition and a trip appeared in that tenant, and the next seed died with:
--
--   update or delete on table "tenants" violates foreign key constraint
--   "requisition_lines_tenant_id_fkey" on table "requisition_lines"
--
-- The cause is in the schema rather than in the function. Four tables carry a
-- tenant_id foreign key with no ON DELETE clause, so it defaults to NO ACTION and
-- the cascade stops:
--
--   requisition_lines   tenant_id -> tenants(id)   (NO ACTION)
--                       requisition_id -> requisitions(id) ON DELETE CASCADE
--   requisitions        tenant_id -> tenants(id)   (NO ACTION)
--   live_positions      tenant_id -> tenants(id)   (NO ACTION)
--                       trip_id -> trips(id) ON DELETE CASCADE
--   trips               tenant_id -> tenants(id)   (NO ACTION)
--
-- Everything else in the schema cascades from the tenant, so the tenant delete
-- succeeds -- until it reaches one of these four, which is still holding a row.
-- Then it refuses, and the fixture cannot replace what it made.
--
-- That is worth knowing on its own: **a tenant that has ever had a requisition,
-- a trip or a live position cannot be deleted at all.** The demo tenant had all
-- three, and its removal had to delete them by hand first.
--
-- ── what this migration does ───────────────────────────────────────────────────
--
-- It does not change the schema. The FK rules are a deliberate design decision --
-- NO ACTION on a tenant_id is what stops a row being moved between organisations by
-- accident, and this project has assertions about that.
--
-- It makes the fixture delete the four blocking children before it drops the
-- tenant, which is what a person does by hand and what the function should have
-- been doing. A fixture that can only be created once is not a fixture: CI seeds on
-- every run, and a run that follows a crashed one has to converge.
--
-- The same goes for the teardown, which had the identical problem -- it dropped the
-- tenant and would have failed on the very data the fixture itself had created.

-- ── the blocking children, named ───────────────────────────────────────────────
--
-- A list rather than a query, because the order matters and a query over
-- pg_constraint would have to re-derive the dependency order every time the schema
-- changes. These four are the ones whose tenant_id does not cascade, and they are
-- listed innermost first: requisition_lines before its requisition, live_positions
-- before its trip.
--
-- The deletes are scoped by tenant, so a fixture can never reach another
-- organisation's rows. There is no argument to widen: the tenant is the constant
-- c_tenant, and the only rows touched are the ones that tenant owns.

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
  v_batch_short constant uuid := '22222222-0000-4000-8000-000000000401';
  v_batch_fresh constant uuid := '22222222-0000-4000-8000-000000000402';
  v_raised integer;
begin
  if p_admin is null or p_pharmacy is null or p_driver is null then
    raise exception 'the fixture needs three account ids; create them first'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from auth.users u
     where u.id in (p_admin, p_pharmacy, p_driver)
       and u.email not like 'ci-%@bershama.test'
  ) then
    raise exception 'the fixture only adopts ci-*@bershama.test accounts'
      using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  -- Idempotent by replacement rather than by error: a rerun after a partial failure
  -- should converge, not need a human to work out which half of the last run landed.
  --
  -- The immutability guards are suspended for the drop and restored immediately
  -- after, in the same transaction: a failure below rolls the suspension back with it.
  alter table public.audit_logs         disable trigger audit_logs_immutable;
  alter table public.stock_ledger       disable trigger stock_ledger_immutable;
  alter table public.proofs_of_delivery disable trigger proofs_of_delivery_immutable;

  -- The four tables whose tenant_id does not cascade. Without this the tenant
  -- delete below is refused by the first of them that has a row.
  delete from public.requisition_lines where tenant_id = c_tenant;
  delete from public.live_positions    where tenant_id = c_tenant;
  delete from public.requisitions      where tenant_id = c_tenant;
  delete from public.trips             where tenant_id = c_tenant;

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
    (v_batch_short, c_tenant, c_prod_a, 'CI-LOT-SHORT',
     current_date - 700, current_date + 20, 4500,
     'CI Supplier', 'CI-PO-0001', 'RELEASED'),
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

-- ── the teardown, with the same four deletions ────────────────────────────────
--
-- The teardown had the identical problem: it dropped the tenant, and the fixture's
-- own requisitions would have stopped it. It is the same fix for the same reason.

create or replace function api.ci_teardown_fixture()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_slug   constant text := 'ci-fixture';
  c_tenant constant uuid := '22222222-0000-4000-8000-000000000001';
  v_tenant uuid;
begin
  select t.id into v_tenant from public.tenants t where t.slug = c_slug;

  if v_tenant is null then
    return jsonb_build_object('tenant', null, 'removed', false);
  end if;

  -- The append-only guards refuse the cascade: dropping the tenant deletes its
  -- ledger rows and its audit trail, and both tables are immutable by trigger. That
  -- immutability is the right default -- it is what stops a client rewriting history
  -- -- and dropping a fixture tenant is precisely the one case where the history is
  -- not worth keeping. So it is suspended for exactly this statement and restored in
  -- the same transaction, which also means a failure here cannot leave it disabled.
  alter table public.audit_logs         disable trigger audit_logs_immutable;
  alter table public.stock_ledger       disable trigger stock_ledger_immutable;
  alter table public.proofs_of_delivery disable trigger proofs_of_delivery_immutable;

  delete from public.requisition_lines where tenant_id = v_tenant;
  delete from public.live_positions    where tenant_id = v_tenant;
  delete from public.requisitions      where tenant_id = v_tenant;
  delete from public.trips             where tenant_id = v_tenant;

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
-- Unchanged from 20260101000077, and for the same reason: rls_coverage.test.sql
-- requires every api function to be executable by authenticated, so these are
-- scoped rather than restricted, and PUBLIC is revoked first because naming anon in
-- a REVOKE alone does not defeat an inherited PUBLIC grant.

revoke execute on function api.ci_seed_fixture(uuid, uuid, uuid) from public, anon;
revoke execute on function api.ci_teardown_fixture() from public, anon;

grant execute on function api.ci_seed_fixture(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function api.ci_teardown_fixture() to authenticated, service_role;

-- The public wrappers, because PostgREST on this project cannot route the api schema.
create or replace function public.ci_seed_fixture(p_admin uuid, p_pharmacy uuid, p_driver uuid)
returns jsonb
language sql volatile set search_path = ''
as $$ select api.ci_seed_fixture(p_admin, p_pharmacy, p_driver) $$;

create or replace function public.ci_teardown_fixture()
returns jsonb
language sql volatile set search_path = ''
as $$ select api.ci_teardown_fixture() $$;

revoke execute on function public.ci_seed_fixture(uuid, uuid, uuid) from public, anon;
revoke execute on function public.ci_teardown_fixture() from public, anon;
grant execute on function public.ci_seed_fixture(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.ci_teardown_fixture() to authenticated, service_role;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';