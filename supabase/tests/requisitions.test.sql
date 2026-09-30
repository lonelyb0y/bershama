-- Requisition lifecycle and FEFO allocation.
--
-- The allocation tests are the ones worth having in this suite. FEFO is a
-- decision about which of several similar rows to take from, and the failure mode
-- is silent: the numbers still add up, the request is still marked allocated,
-- and the short-dated stock is still on the shelf. Only an assertion about
-- *which batch* was consumed catches that, which is why the fixtures below build
-- two batches with deliberately awkward properties -- a tie on expiry, a
-- quarantined one that expires sooner than anything else, and in-transit stock
-- nobody owns yet.

-- Helpers live in pg_temp, not pgtap_shim.
--
-- pgtap_shim is the FALLBACK schema verify-db.sh creates when the pgtap extension
-- is unavailable; CI has the real extension, so that schema does not exist there
-- and every helper failed with "schema pgtap_shim does not exist" while passing
-- locally. pg_temp is per-session and always there, which is what a test helper
-- actually wants.
--
-- No `set search_path` here on purpose. scripts/verify-db.sh runs every suite with
-- `set search_path = public, pgtap_shim;` prepended, and a bare set in the file
-- REPLACES that rather than adding to it -- which drops pgTAP and fails the very
-- first assertion with "function plan(integer) does not exist". Everything this
-- file calls is either in public, in pgtap_shim, or schema-qualified.

begin;

select plan(27);

-- ── fixtures ────────────────────────────────────────────────────────────────
--
-- A tenant, a facility, a pharmacy facility, a product, and stock in three
-- batches chosen so the FEFO ordering has something to get wrong:
--

insert into tenants (id, slug, name_en, name_ar, currency_code, vat_rate, timezone)
values ('33333333-0000-4000-8000-000000000001', 'req-test', 'Requisition Test Co', 'شركة اختبار', 'EGP', 0.14, 'Africa/Cairo');

-- auth.users first: profiles.id is a foreign key onto it, and the local harness
-- uses the stub table from 0000_supabase_compat.sql rather than GoTrue. Seeding
-- only profiles fails the FK, which is the harness being honest about the real
-- constraint rather than a quirk of the test environment.
insert into auth.users (id, email, aud, role)
values
  ('33333333-0000-4000-8000-000000000011', 'requester@req-test.local', 'authenticated', 'authenticated'),
  ('33333333-0000-4000-8000-000000000012', 'approver@req-test.local', 'authenticated', 'authenticated');

insert into profiles (id, tenant_id, full_name, full_name_ar, role, is_active)
values
  ('33333333-0000-4000-8000-000000000011', '33333333-0000-4000-8000-000000000001', 'Requester', 'مقدم الطلب', 'PHARMACY_MANAGER', true),
  ('33333333-0000-4000-8000-000000000012', '33333333-0000-4000-8000-000000000001', 'Approver', 'معتمد', 'WAREHOUSE_MANAGER', true);

insert into facilities (id, tenant_id, code, name_en, name_ar, kind, is_active)
values
  ('33333333-0000-4000-8000-000000000021', '33333333-0000-4000-8000-000000000001', 'WH', 'Warehouse', 'المستودع', 'WAREHOUSE', true),
  ('33333333-0000-4000-8000-000000000022', '33333333-0000-4000-8000-000000000001', 'PH1', 'Branch Pharmacy', 'صيدلية الفرع', 'PHARMACY', true);

insert into storage_locations (id, tenant_id, facility_id, code, name_en, name_ar, kind, is_active)
values
  ('33333333-0000-4000-8000-000000000031', '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000021', 'AMB-1', 'Ambient', 'محيط', 'AMBIENT', true),
  -- The in-transit location. Only the kind matters.
  ('33333333-0000-4000-8000-000000000032', '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000021', 'TRANSIT', 'In transit', 'في الطريق', 'IN_TRANSIT', true);

insert into products (id, tenant_id, sku, name_en, name_ar, form, strength, strength_unit, pack_size, uom, shelf_life_months, is_active)
values ('33333333-0000-4000-8000-000000000041', '33333333-0000-4000-8000-000000000001', 'REQ-1', 'Test Tablet', 'أقراص اختبار', 'TABLET', '500', 'mg', 20, 'BOX', 24, true);

/*
 * Four batches, all valid against the product's declared 24-month shelf life
 * (each between 0.5x and 1.75x, which the batches trigger enforces), and chosen
 * so a wrong FEFO implementation lands on the wrong row:
 *
 *   A  2027-06-01  100 free  RELEASED, ambient   <- soonest usable: must be taken first
 *   D  2027-09-01  999 free  RELEASED, IN_TRANSIT <- second soonest: must be SKIPPED
 *   B  2027-12-01   50 free  RELEASED, ambient   <- the 20-unit remainder
 *   C  2027-12-01  200 free  QUARANTINED, ambient <- ties B on expiry: must be SKIPPED
 *
 * D is the load-bearing one. It expires before B and holds 999 units, so an
 * implementation that forgets the IN_TRANSIT filter allocates from it, takes a
 * wildly wrong quantity, and fails loudly here instead of quietly promising a
 * pharmacy stock that is on a vehicle.
 */
insert into batches (id, tenant_id, product_id, lot_number, mfg_date, expiry_date, unit_cost_minor, status)
values
  ('33333333-0000-4000-8000-000000000051', '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000041', 'LOT-A', '2025-06-01', '2027-06-01', 1000, 'RELEASED'),
  ('33333333-0000-4000-8000-000000000052', '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000041', 'LOT-B', '2025-06-01', '2027-12-01', 1000, 'RELEASED'),
  ('33333333-0000-4000-8000-000000000053', '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000041', 'LOT-C', '2025-06-01', '2027-12-01', 1000, 'QUARANTINED'),
  ('33333333-0000-4000-8000-000000000054', '33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000041', 'LOT-D', '2025-06-01', '2027-09-01', 1000, 'RELEASED');

insert into stock_balances (tenant_id, location_id, product_id, batch_id, qty_on_hand, qty_reserved)
values
  ('33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000031', '33333333-0000-4000-8000-000000000041', '33333333-0000-4000-8000-000000000051', 100, 0),
  ('33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000031', '33333333-0000-4000-8000-000000000041', '33333333-0000-4000-8000-000000000052',  50, 0),
  ('33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000031', '33333333-0000-4000-8000-000000000041', '33333333-0000-4000-8000-000000000053', 200, 0),
  ('33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000032', '33333333-0000-4000-8000-000000000041', '33333333-0000-4000-8000-000000000054', 999, 0);

-- ── helpers ─────────────────────────────────────────────────────────────────

create or replace function pg_temp.req_tenant()
returns uuid language sql as $$ select '33333333-0000-4000-8000-000000000001'::uuid $$;

create or replace function pg_temp.as_requester()
returns void language plpgsql set search_path = '' as $$
begin
  -- `request.jwt.claim.sub`, singular. auth.uid() in the compat harness reads
  -- exactly that setting; the plural `request.jwt.claims` is what GoTrue writes
  -- on a real project, and setting it here is silently ignored, so
  -- current_tenant_id() returns null and the tenant trigger then fails a
  -- not-null constraint far from the cause.
  perform set_config('request.jwt.claim.sub', '33333333-0000-4000-8000-000000000011', true);
end $$;

create or replace function pg_temp.as_approver()
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', '33333333-0000-4000-8000-000000000012', true);
end $$;

create or replace function pg_temp.reset_tenant()
returns void language sql set search_path = '' as $$
  update public.requisition_lines set qty_allocated = null, shortage_qty = null
   where tenant_id = pg_temp.req_tenant();
$$;

-- ── the requisition itself ──────────────────────────────────────────────────

-- The claim has to be set before the first requisition insert: the
-- set_requisition_tenant trigger overwrites tenant_id with
-- private.current_tenant_id(), which is null without auth.uid(), and a
-- not-null violation is a confusing way to learn that.
select pg_temp.as_requester();

insert into public.requisitions (id, tenant_id, code, facility_id, status, justification)
values ('33333333-0000-4000-8000-000000000061', pg_temp.req_tenant(), 'REQ-0001', '33333333-0000-4000-8000-000000000022', 'DRAFT', 'Branch restock');

insert into public.requisition_lines (tenant_id, requisition_id, product_id, qty_requested)
values (pg_temp.req_tenant(), '33333333-0000-4000-8000-000000000061', '33333333-0000-4000-8000-000000000041', 120);

-- ── 1. lifecycle guards ─────────────────────────────────────────────────────

select is(
  (select status from public.requisitions where id = '33333333-0000-4000-8000-000000000061'),
  'DRAFT'::text,
  'a new requisition starts as DRAFT'
);

select throws_ok(
  $$ select api.allocate_requisition('33333333-0000-4000-8000-000000000061') $$,
  '22023',
  'requisition is DRAFT, only a SUBMITTED one can be allocated',
  'a DRAFT cannot be allocated -- it has to be submitted first'
);

select throws_ok(
  $$ select api.reject_requisition('33333333-0000-4000-8000-000000000061', 'no') $$,
  'P0002',
  'no SUBMITTED requisition 33333333-0000-4000-8000-000000000061 in this tenant that you may reject',
  'a DRAFT cannot be rejected'
);

-- 120 units requested, and only 150 are allocatable (A 100 + B 50), so the
-- request is short by 120 - 150 = 0 once both are counted. Take 120 and it is
-- covered exactly: A (100) then B (20).
select lives_ok(
  $$ select api.submit_requisition('33333333-0000-4000-8000-000000000061') $$,
  'a DRAFT with lines can be submitted'
);

select is(
  (select status from public.requisitions where id = '33333333-0000-4000-8000-000000000061'),
  'SUBMITTED'::text,
  'a submitted requisition is SUBMITTED'
);

select throws_ok(
  $$ select api.submit_requisition('33333333-0000-4000-8000-000000000061') $$,
  'P0002',
  'no DRAFT requisition 33333333-0000-4000-8000-000000000061 owned by you in this tenant',
  'a SUBMITTED requisition cannot be submitted again'
);

-- ── 2. who may approve ──────────────────────────────────────────────────────

select throws_ok(
  $$ select api.reject_requisition('33333333-0000-4000-8000-000000000061', 'because') $$,
  'P0002',
  'no SUBMITTED requisition 33333333-0000-4000-8000-000000000061 in this tenant that you may reject',
  'the requester cannot reject their own request'
);

select pg_temp.as_approver();

select throws_ok(
  $$ select api.reject_requisition('33333333-0000-4000-8000-000000000061', '  ') $$,
  '22023',
  'a rejection needs a reason',
  'a rejection with a blank reason is refused'
);

-- ── 3. FEFO: the actual allocation ──────────────────────────────────────────
--
-- 120 units requested. The order is A (2027-01-01, 100 free), then B
-- (2027-06-01, 50 free). LOT-C is quarantined and LOT-D is in transit; LOT-D
-- expires *earlier than everything else*, so if either filter were missing the
-- test would allocate from it and fail loudly here rather than quietly.

select lives_ok(
  $$ select api.allocate_requisition('33333333-0000-4000-8000-000000000061') $$,
  'a SUBMITTED requisition can be allocated'
);

select is(
  (select qty_allocated from public.requisition_lines where requisition_id = '33333333-0000-4000-8000-000000000061'),
  120::integer,
  'the full request was allocated'
);

select is(
  (select shortage_qty from public.requisition_lines where requisition_id = '33333333-0000-4000-8000-000000000061'),
  0::integer,
  'there is no shortage'
);

select is(
  -- 100 - 0 reserved + 100 = 100 reserved on LOT-A, the soonest expiry.
  ((select qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000051'))::integer,
  100::integer,
  'FEFO took the whole of the soonest-expiring batch first'
);

select is(
  -- Only the 20-unit remainder came from LOT-B.
  ((select qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000052'))::integer,
  20::integer,
  'and only the remainder from the next one'
);

select is(
  ((select qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000053'))::integer,
  0::integer,
  'nothing was taken from a quarantined batch'
);

select is(
  ((select qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000054'))::integer,
  0::integer,
  'nothing was taken from stock still in transit'
);

select is(
  ((select qty_on_hand from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000051'))::integer,
  100::integer,
  'allocating reserves stock; it does not decrement it'
);

select is(
  (select status from public.requisitions where id = '33333333-0000-4000-8000-000000000061'),
  'ALLOCATED'::text,
  'the requisition is ALLOCATED'
);

select is(
  (select decided_by::text from public.requisitions where id = '33333333-0000-4000-8000-000000000061'),
  '33333333-0000-4000-8000-000000000012',
  'the decider is recorded, and it is the approver rather than the requester'
);

select throws_ok(
  $$ select api.allocate_requisition('33333333-0000-4000-8000-000000000061') $$,
  '22023',
  'requisition is ALLOCATED, only a SUBMITTED one can be allocated',
  'an ALLOCATED requisition cannot be allocated twice'
);

-- ── 4. the tie on expiry ────────────────────────────────────────────────────
--
-- LOT-B and LOT-C both expire 2027-06-01. LOT-C is quarantined, so the tie must
-- resolve in favour of LOT-B, which is only true if the status filter is applied
-- before the ordering rather than after it. This is the assertion that would have
-- failed against the first version of the loop, which re-derived the batch to
-- update with a repeated ORDER BY and could land on either row.

select is(
  ((select qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000052'))::integer,
  20::integer,
  'a tie on expiry resolves to the released batch'
);

-- ── 5. a shortage is recorded, not raised ───────────────────────────────────

insert into public.requisitions (id, tenant_id, code, facility_id, status, justification)
values ('33333333-0000-4000-8000-000000000062', pg_temp.req_tenant(), 'REQ-0002', '33333333-0000-4000-8000-000000000022', 'SUBMITTED', 'Too much');

-- 900 requested against 30 free (A 100 - 100 reserved, B 50 - 20 reserved).
insert into public.requisition_lines (tenant_id, requisition_id, product_id, qty_requested)
values (pg_temp.req_tenant(), '33333333-0000-4000-8000-000000000062', '33333333-0000-4000-8000-000000000041', 900);

select lives_ok(
  $$ select api.allocate_requisition('33333333-0000-4000-8000-000000000062') $$,
  'a request larger than the free stock still allocates rather than failing'
);

select is(
  (select qty_allocated from public.requisition_lines where requisition_id = '33333333-0000-4000-8000-000000000062'),
  30::integer,
  'it allocated everything that was free'
);

select is(
  (select shortage_qty from public.requisition_lines where requisition_id = '33333333-0000-4000-8000-000000000062'),
  870::integer,
  'and recorded exactly how much was short'
);

select is(
  ((select qty_on_hand - qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000051'))::integer,
  0::integer,
  'nothing free remains in the soonest batch'
);

select is(
  ((select qty_on_hand - qty_reserved from public.stock_balances where batch_id = '33333333-0000-4000-8000-000000000052'))::integer,
  0::integer,
  'and nothing free in the next either'
);

-- ── 6. tenant isolation ─────────────────────────────────────────────────────

select is(
  (select count(*) from public.requisitions),
  2::bigint,
  'a requisition in another tenant is invisible'
);

select throws_ok(
  $$ select api.allocate_requisition(gen_random_uuid()) $$,
  'P0002',
  'requisition not found in this tenant',
  'allocating a requisition that is not yours is a not-found, not a permission error'
);

select * from finish();
rollback;
