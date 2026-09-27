-- ============================================================================
-- 0010_read_model.sql
-- Reconciliation, the read views, and bilingual catalogue search.
--
-- Everything here is read-path, except the reconciliation job. No write path
-- exists in this file.
-- ============================================================================

-- ── reconciliation ──────────────────────────────────────────────────────────
--
-- A DETECTOR, not a repair mechanism. Since the 0008 trigger maintains the
-- balance from the ledger, drift is not a reachable state; this function's job is
-- to prove that on a schedule and raise a CRITICAL alert if it somehow is not.
--
-- It deliberately does not fix anything. A detector that also repairs can hide
-- the fact that something was wrong, and "the balance was silently corrected
-- last night" is a worse answer than "the balance disagreed with the ledger and
-- here is which row".
--
-- Run from pg_cron in M5; callable here so it can be tested now.

create or replace function private.reconcile_stock_balances()
returns table (
  tenant_id    uuid,
  location_id  uuid,
  product_id   uuid,
  batch_id     uuid,
  balance_qty  bigint,
  ledger_qty   bigint,
  drift        bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with ledger_totals as (
    select l.tenant_id, l.location_id, l.product_id, l.batch_id,
           -- sum() over bigint is numeric; these are counts and the function's
           -- return type is bigint, so cast here rather than letting the drift
           -- arithmetic below silently become numeric.
           sum(l.qty_delta)::bigint as qty
    from public.stock_ledger l
    group by l.tenant_id, l.location_id, l.product_id, l.batch_id
  )
  select
    b.tenant_id, b.location_id, b.product_id, b.batch_id,
    b.qty_on_hand,
    coalesce(t.qty, 0),
    b.qty_on_hand - coalesce(t.qty, 0)
  from public.stock_balances b
  left join ledger_totals t
    on  t.tenant_id   = b.tenant_id
    and t.location_id = b.location_id
    and t.product_id  = b.product_id
    and t.batch_id    = b.batch_id
  where b.qty_on_hand <> coalesce(t.qty, 0)

  union all

  -- Keys with ledger movements but no balance row at all. A LEFT JOIN from
  -- stock_balances would miss these, which is exactly the state a missing insert
  -- would produce, so the other direction is checked too.
  select
    t.tenant_id, t.location_id, t.product_id, t.batch_id,
    null::bigint,
    t.qty,
    -t.qty
  from ledger_totals t
  where not exists (
    select 1 from public.stock_balances b
    where b.tenant_id = t.tenant_id
      and b.location_id = t.location_id
      and b.product_id = t.product_id
      and b.batch_id = t.batch_id
  );
end;
$$;

comment on function private.reconcile_stock_balances is
  'Returns every balance key where stock_balances disagrees with the sum of the '
  'ledger, in both directions. Detection only: it does not repair, because a '
  'silent repair is worse than a reported disagreement.';

-- Raise the alert. Kept separate from the detection query so the detection can be
-- tested without writing rows.
create or replace function private.raise_drift_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    record;
  v_tenant uuid;
  v_count  integer := 0;
begin
  for v_row in
    select * from private.reconcile_stock_balances()
  loop
    v_tenant := v_row.tenant_id;

    -- The partial unique index on (tenant, type, entity) where status = 'OPEN'
    -- means a repeated nightly detection updates the existing alert rather than
    -- creating a new one every night.
    insert into public.alert_events (
      tenant_id, type, severity, entity_type, entity_id, message, data
    )
    values (
      v_tenant, 'STOCK_DRIFT', 'CRITICAL', 'stock_balance',
      v_row.location_id::text || ':' || v_row.product_id::text || ':' || v_row.batch_id::text,
      'stock balance does not match the ledger',
      json_build_object(
        'location_id', v_row.location_id,
        'product_id',  v_row.product_id,
        'batch_id',    v_row.batch_id,
        'balance_qty', v_row.balance_qty,
        'ledger_qty',  v_row.ledger_qty,
        'drift',       v_row.drift
      )
    )
    -- The conflict target must mirror the partial unique index exactly, INCLUDING
    -- the expression and the WHERE clause. A bare `on conflict do update` is a
    -- syntax error, not a no-op: "requires inference specification or constraint
    -- name". Getting it wrong here is what stops a nightly job from creating
    -- hundreds of duplicate alerts, so the target is spelled out rather than
    -- guessed at.
    on conflict (tenant_id, type, entity_type, (coalesce(entity_id, '')))
      where status = 'OPEN'
    do update
      set last_seen_at = now(),
          occurrences  = public.alert_events.occurrences + 1,
          -- Recomputing detail on repeat, so a drift that is getting worse is
          -- visible rather than being frozen at the first detection.
          data         = excluded.data;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ── read views ──────────────────────────────────────────────────────────────
--
-- Every one is declared `with (security_invoker = true)`.
--
-- Postgres creates a view as SECURITY DEFINER by default, which means a view
-- over a protected table hands out every row the policies withheld -- the view
-- would run as its owner, not as the caller. security_invoker makes the view run
-- with the caller's privileges, so RLS on the base table applies.
--
-- All are pure SQL with no private.* calls, because a client-held view cannot
-- reach a schema whose USAGE has been revoked from client roles.

create or replace view public.v_inventory_by_batch
with (security_invoker = true)
as
select
  sb.tenant_id,
  sb.batch_id,
  sb.product_id,
  sb.location_id,
  l.facility_id,
  l.code                                   as location_code,
  l.kind                                   as location_kind,
  bt.lot_number,
  bt.mfg_date,
  bt.expiry_date,
  bt.status                                as batch_status,
  bt.unit_cost_minor,
  coalesce(sb.qty_on_hand, 0)              as qty_on_hand,
  coalesce(sb.qty_reserved, 0)             as qty_reserved,
  coalesce(sb.qty_on_hand, 0) - coalesce(sb.qty_reserved, 0) as qty_available,
  -- Integer date subtraction: no timezone, no time component, and a batch
  -- expiring today reads as 0 rather than as -1.
  (bt.expiry_date - current_date)          as days_to_expiry,
  coalesce(sb.qty_on_hand, 0) * bt.unit_cost_minor as stock_value_minor,
  sb.updated_at
from public.stock_balances sb
join public.batches bt on bt.id = sb.batch_id
join public.storage_locations l on l.id = sb.location_id
where bt.deleted_at is null;

comment on view public.v_inventory_by_batch is
  'Stock by batch and location, with days to expiry and stock value. The grain an '
  'admin, a pharmacist and an FEFO allocator all need.';

-- One row per product per facility. Rollup, because "how much paracetamol does the
-- warehouse hold" is the question a manager asks and summing batches in the UI
-- would be both slow and wrong the moment two batches share an expiry.
create or replace view public.v_inventory_by_product
with (security_invoker = true)
as
select
  tenant_id,
  product_id,
  facility_id,
  location_id,
  sum(qty_on_hand)::bigint            as qty_on_hand,
  sum(qty_reserved)::bigint           as qty_reserved,
  sum(qty_available)::bigint          as qty_available,
  count(*) filter (where qty_available > 0)                as batch_count,
  count(*) filter (where batch_status = 'RELEASED' and qty_available > 0) as released_batches,
  min(expiry_date) filter (where qty_available > 0)        as earliest_expiry,
  min(days_to_expiry) filter (where qty_available > 0)     as days_to_earliest_expiry,
  sum(stock_value_minor)::bigint       as stock_value_minor
from public.v_inventory_by_batch
group by tenant_id, product_id, facility_id, location_id;

-- One row per PRODUCT across the whole tenant. This is the aggregate a catalogue
-- search needs: "how much of this do we hold in total".
--
-- Distinct from v_inventory_by_product, which is per product AND location, and
-- which would multiply a single product across every shelf it sits on. Joining
-- that into search_products would return one row per location, so a search for a
-- product in three locations would show three rows and a total_count three times
-- too large.
create or replace view public.v_product_stock_total
with (security_invoker = true)
as
select
  tenant_id,
  product_id,
  -- sum() over bigint yields numeric, which supabase-js delivers as a string.
  -- These are counts, so they are cast back to bigint here rather than leaking a
  -- numeric into a column that api.search_products() declares as bigint.
  sum(qty_on_hand)::bigint                          as qty_on_hand,
  sum(qty_reserved)::bigint                         as qty_reserved,
  sum(qty_available)::bigint                        as qty_available,
  min(expiry_date) filter (where qty_available > 0) as earliest_expiry,
  min(days_to_expiry) filter (where qty_available > 0) as days_to_earliest_expiry,
  sum(stock_value_minor)::bigint                    as stock_value_minor
from public.v_inventory_by_batch
group by tenant_id, product_id;

-- The expiry report. The buckets are the WHO GDP alert windows: 30 days is the
-- operational deadline, 90 is the planning horizon at which a return to supplier
-- is still possible.
create or replace view public.v_expiry_report
with (security_invoker = true)
as
select
  v.tenant_id,
  v.product_id,
  p.sku,
  p.name_en,
  p.name_ar,
  v.batch_id,
  v.lot_number,
  v.location_id,
  v.facility_id,
  v.expiry_date,
  v.days_to_expiry,
  v.qty_on_hand,
  v.qty_available,
  v.unit_cost_minor,
  v.stock_value_minor,
  case
    when v.days_to_expiry <  0 then 'EXPIRED'
    when v.days_to_expiry <= 30 then 'CRITICAL'
    when v.days_to_expiry <= 90 then 'WARNING'
    else 'OK'
  end as expiry_band
from public.v_inventory_by_batch v
join public.products p on p.id = v.product_id
where v.qty_available > 0
   or v.qty_on_hand <> 0;

comment on view public.v_expiry_report is
  'Batches with stock, banded by remaining shelf life. Bands are the GDP alert '
  'windows: 30 days operational, 90 days planning.';

create or replace view public.v_stock_valuation
with (security_invoker = true)
as
select
  v.tenant_id,
  v.product_id,
  p.sku,
  p.name_en,
  p.name_ar,
  sum(v.qty_on_hand)::bigint                as qty_on_hand,
  sum(v.stock_value_minor)::bigint          as value_minor,
  -- Average cost per unit, guarded against a zero-quantity division. When stock
  -- has been fully written off the balance is 0 and the division has no answer.
  case when sum(v.qty_on_hand) > 0
       then (sum(v.stock_value_minor) / sum(v.qty_on_hand))::bigint
       else 0::bigint
  end                                       as avg_unit_cost_minor
from public.v_inventory_by_batch v
join public.products p on p.id = v.product_id
group by v.tenant_id, v.product_id, p.sku, p.name_en, p.name_ar;

-- ── a tenant source the read path can use ──────────────────────────────────
--
-- The read functions below are SECURITY INVOKER, so RLS applies to every row
-- they read. That is the correct shape for a read: the database decides what the
-- caller may see.
--
-- They therefore cannot call private.current_tenant_id(), which is unreachable
-- from a client session. This is the invoker-safe equivalent: it reads the
-- caller's own profile row, which the "read own profile" RLS policy already
-- permits, and returns NULL when there is no session or the profile is inactive.
--
-- It is a view onto the caller's own identity, not a way to ask about anyone
-- else's: the id is auth.uid(), never a parameter.

create or replace function api.current_tenant_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

comment on function api.current_tenant_id() is
  'The caller''s tenant, readable from an invoker context. private.current_tenant_id() '
  'is unreachable from a client session, so read-path functions use this. Returns '
  'NULL when unauthenticated, which makes a tenant comparison false and the '
  'function return no rows rather than error.';

-- ── bilingual catalogue search ──────────────────────────────────────────────
--
-- A function rather than a plain table query, for three reasons:
--   1. both scripts are searched in one pass, so a Latin query cannot skip rows
--      whose only match is in Arabic
--   2. the total count comes back in the same round trip, which pagination needs
--   3. the result is paginated in SQL rather than by over-fetching and slicing,
--      so page 500 of the catalogue does not read 20,000 rows
--
-- The trigram index from 0006 serves the ILIKE pattern.

create or replace function api.search_products(
  p_query       text default null,
  p_expiry_band text default null,
  p_limit       integer default 50,
  p_offset      integer default 0
)
returns table (
  total_count      bigint,
  id               uuid,
  sku              text,
  name_en          text,
  name_ar          text,
  generic_name_en  text,
  generic_name_ar  text,
  brand            text,
  form             private.product_form,
  strength         text,
  pack_size        integer,
  uom              private.stock_unit,
  atc_code         text,
  gtin             text,
  requires_prescription boolean,
  is_cold_chain    boolean,
  is_active        boolean,
  qty_on_hand      bigint,
  qty_available    bigint,
  earliest_expiry  date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := api.current_tenant_id();
  v_query  text := nullif(btrim(coalesce(p_query, '')), '');
  -- Capped because a client asking for 100,000 rows is a bug, and an unbounded
  -- query against a large catalogue is a denial of service with extra steps.
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_tenant is null then
    return;
  end if;

  return query
  with matched as (
    select
      p.id, p.sku, p.name_en, p.name_ar,
      p.generic_name_en, p.generic_name_ar, p.brand, p.form, p.strength,
      p.pack_size, p.uom, p.atc_code, p.gtin,
      p.requires_prescription, p.is_cold_chain, p.is_active,
      coalesce(inv.qty_on_hand, 0)   as qty_on_hand,
      coalesce(inv.qty_available, 0) as qty_available,
      inv.earliest_expiry
    from public.products p
    left join public.v_product_stock_total inv
      on  inv.tenant_id  = p.tenant_id
      and inv.product_id = p.id
    where p.tenant_id = v_tenant
      and (
        v_query is null
        or p.name_en         ilike '%' || v_query || '%'
        or p.name_ar         ilike '%' || v_query || '%'
        or p.generic_name_en ilike '%' || v_query || '%'
        or p.generic_name_ar ilike '%' || v_query || '%'
        or coalesce(p.brand, '') ilike '%' || v_query || '%'
        or p.sku            ilike '%' || v_query || '%'
        or coalesce(p.atc_code, '') ilike '%' || v_query || '%'
        or coalesce(p.gtin, '')   ilike '%' || v_query || '%'
      )
      -- The expiry filter is applied against the product's earliest expiring
      -- batch, which is what a buyer means by "show me short-dated stock".
      and (
        p_expiry_band is null
        or (
          case
            when inv.days_to_earliest_expiry is null then 'NONE'
            when inv.days_to_earliest_expiry <  0  then 'EXPIRED'
            when inv.days_to_earliest_expiry <= 30 then 'CRITICAL'
            when inv.days_to_earliest_expiry <= 90 then 'WARNING'
            else 'OK'
          end
        ) = p_expiry_band
      )
  )
  select
    count(*) over () as total_count,
    m.id, m.sku, m.name_en, m.name_ar,
    m.generic_name_en, m.generic_name_ar, m.brand, m.form, m.strength,
    m.pack_size, m.uom, m.atc_code, m.gtin,
    m.requires_prescription, m.is_cold_chain, m.is_active,
    m.qty_on_hand, m.qty_available, m.earliest_expiry
  from matched m
  -- Deterministic ordering, because pagination without a total order returns the
  -- same row on two different pages.
  order by lower(m.name_en), m.sku
  limit v_limit
  offset v_offset;
end;
$$;

comment on function api.search_products is
  'Bilingual catalogue search with server-side pagination. Returns the total count '
  'in the same row set so a pager does not need a second round trip. Ordering is '
  'deterministic because LIMIT/OFFSET without a total order repeats and skips '
  'rows across pages.';

-- ── the reference lookups the UI needs ──────────────────────────────────────

create or replace function api.get_product(p_product_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(r)
  from (
    select
      p.*,
      coalesce(inv.qty_on_hand, 0)   as qty_on_hand,
      coalesce(inv.qty_available, 0) as qty_available,
      inv.earliest_expiry
    from public.products p
    left join public.v_product_stock_total inv
      on  inv.tenant_id  = p.tenant_id
      and inv.product_id = p.id
    where p.id = p_product_id
      and p.tenant_id = api.current_tenant_id()
  ) r
$$;

create or replace function api.get_batch_stock(p_batch_id uuid)
returns table (
  batch_id      uuid,
  product_id    uuid,
  product_name_en text,
  product_name_ar text,
  lot_number    text,
  mfg_date      date,
  expiry_date   date,
  days_to_expiry integer,
  status        private.batch_status,
  unit_cost_minor bigint,
  location_id   uuid,
  location_code text,
  facility_id   uuid,
  qty_on_hand   bigint,
  qty_reserved  bigint,
  qty_available bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.batch_id, v.product_id, p.name_en, p.name_ar, v.lot_number,
    v.mfg_date, v.expiry_date, v.days_to_expiry, v.batch_status,
    v.unit_cost_minor, v.location_id, v.location_code, v.facility_id,
    v.qty_on_hand, v.qty_reserved, v.qty_available
  from public.v_inventory_by_batch v
  join public.products p on p.id = v.product_id
  where v.batch_id = p_batch_id
    and v.tenant_id = api.current_tenant_id()
  order by v.expiry_date
$$;

comment on function api.get_batch_stock is
  'Every location holding a given batch, ordered by expiry. This is the "where is '
  'lot X right now" question, and it is the first thing needed for a recall.';

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- The read views are granted to authenticated, and RLS on their base tables is
-- what limits them.
--
-- A view is a privilege-bearing object like any other: revoking the default
-- PUBLIC grant and forgetting to add authenticated back does not "hide" the view,
-- it breaks it. Every SELECT against it fails with "permission denied for view",
-- which is indistinguishable from a query bug when you are reading a stack trace
-- at 2am. Granted explicitly here so the omission cannot recur.

revoke all on
  public.v_inventory_by_batch,
  public.v_inventory_by_product,
  public.v_product_stock_total,
  public.v_expiry_report,
  public.v_stock_valuation
  from anon, authenticated;

grant select on
  public.v_inventory_by_batch,
  public.v_inventory_by_product,
  public.v_product_stock_total,
  public.v_expiry_report,
  public.v_stock_valuation
  to authenticated;

revoke all on all functions in schema api from public;
grant execute on all functions in schema api to authenticated;
