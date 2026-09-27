-- ============================================================================
-- movements.test.sql
--
-- The ledger and movement rules, exercised as a signed-in warehouse manager.
--
-- scripts/ledger-smoke.sh drives the same invariants from the table level with no
-- session, which proves the trigger and the constraints. This suite drives them
-- through the api.* surface as an authenticated caller, which is the path
-- production takes and the one where the business rules live.
--
-- The split matters: the smoke script can prove the database refuses nonsense, but
-- it cannot prove that a DISPATCHER is refused. That is here.
--
-- Two conventions worth knowing before reading:
--
--   * Assertions check the error CODE, not the message. Codes are the contract
--     the client localises against; messages are prose that will be reworded.
--
--   * Every date is relative to current_date, never a literal. A literal
--     expiry makes an assertion mean something different depending on the day CI
--     runs, and "days_to_expiry <= 90" against a hard-coded date passes in March
--     and fails in December. Relative dates also have to stay consistent with the
--     product's declared shelf life, or the shelf_life_sane check refuses the
--     fixture, which is that check working correctly.
-- ============================================================================

begin;

select plan(74);

-- ── a helper to read a raised error's structured detail ─────────────────────
--
-- The error contract is "code in the message, parameters in detail as JSON". That
-- only means something if the detail actually carries the numbers, so it needs to
-- be asserted rather than assumed.

create or replace function pg_temp.capture_error(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_state  text;
  v_message text;
  v_detail text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics
      v_state  = returned_sqlstate,
      v_message = message_text,
      v_detail  = pg_exception_detail;
    return jsonb_build_object(
      'state',   v_state,
      'message', v_message,
      'detail',  coalesce(v_detail, '')
    );
  end;
  return null;
end;
$$;

-- ── fixtures ────────────────────────────────────────────────────────────────
--
-- Two tenants, so cross-tenant isolation is testable. The second exists only to be
-- a thing the first must never see.

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'wm@tenant-a.test',    '{}'::jsonb),
  ('a0000000-0000-4000-8000-000000000002', 'driver@tenant-a.test', '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000001', 'wm@tenant-b.test',     '{}'::jsonb);

insert into public.tenants (id, slug, name_en, name_ar)
values
  ('a1000000-0000-4000-8000-000000000001', 'tenant-a', 'Tenant A', 'أ'),
  ('b1000000-0000-4000-8000-000000000001', 'tenant-b', 'Tenant B', 'ب');

insert into public.profiles (id, tenant_id, role, full_name)
values
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'WAREHOUSE_MANAGER', 'WH Manager A'),
  ('a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'DISTRIBUTOR',      'Driver A'),
  ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'WAREHOUSE_MANAGER', 'WH Manager B');

insert into public.facilities (id, tenant_id, kind, code, name_en, name_ar)
values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'WAREHOUSE', 'WH-A', 'Warehouse A', 'مستودع أ'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'PHARMACY', 'PH-A', 'Pharmacy A', 'صيدلية أ'),
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'WAREHOUSE', 'WH-B', 'Warehouse B', 'مستودع ب');

insert into public.storage_locations (id, tenant_id, facility_id, kind, code, name_en, name_ar)
values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'AMBIENT',    'AMB-1',  'Ambient 1',  'عادي 1'),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'QUARANTINE', 'QUAR-1', 'Quarantine', 'حجر'),
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'COLD',       'COLD-1', 'Cold',       'مبرد'),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'AMBIENT',    'AMB-B',  'Ambient B',  'عادي ب');

-- PARA-500 declares a 36 month shelf life, so its batches span ~1095 days.
-- AMOX-500 declares 24 months, ~730 days. Every batch below is built to match its
-- product, because an implausible one is refused by design.
insert into public.products (id, tenant_id, sku, name_en, name_ar, form, strength, pack_size, uom, atc_code, shelf_life_months)
values
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'PARA-500', 'Panadol Extra 500mg', 'بنادول إكسترا 500 مجم', 'TABLET', '500mg', 20, 'BOX', 'N02BE01', 36),
  ('a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'AMOX-500', 'Amoxil 500mg',         'أموكسيل 500 مجم',        'CAPSULE', '500mg', 21, 'BOX', 'J01CA04', 24),
  ('b4000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'B-TEST-1', 'Tenant B Product',     'منتج ب',                'TABLET', '100mg', 10, 'BOX', 'A02BC01', 24);

insert into public.batches (id, tenant_id, product_id, lot_number, mfg_date, expiry_date, unit_cost_minor, status)
values
  -- Comfortable shelf life: 1100 days, expiring in ~400 days. The FEFO "later" lot.
  ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'LOT-1',   current_date - 700, current_date + 400, 4500, 'RELEASED'),
  -- The FEFO "sooner" lot: 1060 days, expiring in 60 days. M3 must prefer it.
  ('a5000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'LOT-2',   current_date - 1000, current_date + 60,  4400, 'RELEASED'),
  -- Already expired: 1095 days, expiry 5 days ago.
  ('a5000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'LOT-EXP', current_date - 1100, current_date - 5,    4200, 'QUARANTINED'),
  -- Recalled: 1100 days, expiring in ~400 days.
  ('a5000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'LOT-REC', current_date - 700,  current_date + 400, 4600, 'RECALLED'),
  -- Tenant B's own lot, 730 days to match its 24 month product.
  ('b5000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'LOT-B',   current_date - 600,  current_date + 130, 1000, 'RELEASED');

-- ── receiving and issuing, as a warehouse manager ───────────────────────────

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';

select lives_ok(
  $sql$select api.receive_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', 240, 4500)$sql$,
  'receive_stock accepts a receipt of 240'
);

select results_eq(
  $sql$select qty_on_hand::text from public.stock_balances
    where location_id = 'a3000000-0000-4000-8000-000000000001'
      and product_id  = 'a4000000-0000-4000-8000-000000000001'
      and batch_id    = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['240'],
  'the balance reflects the receipt'
);

select results_eq(
  $sql$select txn_type::text from public.stock_ledger
    where batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['RECEIPT'],
  'the ledger recorded a RECEIPT'
);

select lives_ok(
  $sql$select api.issue_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', 40)$sql$,
  'issue_stock accepts an issue of 40'
);

select results_eq(
  $sql$select qty_on_hand::text from public.stock_balances
    where batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['200'],
  'the balance reflects the issue'
);

-- The core invariant: a balance is exactly the sum of its ledger.
select results_eq(
  $sql$select (b.qty_on_hand - coalesce(t.total, 0))::text
    from public.stock_balances b
    left join (select batch_id, sum(qty_delta) total from public.stock_ledger group by batch_id) t
      on t.batch_id = b.batch_id
    where b.batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['0'],
  'the balance equals the sum of the ledger'
);

-- ── overselling is refused, and refused properly ────────────────────────────

select throws_ok(
  $sql$select api.issue_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', 5000)$sql$,
  'P0001', 'insufficient_stock',
  'issuing more than is held is refused with insufficient_stock'
);

-- The detail is what the UI renders, so it must carry the numbers. An error code
-- without the data behind it is a support ticket waiting to happen.
--
-- `detail` is a text field holding JSON, so it is parsed before being indexed:
-- `->> 'detail'` returns the raw string, and only a cast to jsonb makes the
-- second `->>` meaningful.
select is(
  ((pg_temp.capture_error(
      $sql$select api.issue_stock(
          'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001', 5000)$sql$
    ) ->> 'detail')::jsonb ->> 'available')::int,
  200,
  'the error detail carries the available quantity'
);

select is(
  ((pg_temp.capture_error(
      $sql$select api.issue_stock(
          'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000001', 5000)$sql$
    ) ->> 'detail')::jsonb ->> 'requested')::int,
  5000,
  'the error detail carries the requested quantity'
);

-- A refused movement must change nothing. Asserted after the refusal rather than
-- assuming it.
select results_eq(
  $sql$select qty_on_hand::text from public.stock_balances
    where batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['200'],
  'the refused oversell left the balance unchanged'
);

select results_eq(
  $sql$select count(*)::text from public.stock_ledger
    where batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['2'],
  'the refused oversell recorded no ledger row'
);

-- ── batches that may not be issued from ─────────────────────────────────────

select throws_ok(
  $sql$select api.issue_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000004', 1)$sql$,
  'P0001', 'batch_not_released',
  'issuing from a RECALLED batch is refused'
);

select throws_ok(
  $sql$select api.issue_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000003', 1)$sql$,
  'P0001', 'batch_not_released',
  'issuing from a QUARANTINED batch is refused'
);

select throws_ok(
  $sql$select api.issue_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002',
      'a5000000-0000-4000-8000-000000000001', 1)$sql$,
  'P0001', 'batch_product_mismatch',
  'a batch that does not belong to the product is refused'
);

select throws_ok(
  $sql$select api.issue_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', -5)$sql$,
  'P0001', 'quantity_must_be_positive',
  'issue_stock refuses a negative quantity rather than inverting it'
);

-- ── adjustments need a reason ───────────────────────────────────────────────

select throws_ok(
  $sql$select api.adjust_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', 5, null)$sql$,
  'P0001', 'reason_code_required',
  'an adjustment with no reason code is refused'
);

select lives_ok(
  $sql$select api.adjust_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', -5, 'DAMAGE')$sql$,
  'an adjustment with a reason code is accepted'
);

select results_eq(
  $sql$select qty_on_hand::text from public.stock_balances
    where batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['195'],
  'the adjustment moved the balance by exactly its delta'
);

-- ── cross-tenant isolation ──────────────────────────────────────────────────
-- A cross-tenant id is INVISIBLE, not forbidden. "location_not_found" rather than
-- a permission error, because a different error would confirm the id exists.

select throws_ok(
  $sql$select api.receive_stock(
      'b3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', 10)$sql$,
  'P0001', 'location_not_found',
  'another tenant''s location is invisible, not merely forbidden'
);

select throws_ok(
  $sql$select api.receive_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001', 10)$sql$,
  'P0001', 'batch_not_found',
  'another tenant''s batch is invisible'
);

select is_empty(
  $sql$select id from public.batches where tenant_id = 'b1000000-0000-4000-8000-000000000001'$sql$,
  'no rows of another tenant are readable'
);

select is_empty(
  $sql$select id from public.facilities where tenant_id = 'b1000000-0000-4000-8000-000000000001'$sql$,
  'no facilities of another tenant are readable'
);

select is_empty(
  $sql$select id from public.products where tenant_id = 'b1000000-0000-4000-8000-000000000001'$sql$,
  'no products of another tenant are readable'
);

-- ── role enforcement ────────────────────────────────────────────────────────
-- A DISTRIBUTOR executes stops. They do not receive stock.

set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';

select throws_ok(
  $sql$select api.receive_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001', 10)$sql$,
  '42501', 'insufficient_role',
  'a DISTRIBUTOR cannot receive stock'
);

select throws_ok(
  $sql$select api.release_batch('a5000000-0000-4000-8000-000000000003', 'inspected')$sql$,
  '42501', 'insufficient_role',
  'a DISTRIBUTOR cannot release a batch'
);

-- But a driver scanning a carton needs to read the catalogue, so read access is
-- not role-gated. Asserted positively: a suite that only checks refusals would
-- pass with a UI nobody can use.
select is(
  (select count(*) from api.search_products(null, null, 100, 0))::int,
  2,
  'a DISTRIBUTOR can read the tenant catalogue'
);

-- Reconciliation is a system job, not a client operation. The private schema is
-- unreachable from a client session, which is the point of the schema split.
select throws_ok(
  $sql$select count(*) from private.reconcile_stock_balances()$sql$,
  '42501', null,
  'a client cannot call reconciliation directly'
);

set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';

-- ── batch creation rules ────────────────────────────────────────────────────

-- The uniqueness is (tenant, product, lot_number), so a collision needs the SAME
-- product. Reusing a lot number across different products is legal and must stay
-- legal, which is why the negative case below is on PARA-500 where LOT-1 exists.
select throws_ok(
  $sql$select api.create_batch(
      'a4000000-0000-4000-8000-000000000001', 'LOT-1',
      current_date - 700, current_date + 400)$sql$,
  'P0001', 'duplicate_lot_number',
  'a duplicate lot number for the same product is refused'
);

select lives_ok(
  $sql$select api.create_batch(
      'a4000000-0000-4000-8000-000000000002', 'LOT-1',
      current_date - 600, current_date + 130)$sql$,
  'the same lot number on a different product is allowed'
);

select throws_ok(
  $sql$select api.create_batch(
      'a4000000-0000-4000-8000-000000000002', 'LOT-BAD',
      current_date + 130, current_date - 600)$sql$,
  'P0001', 'invalid_expiry_date',
  'an expiry before manufacture is refused'
);

select lives_ok(
  $sql$select api.create_batch(
      'a4000000-0000-4000-8000-000000000002', 'LOT-NEW',
      current_date - 600, current_date + 130, 9000, 'Delta Pharma')$sql$,
  'a valid new batch is created'
);

select results_eq(
  $sql$select status::text from public.batches where lot_number = 'LOT-NEW'$sql$,
  array['QUARANTINED'],
  'a new batch defaults to QUARANTINED'
);

-- The shelf-life plausibility check, asserted on its own error code. AMOX-500
-- declares 24 months, and the tolerance is 0.5x-1.75x, so a legal batch implies
-- roughly 365 to 1277 days. This one implies about 1430, which is a transposed
-- year -- the error the check exists to catch.
select throws_ok(
  $sql$select api.create_batch(
      'a4000000-0000-4000-8000-000000000002', 'LOT-IMPLAUSIBLE',
      current_date - 30, current_date + 1400, 9000)$sql$,
  'P0001', 'shelf_life_implausible',
  'a batch implying ~47 months of shelf life for a 24 month product is refused'
);

-- ...and one at the other end: 100 days for a 24 month product.
select throws_ok(
  $sql$select api.create_batch(
      'a4000000-0000-4000-8000-000000000002', 'LOT-TOO-SHORT',
      current_date, current_date + 100, 9000)$sql$,
  'P0001', 'shelf_life_implausible',
  'a batch implying ~3 months of shelf life for a 24 month product is refused'
);

-- ── release, quarantine, recall ─────────────────────────────────────────────

select lives_ok(
  $sql$select api.release_batch((select id from public.batches where lot_number = 'LOT-NEW'))$sql$,
  'a QUARANTINED batch can be released'
);

select results_eq(
  $sql$select status::text from public.batches where lot_number = 'LOT-NEW'$sql$,
  array['RELEASED'],
  'the release took effect'
);

select ok(
  (select released_by from public.batches where lot_number = 'LOT-NEW') is not null,
  'the release recorded who released it'
);

-- The GDP release record is the point of a release: an accountable name and time.
select ok(
  (select released_at is not null from public.batches where lot_number = 'LOT-NEW'),
  'the release recorded when it happened'
);

-- An expired batch must not be releasable, whatever its status says.
select throws_ok(
  $sql$select api.release_batch('a5000000-0000-4000-8000-000000000003', 'inspected')$sql$,
  'P0001', 'cannot_release_expired_batch',
  'a batch past its expiry date cannot be released'
);

-- A recall with no reason is refused: a recall has consequences and needs a record.
select throws_ok(
  $sql$select api.recall_batch('a5000000-0000-4000-8000-000000000001', null)$sql$,
  'P0001', 'recall_reason_required',
  'a recall with no reason is refused'
);

select lives_ok(
  $sql$select api.recall_batch('a5000000-0000-4000-8000-000000000001', 'manufacturer recall L-2026-014')$sql$,
  'a batch can be recalled with a reason'
);

select results_eq(
  $sql$select status::text from public.batches where id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['RECALLED'],
  'the batch is RECALLED'
);

-- The stock MOVED rather than being relabelled in place. This is the assertion
-- that matters: a recall that only flips a status field leaves recalled stock
-- sitting in sellable locations, and FEFO is then one missed filter from shipping
-- something a regulator has withdrawn.
select results_eq(
  $sql$select sb.qty_on_hand::text from public.stock_balances sb
    where sb.location_id = 'a3000000-0000-4000-8000-000000000002'
      and sb.batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['195'],
  'the recalled stock moved into the quarantine location'
);

select results_eq(
  $sql$select sb.qty_on_hand::text from public.stock_balances sb
    where sb.location_id = 'a3000000-0000-4000-8000-000000000001'
      and sb.batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['0'],
  'the recalled batch no longer sits in the sellable location'
);

-- Conservation: a recall relocates stock, it does not create or destroy it.
select results_eq(
  $sql$select sum(sb.qty_on_hand)::text from public.stock_balances sb
    where sb.batch_id = 'a5000000-0000-4000-8000-000000000001'$sql$,
  array['195'],
  'total stock of the recalled batch is conserved'
);

-- A recalled lot may not skip quarantine on its way back.
select throws_ok(
  $sql$select api.release_batch('a5000000-0000-4000-8000-000000000001', 'false alarm')$sql$,
  'P0001', 'illegal_batch_transition',
  'a recalled batch cannot skip quarantine on its way back to RELEASED'
);

select lives_ok(
  $sql$select api.quarantine_batch('a5000000-0000-4000-8000-000000000001', 'under review')$sql$,
  'a recalled batch can be moved to quarantine'
);

-- ── the ledger is append-only, for every role ───────────────────────────────

select throws_ok(
  $sql$update public.stock_ledger set qty_delta = 9999$sql$,
  '42501', null,
  'no role may UPDATE the ledger'
);

select throws_ok(
  $sql$delete from public.stock_ledger$sql$,
  '42501', null,
  'no role may DELETE the ledger'
);

-- ── the read model ──────────────────────────────────────────────────────────
--
-- LOT-2 is stocked here, on purpose. v_expiry_report only lists batches that hold
-- stock -- an expiry report about a lot sitting at zero would be noise -- so
-- asserting a band on an empty batch asserts nothing. This also leaves two
-- batches of the same product with different expiries, which is the state M3's
-- FEFO allocator has to choose between.

select lives_ok(
  $sql$select api.receive_stock(
      'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000002', 30, 4400)$sql$,
  'a second batch of the same product is received'
);

select results_eq(
  $sql$select expiry_band::text from public.v_expiry_report
    where lot_number = 'LOT-2' and location_id = 'a3000000-0000-4000-8000-000000000001'$sql$,
  array['WARNING'],
  'a batch expiring in 60 days is banded WARNING'
);

select results_eq(
  $sql$select expiry_band::text from public.v_expiry_report
    where lot_number = 'LOT-1' and location_id = 'a3000000-0000-4000-8000-000000000002'$sql$,
  array['OK'],
  'the quarantined recalled batch, expiring in ~400 days, is banded OK'
);

-- The band boundaries are the GDP alert windows and are worth pinning: 30 days is
-- operational, 90 is planning. An off-by-one here silently reclassifies stock.
select is(
  (select expiry_band from public.v_expiry_report
    where lot_number = 'LOT-2' and location_id = 'a3000000-0000-4000-8000-000000000001'),
  'WARNING',
  'a batch at 60 days is inside the 90 day planning band'
);

-- Bilingual search: the same product found by either script, or by its SKU.
select is(
  (select count(*) from api.search_products('Panadol', null, 100, 0))::int,
  1,
  'the catalogue is searchable by the Latin name'
);

select is(
  (select count(*) from api.search_products('بنادول', null, 100, 0))::int,
  1,
  'the catalogue is searchable by the Arabic name'
);

select is(
  (select count(*) from api.search_products('AMOX', null, 100, 0))::int,
  1,
  'the catalogue is searchable by SKU fragment'
);

select is(
  (select count(*) from api.search_products('N02BE01', null, 100, 0))::int,
  1,
  'the catalogue is searchable by ATC code'
);

-- An unfiltered search must still be tenant-scoped.
select is(
  (select count(*) from api.search_products(null, null, 200, 0))::int,
  2,
  'an unfiltered search returns only this tenant''s products'
);

select is_empty(
  $sql$select id from api.search_products('Tenant B Product', null, 100, 0)$sql$,
  'search cannot find another tenant''s product'
);

-- One row per product, not one per shelf. A product in three locations must not
-- appear three times in a catalogue list or inflate the total count.
select is(
  (select count(*) from api.search_products('Panadol', null, 100, 0))::int,
  1,
  'a product in one location yields one search row'
);

-- The catalogue must report the SAME total the ledger holds, across every
-- location. Asserted against the sum rather than a literal, because by this point
-- the product has stock in two places (195 in quarantine, 30 in ambient) and a
-- hard-coded figure would only ever be right for one arrangement. The property
-- that matters is that the number the UI shows equals the number in the database.
select is(
  (select qty_on_hand from api.search_products('Panadol', null, 100, 0))::bigint,
  (select coalesce(sum(qty_on_hand), 0)::bigint
     from public.stock_balances
    where product_id = 'a4000000-0000-4000-8000-000000000001')::bigint,
  'search reports the same total on hand as the balances hold'
);

-- And that total spans locations: a product split across two shelves is one
-- catalogue row, not two.
select is(
  (select count(*) from public.stock_balances
    where product_id = 'a4000000-0000-4000-8000-000000000001' and qty_on_hand > 0)::int,
  2,
  'the product really is spread across two locations'
);

-- Deterministic pagination: the same page twice is the same rows, and the total
-- count travels with the page so a pager needs one round trip.
select is(
  (select total_count from api.search_products(null, null, 1, 0) limit 1)::int,
  2,
  'the total count travels with the page'
);

select is(
  (select count(distinct sku) from (
     select sku from api.search_products(null, null, 1, 0)
     union all
     select sku from api.search_products(null, null, 1, 1)
   ) p)::int,
  2,
  'paginating through the catalogue yields distinct rows'
);

-- The cap is a denial-of-service guard, and it must actually clamp.
select is(
  (select count(*) from api.search_products(null, null, 100000, 0))::int,
  2,
  'an oversized page limit is clamped rather than honoured'
);

-- ── reconciliation ──────────────────────────────────────────────────────────
--
-- Run as the owner, because reconciliation is a system job invoked by pg_cron, and
-- the client-side check that it is unreachable is asserted above.

reset role;

select is_empty(
  $$select * from private.reconcile_stock_balances()$$,
  'reconciliation reports no drift on a healthy database'
);

-- Corrupt a balance with owner rights -- the one thing the design says cannot
-- happen through the application -- and prove the detector notices.
update public.stock_balances
   set qty_on_hand = qty_on_hand + 7
 where batch_id = 'a5000000-0000-4000-8000-000000000002';

select results_eq(
  $$select drift::text from private.reconcile_stock_balances()
    where batch_id = 'a5000000-0000-4000-8000-000000000002'$$,
  array['7'],
  'reconciliation detects a corrupted balance'
);

select is(
  private.raise_drift_alerts()::int,
  1,
  'drift raises one alert per drifted key'
);

select is(
  (select count(*) from public.alert_events where type = 'STOCK_DRIFT')::int,
  1,
  'the drift alert is recorded once'
);

-- A second nightly run must not produce a second alert; the partial unique index
-- is what stops an 8-figure row count of duplicates.
select is(
  private.raise_drift_alerts()::int,
  1,
  'a repeat detection still finds the drift'
);

select is(
  (select count(*) from public.alert_events where type = 'STOCK_DRIFT')::int,
  1,
  'a repeat detection does not duplicate the alert'
);

select is(
  (select occurrences from public.alert_events where type = 'STOCK_DRIFT')::int,
  2,
  'the alert counts how many times the drift has been seen'
);

select results_eq(
  $$select severity::text from public.alert_events where type = 'STOCK_DRIFT'$$,
  array['CRITICAL'],
  'drift is a CRITICAL alert: the numbers cannot be trusted'
);

-- Repair the corruption so the rollback leaves nothing to think about.
update public.stock_balances
   set qty_on_hand = qty_on_hand - 7
 where batch_id = 'a5000000-0000-4000-8000-000000000002';

select is_empty(
  $$select * from private.reconcile_stock_balances()$$,
  'reconciliation is clean again once the balance agrees'
);

select * from finish();
rollback;
