-- ============================================================================
-- stock_daily_snapshots.test.sql
--
-- A snapshot is a claim about a day that has already happened, and the ways it can be
-- wrong are specific:
--
--   * re-running a day duplicates rows, which makes every trend wrong in a way that is very
--     hard to see and very easy to cause;
--   * snapshotting today mid-afternoon silently misses the movements that have not happened
--     yet, and the chart shows a dip that did not happen;
--   * snapshotting a future day is worse -- it records a position that does not exist;
--   * "expiry at risk" of 0 and "expiry unknown" get averaged together and produce a number
--     that means neither thing.
--
-- The value is also recomputed on re-snapshot, and that is the point: correcting yesterday
-- must be possible, and it must not duplicate the row.
-- ============================================================================

begin;

select plan(11);

insert into auth.users (id, email, email_confirmed_at)
values ('66666666-0000-4000-8000-000000000001', 'snap-admin@signup.test', now());

insert into public.tenants (id, slug, name_en, country_code, currency_code)
values ('44444444-0000-4000-8000-000000000001', 'snap-test-co', 'Snapshot Test Co', 'EG', 'EGP')
on conflict (id) do nothing;

insert into public.profiles (id, tenant_id, role, full_name, is_active, locale)
values ('66666666-0000-4000-8000-000000000001',
        '44444444-0000-4000-8000-000000000001', 'WAREHOUSE_MANAGER', 'Snap Manager', true, 'en')
on conflict (id) do nothing;

insert into public.facilities (id, tenant_id, code, name_en, name_ar, kind)
values ('55555555-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001',
        'SWH', 'Snapshot Warehouse', 'مستودع', 'WAREHOUSE')
on conflict (id) do nothing;

-- `shelf_life_months` is declared because private.check_shelf_life_sane() validates every
-- batch against it: a batch whose implied shelf life is outside 0.5x-1.75x of the declared
-- one is refused as a transcription error. So a fixture that omits it inherits the column
-- default and then fails on dates that were perfectly reasonable in themselves.
insert into public.products
  (id, tenant_id, sku, name_en, name_ar, form, strength, uom, pack_size,
   shelf_life_months, is_active)
values
  ('77777777-0000-4000-8000-000000000011', '44444444-0000-4000-8000-000000000001',
   'SNAP-PER', 'Perishable', 'قابل للتلف', 'SYRUP', '100ml', 'BOX', 10, 12, true),
  ('77777777-0000-4000-8000-000000000012', '44444444-0000-4000-8000-000000000001',
   'SNAP-STB', 'Stable', 'مستقر', 'TABLET', '500mg', 'STRIP', 20, 24, true)
on conflict (id) do nothing;

insert into public.storage_locations (id, tenant_id, facility_id, kind, code, name_en, name_ar)
values ('88888888-0000-4000-8000-000000000011', '44444444-0000-4000-8000-000000000001',
        '55555555-0000-4000-8000-000000000001', 'AMBIENT', 'S-1', 'Snap Aisle', 'ممر')
on conflict (id) do nothing;

-- Two batches of the perishable: one expiring inside the 90-day risk horizon and one far
-- outside it. The stable product's batch expires far out, so it is genuinely at no risk.
--
-- Every batch carries an expiry date because `batches.expiry_date` is NOT NULL. An earlier
-- version of this suite asserted that a missing expiry would read as "unknown" -- a case
-- the schema cannot represent, so the branch was dead code and has been removed.
insert into public.batches
  (id, tenant_id, product_id, lot_number, mfg_date, expiry_date, unit_cost_minor)
values
  ('99999999-0000-4000-8000-000000000011', '44444444-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000011', 'EXP-SOON', current_date - 300, current_date + 30, 5000),
  ('99999999-0000-4000-8000-000000000012', '44444444-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000011', 'EXP-LATER', current_date - 30, current_date + 400, 5000),
  ('99999999-0000-4000-8000-000000000013', '44444444-0000-4000-8000-000000000001',
   '77777777-0000-4000-8000-000000000012', 'STABLE-LOT', current_date - 30, current_date + 700, 2000)
on conflict (id) do nothing;

insert into public.stock_balances
  (tenant_id, location_id, product_id, batch_id, qty_on_hand, qty_reserved)
values
  ('44444444-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000011',
   '77777777-0000-4000-8000-000000000011', '99999999-0000-4000-8000-000000000011', 10, 0),
  ('44444444-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000011',
   '77777777-0000-4000-8000-000000000011', '99999999-0000-4000-8000-000000000012', 20, 0),
  ('44444444-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000011',
   '77777777-0000-4000-8000-000000000012', '99999999-0000-4000-8000-000000000013', 50, 5)
on conflict (tenant_id, location_id, product_id, batch_id) do nothing;

set local request.jwt.claim.sub = '66666666-0000-4000-8000-000000000001';

-- ── 1. a closed day can be snapshotted ─────────────────────────────────────────────

-- `products_written`, not count(*). The function returns one summary row, so count(*)
-- over it is always 1 no matter how many products it wrote -- an assertion that can only
-- pass or fail for reasons unrelated to the snapshot.
select is(
  (select products_written from api.snapshot_stock(current_date - 1)),
  2::integer,
  'a past day snapshots both products'
);

-- Value is per lot cost: 10 x 5000 + 20 x 5000 = 150000 minor units for the perishable,
-- 50 x 2000 = 100000 for the stable one.
select is(
  (select value_minor from public.stock_daily_snapshots
    where product_id = '77777777-0000-4000-8000-000000000011'),
  150000::bigint,
  'value is summed from each lot cost, not from one product-level price'
);

select is(
  (select qty_reserved from public.stock_daily_snapshots
    where product_id = '77777777-0000-4000-8000-000000000012'),
  5::bigint,
  'reserved stock is recorded, because allocated stock is not free stock'
);

-- ── 2. expiry at risk: 0 is not the same as unknown ─────────────────────────────────

-- The perishable has one batch inside 90 days and one far outside, so its risk is knowable:
-- 10 units x 5000.
select is(
  (select expiry_risk_minor from public.stock_daily_snapshots
    where product_id = '77777777-0000-4000-8000-000000000011'),
  50000::bigint,
  'only the batch inside the risk horizon is counted'
);

select is(
  (select at_risk_batches from public.stock_daily_snapshots
    where product_id = '77777777-0000-4000-8000-000000000011'),
  1::integer,
  'and the count of batches at risk travels with the value'
);

-- The stable product expires far outside the horizon. Zero is the right answer here, and
-- it is a real zero: there is no unknown case, because every batch has an expiry date.
select is(
  (select expiry_risk_minor from public.stock_daily_snapshots
    where product_id = '77777777-0000-4000-8000-000000000012'),
  0::bigint,
  'a product expiring beyond the horizon is genuinely at zero risk, not unknown'
);

-- ── 3. idempotency ──────────────────────────────────────────────────────────────────

select is(
  (select products_written from api.snapshot_stock(current_date - 1)),
  2::integer,
  're-snapshotting the same day writes the same number of products'
);

select is(
  (select count(*) from public.stock_daily_snapshots
    where snapshot_on = current_date - 1),
  2::bigint,
  'and does not duplicate the rows: a snapshot is corrected, not appended'
);

-- ── 4. the past is special ──────────────────────────────────────────────────────────

select throws_ok(
  $$select api.snapshot_stock(current_date + 3)$$,
  '22023', 'cannot snapshot a future day',
  'a future day is refused: it would record a position that does not exist yet'
);

-- ── 5. the return value ─────────────────────────────────────────────────────────────

select is(
  (select total_value_minor from api.snapshot_stock(current_date - 1)),
  250000::bigint,
  'the total reported is the sum of the rows written, not a second opinion'
);

select is(
  (select at_risk_value_minor from api.snapshot_stock(current_date - 1)),
  50000::bigint,
  'and the at-risk total is the sum of the rows, with nothing excluded for being zero'
);

select * from finish();
rollback;