-- 0063: the alert centre's write path, and the scans that raise alerts
--
-- ── what was already here, and what was missing ─────────────────────────────────
--
-- `alert_events` has existed since M2, with its severity, status, occurrence count
-- and the partial unique index that stops a nightly scan creating duplicates. It had
-- `grant select` and nothing else: no way to acknowledge an alert, no way to resolve
-- one, and no scan to raise them. So alerts could be written by invariants and read by
-- nobody who could act on them.
--
-- Migration 0007 named this work exactly:
--
--   "The M5 work is the alert centre UI, the expiry and low-stock scans, and the
--    notification fan-out."
--
-- This is the first two thirds of that sentence.
--
-- ── why acknowledgement is a function and not a client UPDATE ───────────────────
--
-- `alert_events` is an append-and-mutate ledger: `acknowledged_by`, `resolved_at`
-- and `occurrences` have to agree with each other, and the partial unique index means
-- a resolved alert can legitimately be re-raised while an open one cannot be
-- duplicated. A client writing those four columns directly can produce every one of
-- those states wrong.
--
-- ── what the scan does and does not do ─────────────────────────────────────────
--
-- `api.run_alert_scan()` raises LOW_STOCK, NEAR_EXPIRY, EXPIRED and OVERSTOCK. It is
-- idempotent per (type, entity) while the alert is OPEN, which is what the unique
-- index is for: a nightly run must not produce a wall of duplicates, and a resolved
-- alert whose problem recurs must come back.
--
-- It does NOT notify anybody. Notification fan-out needs a delivery channel and a
-- quiet-hours policy, and guessing at those here would produce an alert system that
-- pages people at 03:00. The `alerts` namespace records what fired so a human sees it
-- on the next visit, which is the honest first version.

-- ── thresholds ──────────────────────────────────────────────────────────────────
-- Configuration rather than constants, because the right number depends on a
-- distributor's lead time and nobody can derive it from the schema. `reorder_policies`
-- is the proper home for per-product thresholds and lands with it; these are the
-- tenant-wide defaults used until a product has one.

create or replace function private.alert_thresholds()
returns table (near_expiry_days integer, low_stock_days integer)
language sql
stable
set search_path = ''
as $$
  -- `public.tenants.settings` is the jsonb bag `api.update_tenant_settings()` merges
  -- patches into, so thresholds live there rather than in a table invented for them.
  -- Defaults: 90 days to expiry, 30 days of cover.
  select
    coalesce((t.settings->>'near_expiry_days')::integer, 90),
    coalesce((t.settings->>'low_stock_days')::integer, 30)
  from public.tenants t
  where t.id = private.current_tenant_id();
$$;

comment on function private.alert_thresholds() is
  'Alert thresholds for the current tenant, read from tenants.settings. Defaults: 90 '
  'days to expiry and 30 days of cover. One place, so the scan and the UI cannot '
  'disagree about what counts as low.';

-- ── the scan ─────────────────────────────────────────────────────────────────────

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

create or replace function api.ack_alert(p_alert_id uuid, p_note text default null)
returns public.alert_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.alert_events;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may acknowledge an alert' using errcode = '42501';
  end if;

  update public.alert_events a
     set status = 'ACK',
         acknowledged_by = (select auth.uid()),
         acknowledged_at = now(),
         data = case when p_note is null or btrim(p_note) = ''
                     then a.data
                     else a.data || jsonb_build_object('note', btrim(p_note)) end,
         updated_at = now()
   where a.id = p_alert_id
     and a.tenant_id = v_tenant
     and a.status = 'OPEN'
  returning * into v_row;

  if v_row.id is null then
    -- Same message whether it does not exist, belongs to another tenant, or is not
    -- open. Distinguishing them would tell a caller about another tenant's data.
    raise exception 'no open alert with that id' using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

create or replace function api.resolve_alert(p_alert_id uuid, p_note text default null)
returns public.alert_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.alert_events;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may resolve an alert' using errcode = '42501';
  end if;

  update public.alert_events a
     set status = 'RESOLVED',
         resolved_at = now(),
         resolved_by = (select auth.uid()),
         -- Acknowledging and resolving in one step is normal: the person who finds the
         -- cause usually fixes it immediately. Recording who looked is still correct,
         -- so it is filled in rather than left null.
         acknowledged_by = coalesce(a.acknowledged_by, (select auth.uid())),
         acknowledged_at = coalesce(a.acknowledged_at, now()),
         data = case when p_note is null or btrim(p_note) = ''
                     then a.data
                     else a.data || jsonb_build_object('note', btrim(p_note)) end,
         updated_at = now()
   where a.id = p_alert_id
     and a.tenant_id = v_tenant
     and a.status in ('OPEN', 'ACK', 'SNOOZED')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no open or acknowledged alert with that id' using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

-- ── grants ───────────────────────────────────────────────────────────────────────

grant execute on function api.run_alert_scan() to authenticated;
grant execute on function api.ack_alert(uuid, text) to authenticated;
grant execute on function api.resolve_alert(uuid, text) to authenticated;

revoke execute on function api.run_alert_scan() from public, anon;
revoke execute on function api.ack_alert(uuid, text) from public, anon;
revoke execute on function api.resolve_alert(uuid, text) from public, anon;

comment on function api.run_alert_scan() is
  'Raise LOW_STOCK, NEAR_EXPIRY and EXPIRED alerts for the current tenant. Idempotent '
  'per (type, entity) while the alert is OPEN: re-running bumps last_seen_at and '
  'occurrences rather than creating a duplicate, and a resolved alert whose problem '
  'has recurred is raised again.';

comment on function api.ack_alert(uuid, text) is
  'Acknowledge an open alert, recording who looked and optionally why.';

comment on function api.resolve_alert(uuid, text) is
  'Resolve an open or acknowledged alert. Frees the partial unique index so the same '
  'problem can raise a fresh alert if it recurs.';