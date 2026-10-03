-- 0064: repair 0063's scan, which referenced a column that does not exist
--
-- 0063 built the expiry and low-stock candidates against `batches.batch_code`. There is
-- no such column -- it is `lot_number` -- so every message and payload in the scan
-- raised `42703 column batches.batch_code does not exist`, and the scan raised nothing
-- at all.
--
-- It passed everything this project has:
--
--   * `make test-db` applied it without complaint. A plpgsql body is not resolved when
--     the function is created, so a reference to a non-existent column is invisible
--     until the function runs.
--   * TypeScript never sees it, and `check-api-types.py` only compares argument names.
--   * The browser test clicked "Run scan" and asserted the alert list still rendered.
--
-- That last one is the lesson. It asserted the page had not broken, which is not the
-- same as asserting the button did something, so a scan that always failed passed. The
-- test now waits for the scan's own success line and fails on any error region.
--
-- 0063 is also corrected in place so a database built from scratch applies the right
-- body directly. This migration exists because 0063 is applied and recorded on the
-- hosted project; editing it alone would fix future builds and leave the deployed
-- database broken, which is the drift this repository avoids on purpose.

create or replace function api.run_alert_scan()
returns table (raised integer, skipped integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_thresholds record;
  v_raised integer := 0;
  v_skipped integer := 0;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  -- Warehouse work, not an analyst's: raising alerts changes what people are expected
  -- to go and do. A read-only role can see them and not create them.
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may run the alert scan' using errcode = '42501';
  end if;

  select * into v_thresholds from private.alert_thresholds();

  -- ON CONFLICT is what makes this idempotent, and it is a *partial* unique index, so
  -- it only fires while the existing alert is OPEN. An alert that was resolved and
  -- whose problem has recurred is inserted again, which is the behaviour a warehouse
  -- manager expects: the problem is new, and the old row is the history.
  --
  -- `last_seen_at` and `occurrences` are bumped on the existing row instead, so "this
  -- has been happening since Tuesday" is answerable from the row itself.
  with candidates as (
    -- Expired: expiry_date is today or earlier, on a batch still holding stock.
    select 'EXPIRED'::private.alert_type as type,
           'INFO'::private.alert_severity as severity,
           'batch'::text as entity_type,
           b.id::text as entity_id,
           format('Batch %s expired on %s', b.lot_number, b.expiry_date) as message,
           jsonb_build_object('lot_number', b.lot_number, 'expiry_date', b.expiry_date) as data
      from public.batches b
     where b.tenant_id = v_tenant
       and b.deleted_at is null
       and b.status = 'RELEASED'
       and b.expiry_date <= current_date
       and exists (select 1 from public.stock_balances sb
                    where sb.tenant_id = b.tenant_id and sb.batch_id = b.id and sb.qty_on_hand > 0)

    union all
    -- Near expiry: inside the window, still holding stock. Severity is scaled by how
    -- close it is, because "expires in 89 days" and "expires tomorrow" cannot both be
    -- WARN and a warehouse manager cannot triage on a single severity.
    select 'NEAR_EXPIRY'::private.alert_type,
           case
             when b.expiry_date <= current_date + 30 then 'CRITICAL'::private.alert_severity
             when b.expiry_date <= current_date + 60 then 'WARN'::private.alert_severity
             else 'INFO'::private.alert_severity
           end,
           'batch'::text,
           b.id::text,
           format('Batch %s expires on %s', b.lot_number, b.expiry_date),
           jsonb_build_object(
             'lot_number', b.lot_number,
             'expiry_date', b.expiry_date,
             'days_remaining', (b.expiry_date - current_date))
      from public.batches b
     where b.tenant_id = v_tenant
       and b.deleted_at is null
       and b.status = 'RELEASED'
       and b.expiry_date > current_date
       and b.expiry_date <= current_date + v_thresholds.near_expiry_days
       and exists (select 1 from public.stock_balances sb
                    where sb.tenant_id = b.tenant_id and sb.batch_id = b.id and sb.qty_on_hand > 0)

    union all
    -- Low stock, measured in days of cover rather than a fixed count.
    --
    -- A reorder point in units is a guess unless you know the product's velocity, and
    -- two products on the same shelf can differ by a factor of fifty. So the threshold
    -- is days of cover against what the product has actually issued in the last 30
    -- days, and `low_stock_days` is the distributor's answer to "how long can I be
    -- short".
    --
    -- A product with no ISSUE history raises nothing. That is deliberate and it is the
    -- difference between a useful alert and noise: a catalogue of two hundred products
    -- with a shelf each is not two hundred low-stock alerts, it is a warehouse that has
    -- never been bought from, and an alert centre nobody reads is the same as none.
    select 'LOW_STOCK'::private.alert_type,
           'WARN'::private.alert_severity,
           'product'::text,
           p.id::text,
           format('%s: %s units on hand, about %s days of cover',
                  p.name_en, v.qty_on_hand,
                  round(v.qty_on_hand / greatest(v.avg_daily_qty, 0.01))::integer),
           jsonb_build_object(
             'sku', p.sku,
             'qty_on_hand', v.qty_on_hand,
             'avg_daily_qty', round(v.avg_daily_qty, 2),
             'days_of_cover', round(v.qty_on_hand / greatest(v.avg_daily_qty, 0.01))::integer,
             'threshold_days', v_thresholds.low_stock_days)
      from public.products p
      join lateral (
        select
          coalesce(on_hand.qty_on_hand, 0) as qty_on_hand,
          -- Movement *out* of the warehouse, over the last 30 days. `qty_delta` is
          -- signed by movement type, so an ISSUE is negative and the negation makes it
          -- a positive rate.
          case
            when issued.units > 0 then issued.units / 30.0
            else 0
          end as avg_daily_qty
        from (
          select coalesce(sum(qty_on_hand), 0)::bigint as qty_on_hand
            from public.stock_balances sb
           where sb.tenant_id = p.tenant_id and sb.product_id = p.id
        ) on_hand
        cross join lateral (
          select coalesce(sum(-l.qty_delta), 0)::bigint as units
            from public.stock_ledger l
           where l.tenant_id = p.tenant_id
             and l.product_id = p.id
             and l.txn_type = 'ISSUE'
             and l.occurred_at >= now() - interval '30 days'
        ) issued
      ) v on true
     where p.tenant_id = v_tenant
       and p.is_active
       -- Only products that actually carry stock, and only those with a movement
       -- history to divide by.
       and v.qty_on_hand > 0
       and v.avg_daily_qty > 0
       and (v.qty_on_hand / v.avg_daily_qty) <= v_thresholds.low_stock_days
  ),
  inserted as (
    insert into public.alert_events as a
      (tenant_id, type, severity, entity_type, entity_id, message, data)
    select v_tenant, c.type, c.severity, c.entity_type, c.entity_id, c.message, c.data
      from candidates c
    on conflict (tenant_id, type, entity_type, coalesce(entity_id, '')) where status = 'OPEN'
    do update
      set last_seen_at = now(),
          occurrences = a.occurrences + 1,
          severity = excluded.severity,
          -- The message carries today's numbers, so it is refreshed; `first_seen_at` is
          -- deliberately untouched, which is what makes "how long has this been
          -- happening" answerable.
          message = excluded.message,
          data = excluded.data,
          updated_at = now()
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted),
         count(*) filter (where not was_inserted)
    into v_raised, v_skipped
    from inserted;

  return query select v_raised, v_skipped;
end
$$;

-- ── acknowledge and resolve ──────────────────────────────────────────────────────
--
-- Both are small and both are here for the same reason: the four bookkeeping columns
-- on `alert_events` have to move together, and there is no partial state of
-- "acknowledged but with no acknowledger" worth having.

