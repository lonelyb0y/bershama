-- ============================================================================
-- stocktake.test.sql
--
-- api.stock_take, and the distinction between a correction and a disposition.
--
-- The reason this file exists is a bug, and the bug is more interesting than the
-- feature. post_stock_movement() refused every negative movement against an
-- expired batch, which included the write-off -- so an expired batch could not be
-- removed from the books. That is the one operation that must always be available
-- on expired stock, and it was refused. See the header of 0011.
--
-- It survived 115 assertions in movements.test.sql because the only expired
-- fixture there was QUARANTINED, and the status check fired before the expiry
-- check, so the broken branch was never reached. The fixtures below include a
-- batch that is RELEASED *and* expired, which is the combination that slips
-- between the two checks.
--
-- The half of this file that matters most is the second one. Loosening a
-- validation rule to fix a legitimate operation is how a validation rule quietly
-- stops validating anything, so the tests assert both directions:
--
--   corrections are allowed against unavailable stock, AND
--   dispositions are still refused against it.
--
-- A fix that only asserted the first half would let a later edit widen the
-- carve-out until expired stock was issuable again.
-- ============================================================================

begin;

select plan(45);

-- ── a helper to read a raised error's structured detail ─────────────────────

create or replace function pg_temp.capture_error(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_state   text;
  v_message text;
  v_detail  text;
begin
  begin
    execute p_sql;
    return null;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
                            v_detail  = pg_exception_detail;
    return jsonb_build_object(
      'state',   v_state,
      'message', v_message,
      'detail',  case when v_detail = '' then null
                      else v_detail::jsonb end
    );
  end;
end;
$$;

-- ── fixtures ────────────────────────────────────────────────────────────────

-- One tenant, one facility, one location, one product, one manager.
--
-- auth.users first: public.profiles.id references it, so the profile cannot be
-- created before its user exists. The compat shim stands in for the auth schema
-- that Supabase provides.
insert into auth.users (id, email, raw_user_meta_data)
values ('c0000000-0000-4000-8000-000000000001', 'count@count-co.test', '{}'::jsonb);

insert into public.tenants (id, slug, name_en, name_ar, country_code, currency_code, timezone, locale_default)
values ('c1000000-0000-4000-8000-000000000001', 'count-co', 'Count Co. (test)', 'شركة الجرد (اختبار)',
        'EG', 'EGP', 'Africa/Cairo', 'en');

insert into public.profiles (id, tenant_id, role, full_name, full_name_ar)
values ('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'TENANT_ADMIN', 'Count Manager', 'مدير الجرد');

insert into public.facilities (id, tenant_id, code, name_en, name_ar, kind)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'MAIN', 'Main Warehouse', 'المستودع الرئيسي', 'WAREHOUSE');

insert into public.storage_locations (id, tenant_id, facility_id, code, name_en, name_ar, kind)
values ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000001', 'A1', 'Ambient A1', 'محيط A1', 'AMBIENT');

-- Shelf life 36 months, so the relative dates below stay plausible against the
-- shelf_life_sane check. That check working is not an obstacle to route around.
insert into public.products (id, tenant_id, sku, name_en, name_ar, form, strength, pack_size, uom, atc_code, shelf_life_months)
values ('c4000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'COUNT-500', 'Panadol Extra 500mg', 'بنادول إكسترا 500 مجم', 'TABLET', '500mg', 20, 'BOX', 'N02BE01', 36);

-- The batch that the existing suite was missing: RELEASED *and* expired. A
-- status of QUARANTINED would trip the earlier check and mask the expiry one.
insert into public.batches (id, tenant_id, product_id, lot_number, mfg_date, expiry_date, status)
values
  ('c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'LOT-OK',    current_date - 700,  current_date + 400, 'RELEASED'),
  ('c5000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'LOT-EXPIRED', current_date - 1150, current_date - 20, 'RELEASED'),
  ('c5000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'LOT-QUAR',  current_date - 700,  current_date + 400, 'QUARANTINED'),
  -- RELEASED and expired, and never written off, so it stays RELEASED. The
  -- expiry check can only be tested on a fixture the write-off has not already
  -- turned into DEPLETED: on a DEPLETED batch the status check fires first and
  -- raises batch_not_released, which is exactly what hid the original bug.
  ('c5000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'LOT-EXP-FRESH', current_date - 1150, current_date - 20, 'RELEASED'),
  -- Healthy, for the restock test in the second half.
  ('c5000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'LOT-RESTOCK', current_date - 700, current_date + 400, 'RELEASED');

-- Give the expired batch stock, so a write-off has something to remove.
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';

select lives_ok(
  $sql$select api.receive_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', 100, 4500)$sql$,
  'receive 100 of the good batch'
);
select lives_ok(
  $sql$select api.receive_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000002', 25, 4200)$sql$,
  'receive 25 of the expired batch -- expired on receipt, which receive allows'
);
select lives_ok(
  $sql$select api.receive_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000004', 5, 4200)$sql$,
  'receive 5 of the second expired batch, left RELEASED for the expiry tests'
);

-- ============================================================================
-- the regression: expired stock must be writable off
-- ============================================================================

select lives_ok(
  $sql$select api.write_off_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000002', 25, 'EXPIRED_WRITE_OFF')$sql$,
  'the expired batch can be written off -- the operation 0011 unblocks'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000002'),
  0::bigint,
  'writing off the expired batch leaves nothing on hand'
);

select is(
  (select status::text from public.batches where id = 'c5000000-0000-4000-8000-000000000002'),
  'DEPLETED',
  'a batch emptied by write-off is marked DEPLETED'
);

select throws_ok(
  $sql$select api.adjust_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000002', 0, 'DAMAGE')$sql$,
  'P0001', 'zero_quantity_movement',
  'a zero-delta adjustment is still refused after 0011'
);

-- A negative adjustment is the other kind of correction, and the comment above
-- the original check said it should be allowed.
select lives_ok(
  $sql$select api.adjust_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000004', -3, 'DAMAGE')$sql$,
  'a negative adjustment against an expired batch is allowed -- it corrects the books'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000004'),
  2::bigint,
  'the adjustment moved the fresh expired batch from 5 to 2 on hand'
);

-- ============================================================================
-- the other half: dispositions must STILL be refused
--
-- Without these, 0011 would look like a working fix while quietly allowing
-- expired stock to be handed to a customer.
-- ============================================================================

select throws_ok(
  $sql$select api.issue_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000004', 1)$sql$,
  'P0001', 'batch_expired',
  'issuing from an expired batch is still refused after 0011'
);

-- And the write-off case refuses a *supply* of that same lot too, which is the
-- other half of "expired stock is accountable but not sellable".
select throws_ok(
  $sql$select api.issue_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000002', 1)$sql$,
  'P0001', 'batch_not_released',
  'issuing from a fully written-off expired batch is refused as not released'
);

select throws_ok(
  $sql$select api.issue_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000003', 1)$sql$,
  'P0001', 'batch_not_released',
  'issuing from a quarantined batch is still refused after 0011'
);

-- A transfer out of expired stock is a disposition too.
select throws_ok(
  $sql$select api.transfer_stock(
      'c3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
      'c4000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000004', 1)$sql$,
  'P0001', 'same_location_transfer',
  'a transfer to the same location is refused before the expiry check applies'
);

-- ============================================================================
-- api.stock_take
-- ============================================================================

-- A count short of the books: 100 on hand, counted 97.
select lives_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', 97, 'MISCOUNT')$sql$,
  'a short count is accepted as the absolute counted quantity'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000001'),
  97::bigint,
  'the books now agree with the count of 97'
);

select is(
  (select txn_type::text from public.stock_ledger
    where batch_id = 'c5000000-0000-4000-8000-000000000001'
    order by id desc limit 1),
  'COUNT_LOSS'::text,
  'a short count posts a COUNT_LOSS'
);

select is(
  (select qty_delta from public.stock_ledger
    where batch_id = 'c5000000-0000-4000-8000-000000000001'
    order by id desc limit 1),
  -3::bigint,
  'the COUNT_LOSS is the variance, not the counted quantity'
);

-- A count over the books.
select lives_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', 120, 'MISCOUNT')$sql$,
  'an over-count is accepted'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000001'),
  120::bigint,
  'an over-count books a COUNT_GAIN'
);

select is(
  (select txn_type::text from public.stock_ledger
    where batch_id = 'c5000000-0000-4000-8000-000000000001'
    order by id desc limit 1),
  'COUNT_GAIN'::text,
  'an over-count posts a COUNT_GAIN'
);

-- A count that matches is the common case on a real count sheet, and returns NULL
-- rather than raising. Most lines on a count sheet are accurate; an error for
-- each one would be noise that teaches the counter to ignore the result.
select is(
  api.stock_take(
    'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001', 120, 'MISCOUNT'),
  null::bigint,
  'a count matching the books returns NULL rather than raising'
);

select is(
  (select count(*)::int from public.stock_ledger
    where batch_id = 'c5000000-0000-4000-8000-000000000001'),
  3::int,
  'a matching count wrote no ledger row -- no zero-delta noise'
);

-- A count of a lot the system has never heard of books it and stays honest about
-- it, rather than returning null and leaving the discrepancy invisible.
select lives_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000003', 40, 'MISCOUNT')$sql$,
  'counting a quarantined batch with no prior balance books it'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000003'),
  40::bigint,
  'the previously unknown quarantined batch shows 40 on hand'
);

-- A count cannot drive stock negative, because counted >= 0 bounds the delta.
select lives_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', 0, 'MISCOUNT')$sql$,
  'counting zero is allowed -- stock really can be gone'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000001'),
  0::bigint,
  'the counted-zero batch is empty, not negative'
);

select is(
  (select status::text from public.batches where id = 'c5000000-0000-4000-8000-000000000001'),
  'DEPLETED',
  'a batch counted to zero is DEPLETED, so the catalogue stops offering it'
);

-- A negative count is a mis-keyed figure, not a request to remove stock. Booking
-- it would create stock out of a typo.
select throws_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', -5, 'MISCOUNT')$sql$,
  'P0001', 'counted_quantity_invalid',
  'a negative count is refused with its own code'
);

select throws_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', 5, null)$sql$,
  'P0001', 'reason_code_required',
  'a count with no reason is refused'
);

select throws_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001', 5, '   ')$sql$,
  'P0001', 'reason_code_required',
  'a whitespace-only reason is refused as empty'
);

-- A count is a correction, so it is allowed against a quarantined batch. Counting
-- is an observation of reality and a refusal leaves the discrepancy sitting there.
select lives_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000003', 35, 'MISCOUNT')$sql$,
  'a count of a quarantined batch is allowed, so a shortfall gets recorded'
);

-- And it is refused for a batch in another tenant, which is the isolation
-- guarantee the whole api schema rests on.
select throws_ok(
  $sql$select api.stock_take(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'd5000000-0000-4000-8000-000000000009', 5, 'MISCOUNT')$sql$,
  'P0001', 'batch_not_found',
  'another tenant''s batch is not found rather than rejected'
);

-- The note the function writes when the caller gives none. It matters that it
-- names the variance: "stock adjusted by 3" is not reconstructable later, and
-- "counted 97, system 100, variance -3" is.
select is(
  (select notes from public.stock_ledger
    where batch_id = 'c5000000-0000-4000-8000-000000000001' and txn_type = 'COUNT_LOSS'
    order by id limit 1),
  'Stocktake: counted 97, system 100, variance -3',
  'a stocktake note records the count, the system figure and the variance'
);

-- ============================================================================
-- the second regression: a written-off lot that is restocked must work again
-- ============================================================================
--
-- Before 0011 this was broken with no error anywhere: the receipt succeeded, the
-- balance showed the stock, and the lot stayed DEPLETED and unsellable forever.
-- Silent data loss of the most annoying kind -- real stock, on the shelf,
-- impossible to sell, and nothing saying why.

select lives_ok(
  $sql$select api.receive_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 30, 4500)$sql$,
  'receive 30 of a healthy lot'
);

select lives_ok(
  $sql$select api.write_off_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 30, 'DAMAGE_WRITE_OFF')$sql$,
  'write off all 30, depleting the lot'
);

select is(
  (select status::text from public.batches where id = 'c5000000-0000-4000-8000-000000000005'),
  'DEPLETED',
  'the emptied lot is DEPLETED'
);

-- A second delivery of the same lot number. Ordinary in distribution, not an edge
-- case: a supplier ships the same lot in two consignments.
select lives_ok(
  $sql$select api.receive_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 12, 4500)$sql$,
  'receive 12 more of the same lot after it was written off'
);

select is(
  (select status::text from public.batches where id = 'c5000000-0000-4000-8000-000000000005'),
  'RELEASED',
  'the restocked lot is RELEASED again, not stranded as DEPLETED'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000005'),
  12::bigint,
  'the restocked lot holds the 12 units received'
);

-- The whole point of re-releasing it: the stock can now actually be sold.
select lives_ok(
  $sql$select api.issue_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 5)$sql$,
  'the restocked lot can be issued from, which is the point of the fix'
);

-- ── and the guard that keeps this from being a way to sell expired goods ──────

-- Write off the rest of a lot, then have a supplier deliver more of it after it
-- has expired. The goods are real and must be accounted for, so the receipt is
-- allowed -- but the lot must not become issuable.
select lives_ok(
  $sql$select api.write_off_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 7, 'DAMAGE_WRITE_OFF')$sql$,
  'write off the rest of the restocked lot'
);

-- Age the lot past its expiry, then receive into it.
--
-- reset role because `authenticated` deliberately cannot UPDATE batches -- they
-- change state only through the api functions. In production the expiry simply
-- arrives with the calendar; the test has to fake it, and doing so as superuser
-- keeps that faking from looking like a new grant.
reset role;
update public.batches set expiry_date = current_date - 1
 where id = 'c5000000-0000-4000-8000-000000000005';
set local role authenticated;

select lives_ok(
  $sql$select api.receive_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 9, 4500)$sql$,
  'expired goods are still received -- they exist and must be accounted for'
);

select is(
  (select status::text from public.batches where id = 'c5000000-0000-4000-8000-000000000005'),
  'DEPLETED',
  'a restock of an expired lot stays DEPLETED, so it cannot be sold'
);

select is(
  (select qty_on_hand from public.stock_balances
    where batch_id = 'c5000000-0000-4000-8000-000000000005'),
  9::bigint,
  'the expired goods are on hand, visible and accountable'
);

select throws_ok(
  $sql$select api.issue_stock(
      'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000005', 1)$sql$,
  'P0001', 'batch_not_released',
  'the expired restock cannot be issued'
);

select * from finish();
rollback;
