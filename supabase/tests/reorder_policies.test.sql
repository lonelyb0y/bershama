-- ============================================================================
-- reorder_policies.test.sql
--
-- The table is easy; the reader is where a reorder policy can be wrong in a way that
-- costs money. A policy that says "reorder paracetamol at 200" is only correct if:
--
--   * it fires when available stock reaches that number, not when it passes it;
--   * it accounts for stock already reserved by an allocation, because stock promised to
--     a requisition is not available to promise twice;
--   * it suggests a quantity that reaches the maximum rather than the difference between
--     two numbers that may not be ordered together;
--   * it does not fire for a product with no outbound movement, whose days of cover is
--     infinite and which is therefore *not* low on the days-of-cover test -- the failure
--     mode of the global threshold this replaces.
--
-- And the invariant: min_qty < max_qty. A policy with min >= max describes reordering a
-- product to less than the level at which it reorders, which suggests an order that
-- increases nothing and alerts again immediately after receipt.
-- ============================================================================

begin;

select plan(13);

-- A caller must exist before any tenant-scoped insert, because the tenant trigger
-- overwrites tenant_id with the *caller's* tenant and rejects a null one.
insert into auth.users (id, email, email_confirmed_at)
values ('55555555-0000-4000-8000-000000000001', 'reorder-admin@signup.test', now());

insert into public.tenants (id, slug, name_en, country_code, currency_code)
values ('33333333-0000-4000-8000-000000000001', 'reorder-test-co', 'Reorder Test Co', 'EG', 'EGP')
on conflict (id) do nothing;

insert into public.profiles (id, tenant_id, role, full_name, is_active, locale)
values ('55555555-0000-4000-8000-000000000001',
        '33333333-0000-4000-8000-000000000001', 'TENANT_ADMIN', 'Reorder Admin', true, 'en')
on conflict (id) do nothing;

insert into public.facilities (id, tenant_id, code, name_en, name_ar, kind)
values ('66666666-0000-4000-8000-000000000001',
        '33333333-0000-4000-8000-000000000001', 'RWH', 'Reorder Warehouse', 'مستودع', 'WAREHOUSE')
on conflict (id) do nothing;

-- `strength` is NOT NULL free text, not a number: "500mg", "2.5mg/ml", "10,000IU" and
-- "5% w/v" are all real strengths and a numeric column cannot hold them without a
-- formatting convention that then has to be parsed back. Fixture products have to supply
-- one, which is easy to forget and surfaces as a null violation rather than a hint.
insert into public.products
  (id, tenant_id, sku, name_en, name_ar, form, strength, uom, pack_size, is_active)
values
  ('77777777-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001',
   'PARA-500', 'Paracetamol 500mg', 'باراسيتامول 500 مجم', 'TABLET', '500mg', 'STRIP', 20, true),
  ('77777777-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001',
   'GLOVE-M', 'Gloves Medium', 'قفازات متوسطة', 'CREAM', 'M', 'BOX', 10, true),
  ('77777777-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000001',
   'DORMANT', 'Dormant Product', 'منتج خامل', 'SYRUP', '100ml', 'BOX', 10, true)
on conflict (id) do nothing;

set local request.jwt.claim.sub = '55555555-0000-4000-8000-000000000001';

-- ── 1. the invariant ──────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.reorder_policies
      (tenant_id, product_id, facility_id, min_qty, max_qty)
    values ('33333333-0000-4000-8000-000000000001',
            '77777777-0000-4000-8000-000000000001',
            '66666666-0000-4000-8000-000000000001', 200, 100)$$,
  '23514', null,
  'min above max is refused: it would reorder a product to less than the level it reorders at'
);

select throws_ok(
  $$insert into public.reorder_policies
      (tenant_id, product_id, facility_id, min_qty, max_qty)
    values ('33333333-0000-4000-8000-000000000001',
            '77777777-0000-4000-8000-000000000001',
            '66666666-0000-4000-8000-000000000001', 100, 100)$$,
  '23514', null,
  'min equal to max is refused too: the suggested order would always be zero'
);

-- ── 2. one policy per product per facility ─────────────────────────────────────────

insert into public.reorder_policies
  (tenant_id, product_id, facility_id, min_qty, max_qty, lead_time_days)
values
  ('33333333-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001',
   '66666666-0000-4000-8000-000000000001', 200, 1000, 5),
  ('33333333-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000002',
   '66666666-0000-4000-8000-000000000001', 40, 200, 3),
  ('33333333-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000003',
   '66666666-0000-4000-8000-000000000001', 10, 50, 30);

select throws_ok(
  $$insert into public.reorder_policies
      (tenant_id, product_id, facility_id, min_qty, max_qty)
    values ('33333333-0000-4000-8000-000000000001',
            '77777777-0000-4000-8000-000000000001',
            '66666666-0000-4000-8000-000000000001', 1, 2)$$,
  '23505', null,
  'a second policy for the same product and facility is refused rather than silently competing'
);

-- ── 3. stock ───────────────────────────────────────────────────────────────────────
--
-- A location, a batch each, and stock_balances rows. Gloves get a *reserved* quantity on
-- top, which is the case the reader has to get right.

insert into public.storage_locations (id, tenant_id, facility_id, kind, code, name_en, name_ar)
values ('88888888-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001',
        '66666666-0000-4000-8000-000000000001', 'AMBIENT', 'A-1', 'Aisle 1', 'ممر أ')
on conflict (id) do nothing;

-- One batch per product. Column names come from 0007_batches: `lot_number` rather than
-- `batch_no`, and `mfg_date`/`expiry_date` rather than `expires_on`. qty_received lives on
-- the ledger, not here -- a batch records identity and dates, and a receipt is a movement.
insert into public.batches
  (id, tenant_id, product_id, lot_number, mfg_date, expiry_date)
values
  ('99999999-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000001', 'LOT-PARA', current_date - 30, current_date + 365),
  ('99999999-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000002', 'LOT-GLOVE', current_date - 30, current_date + 365),
  ('99999999-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000003', 'LOT-DORM', current_date - 30, current_date + 365)
on conflict (id) do nothing;

-- Paracetamol: 150 on hand, below its reorder point of 200. Should appear.
-- Gloves: 30 on hand with 20 reserved -> 10 available, below its point of 40. Should
-- appear, and the suggestion must be from *available*, not from on-hand.
-- Dormant: 40 on hand, above its point of 10. Should NOT appear.
insert into public.stock_balances
  (tenant_id, location_id, product_id, batch_id, qty_on_hand, qty_reserved)
values
  ('33333333-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001', 150, 0),
  ('33333333-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000002', 30, 20),
  ('33333333-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000003', 40, 0)
on conflict (tenant_id, location_id, product_id, batch_id) do nothing;

-- ── 4. what the reader returns ─────────────────────────────────────────────────────

select is(
  (select count(*)::integer from api.reorder_needs()),
  2::integer,
  'exactly the two products at or below their reorder point, and not the one above it'
);

-- The gloves case is the one that matters: 30 on hand is under the point of 40, but so is
-- 10 available. Ordering from on-hand would suggest 170 units when 190 are actually needed.
select is(
  (select suggested_qty from api.reorder_needs()
    where product_id = '77777777-0000-4000-8000-000000000002'),
  190::numeric,
  'the suggestion is computed from available stock, so reserved stock is re-ordered'
);

select is(
  (select suggested_qty from api.reorder_needs()
    where product_id = '77777777-0000-4000-8000-000000000001'),
  850::numeric,
  'and for paracetamol it reaches the maximum from what is on hand'
);

select is(
  (select qty_available from api.reorder_needs()
    where product_id = '77777777-0000-4000-8000-000000000002'),
  10::numeric,
  'available is reported separately from on-hand so the difference is visible'
);

-- Paracetamol is below its point but has no outbound movement at all, so days of cover is
-- infinite. The global days-of-cover threshold this replaces would treat it as fine --
-- this is the case where the per-product policy is the whole reason the feature exists.
select is(
  (select days_of_cover from api.reorder_needs()
    where product_id = '77777777-0000-4000-8000-000000000001'),
  null::numeric,
  'days of cover is null, not infinite, for a product with no outbound movement'
);

select is(
  (select lead_time_days from api.reorder_needs()
    where product_id = '77777777-0000-4000-8000-000000000001'),
  5::integer,
  'the lead time travels with the suggestion, because it is the number a buyer negotiates'
);

-- ── 5. the policy is the filter ────────────────────────────────────────────────────

-- Disabling must silence the product without deleting the settings.
update public.reorder_policies set is_active = false
 where product_id = '77777777-0000-4000-8000-000000000002';

select is(
  (select count(*)::integer from api.reorder_needs()),
  1::integer,
  'an inactive policy produces no suggestion, and the row survives for when it returns'
);

select is(
  (select count(*)::integer from public.reorder_policies),
  3::integer,
  'and disabling is not deletion: the settings are still there'
);

-- Facility scoping: the reader can be asked about one facility, which matters because a
-- central warehouse and a branch pharmacy reorder on different schedules.
select is(
  (select count(*)::integer
     from api.reorder_needs('66666666-0000-4000-8000-000000000001')),
  1::integer,
  'the reader can be scoped to a single facility'
);

select is(
  (select count(*)::integer
     from api.reorder_needs('66666666-0000-4000-8000-000000000009')),
  0::integer,
  'a facility with no policies returns nothing rather than everything'
);

select * from finish();
rollback;