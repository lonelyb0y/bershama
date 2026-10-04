-- 0072: daily stock snapshots, and the reader that turns them into a trend.
--
-- ── the gap ────────────────────────────────────────────────────────────────────────
--
-- Every stock figure in this system is computed live by aggregating the ledger:
--
--     on hand      = sum(stock_balances.qty_on_hand)
--     inventory value = sum(qty_on_hand * unit_cost)
--     days of cover   = on_hand / (movement out / N)
--
-- That is correct and it is fine for a screen showing *now*. It is the wrong shape for
-- two things the dashboard and analytics both want:
--
--   * a trend. "Expiry value at risk" today tells you what is at risk today. Whether it
--     is rising tells you whether your buying is getting worse, and that cannot be
--     answered from a table that has forgotten last month.
--   * a page that stays quick as the ledger grows. The ledger is the largest table here
--     and grows with every movement forever; re-aggregating a growing window to draw a
--     fixed chart gets slower every month and there is no point at which it stops.
--
-- So the daily figure is written once and read many times. This is the classic
-- materialised-view trade, and it is worth being clear that it introduces a real cost:
-- **the snapshot is a record of what was true, not what is true.** If a movement lands
-- after the nightly snapshot, today's row is stale until it is recomputed.
--
-- ── why the snapshot is written explicitly, not by trigger ──────────────────────────
--
-- A trigger that snapshots on every movement would be correct-looking and wrong in
-- practice: it would write a row per movement rather than per day, turning the thing
-- built to stop aggregating the ledger into the largest table in the system. Snapshots are
-- therefore taken deliberately -- on demand, or nightly -- and the function is
-- idempotent per day so re-running it corrects a day rather than duplicating it.
--
-- ── why the value is stored, not recomputed ────────────────────────────────────────
--
-- Because unit cost changes. Recomputing yesterday's inventory value from *today's*
-- costs would silently restate history every time a price is corrected, and a chart whose
-- past moves when you fix a price is not a chart anybody can act on. The value as it was
-- known at the time is the record.

create table if not exists public.stock_daily_snapshots (
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,

  -- The day this row describes, in the tenant's local calendar. Not a timestamp: a
  -- snapshot is a whole day, and storing midnight local as an instant makes "which day is
  -- this" depend on the reader's timezone.
  snapshot_on date not null,

  qty_on_hand     bigint not null default 0 check (qty_on_hand >= 0),
  qty_reserved    bigint not null default 0 check (qty_reserved >= 0),
  -- Minor units, like every other money column in this schema. See ADR 0002.
  value_minor     bigint not null default 0 check (value_minor >= 0),

  -- Batches whose expiry falls within the horizon the analytics page already uses. Stored
  -- rather than derived because "value at risk in 90 days" is the question, and deriving it
  -- later from batches that have since been issued or deleted gives a different answer than
  -- the one that was true.
  --
  -- NOT NULL, and deliberately so. An earlier version of this made them nullable, to carry
  -- "no expiry date on hand" as distinct from zero. That is a distinction this schema cannot
  -- express: `batches.expiry_date` is NOT NULL, so every batch has an expiry and the unknown
  -- case cannot occur. A nullable column with a branch that is never taken is a claim about
  -- the domain that the database does not actually support, and it invites every future
  -- reader to handle a state that never occurs.
  expiry_risk_minor bigint not null default 0 check (expiry_risk_minor >= 0),
  at_risk_batches   integer not null default 0 check (at_risk_batches >= 0),

  created_at timestamptz not null default now(),

  -- One row per product per facility per day. This is the constraint that makes re-running
  -- a day's snapshot a correction rather than a duplicate.
  constraint stock_daily_snapshots_day_key unique (product_id, facility_id, snapshot_on)
);

comment on table public.stock_daily_snapshots is
  'End-of-day stock position per product and facility, written once and read many times. A '
  'record of what was true on that day, not a live figure: a movement after the snapshot '
  'makes the row stale until it is recomputed.';
comment on column public.stock_daily_snapshots.snapshot_on is
  'The calendar day described, as a date. A snapshot is a whole day, so a timestamp would '
  'make "which day" depend on the reader timezone.';
comment on column public.stock_daily_snapshots.expiry_risk_minor is
  'Value of batches expiring within the 90-day risk horizon. Not nullable: every batch has '
  'a required expiry date, so "unknown" is not a state this schema can represent.';

create index if not exists stock_daily_snapshots_tenant_day_idx
  on public.stock_daily_snapshots (tenant_id, snapshot_on desc);
create index if not exists stock_daily_snapshots_product_idx
  on public.stock_daily_snapshots (product_id, snapshot_on desc);

-- ── read access ────────────────────────────────────────────────────────────────────
--
-- Anyone who can already read stock. Reorder policies are read by the same people, and
-- the analytics page aggregates over this.
--
-- Driver is absent and cannot gain access by accident: private.has_role grants only the
-- roles named here.

alter table public.stock_daily_snapshots enable row level security;

create policy "stock readers see snapshots"
  on public.stock_daily_snapshots
  for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role(variadic array[
      'TENANT_ADMIN'::private.app_role,
      'WAREHOUSE_MANAGER'::private.app_role,
      'PHARMACY_MANAGER'::private.app_role,
      'ANALYST'::private.app_role
    ]))
  );

-- ── the writer ─────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER, and it is the *only* writer: a snapshot is a statement about a whole
-- day's position, and a client able to write one row could assert that stock was whatever
-- it liked on any date in the past.
--
-- Idempotent per day, because a snapshot that duplicates on re-run makes every trend wrong
-- in a way that is very hard to see and very easy to cause.

create or replace function api.snapshot_stock(
  p_snapshot_on date default null,
  p_facility_id uuid default null
)
returns table (
  snapshot_on date,
  products_written integer,
  total_value_minor bigint,
  at_risk_value_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day   date := coalesce(p_snapshot_on, (now() at time zone 'Africa/Cairo')::date);
  v_roles integer;
  v_value bigint;
  v_risk  bigint;
begin
  -- Same reasoning as api.reset_demo_run: service_role has no profile so its role is null
  -- and null means "the service role"; anything else has to clear the gate.
  if (select private.current_role()) is not null
     and not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may snapshot stock' using errcode = '42501';
  end if;

  -- Not today, unless asked. A snapshot of a day still in progress is wrong in a way that
  -- looks right: the movement that lands at 4pm is missing, and the chart shows a dip that
  -- did not happen. Backfilling is allowed because that is the point -- correcting a closed
  -- day is a legitimate operation, and pretending it is impossible would just mean people
  -- cannot fix anything.
  if v_day > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'cannot snapshot a future day' using errcode = '22023';
  end if;

  -- One plain INSERT, then one aggregate. No CTE.
  --
  -- An earlier version put the insert in a data-modifying CTE and took the function's own
  -- figures from a second pass. That is defensible in plain SQL and was awkward in PL/pgSQL
  -- -- a bare WITH followed by SELECT ... INTO parses as a syntax error, which is the kind
  -- of thing that costs an afternoon. The subquery below gives the same grouping without
  -- the statement-level complication.
  --
  -- The join is on batch_id and nothing else. An earlier version aggregated balances by
  -- product first and then joined batches on product_id to recover a cost, which is wrong
  -- twice: it discards which lot a quantity belongs to and then re-joins on the one key
  -- that cannot recover it, so every batch multiplies every balance row of that product.
  -- stock_balances is already keyed by (location, product, batch), so the batch is one join
  -- away and grouping at the end is what produces the snapshot grain.
  insert into public.stock_daily_snapshots (
    tenant_id, product_id, facility_id, snapshot_on,
    qty_on_hand, qty_reserved, value_minor, expiry_risk_minor, at_risk_batches
  )
  select
    (select private.current_tenant_id()),
    v.product_id,
    v.facility_id,
    v_day,
    v.qty_on_hand,
    v.qty_reserved,
    v.value_minor,
    v.expiry_risk_minor,
    v.at_risk_batches
  from (
    select
      b.product_id,
      l.facility_id,
      sum(b.qty_on_hand)  as qty_on_hand,
      sum(b.qty_reserved) as qty_reserved,
      -- A product with several lots at different costs is valued at what each lot actually
      -- cost, because that is the only version of this number that reconciles with the
      -- batch it came from. One product-level price would silently redistribute value
      -- between lots and stop agreeing with the batch ledger.
      coalesce(sum(b.qty_on_hand * bat.unit_cost_minor), 0) as value_minor,
      -- Every batch has an expiry date (NOT NULL), so this is always computable and is a
      -- real zero for non-perishable stock rather than unknown.
      coalesce(
        sum(b.qty_on_hand * bat.unit_cost_minor)
          filter (where bat.expiry_date <= current_date + 90),
        0
      ) as expiry_risk_minor,
      count(*) filter (where bat.expiry_date <= current_date + 90) as at_risk_batches
    from public.stock_balances b
    join public.storage_locations l on l.id = b.location_id
    join public.batches bat on bat.id = b.batch_id
    where b.tenant_id = (select private.current_tenant_id())
      and (p_facility_id is null or l.facility_id = p_facility_id)
    group by b.product_id, l.facility_id
  ) v
  -- Conflict target by constraint, not by column names. RETURNS TABLE declares an OUT
  -- parameter called snapshot_on, which is a PL/pgSQL variable in scope for the whole
  -- body, so naming that column here is ambiguous against it. Naming the constraint
  -- sidesteps the shadowing and is stricter besides: it fails loudly if the unique key is
  -- ever renamed or dropped.
  on conflict on constraint stock_daily_snapshots_day_key do update
    set qty_on_hand       = excluded.qty_on_hand,
        qty_reserved      = excluded.qty_reserved,
        value_minor       = excluded.value_minor,
        expiry_risk_minor = excluded.expiry_risk_minor,
        at_risk_batches   = excluded.at_risk_batches;

  -- The figures, from the rows just written. Cheap: one indexed scan of a single day.
  select
    count(*)::integer,
    coalesce(sum(s.value_minor), 0),
    coalesce(sum(s.expiry_risk_minor), 0)
  into v_roles, v_value, v_risk
  from public.stock_daily_snapshots s
  where s.tenant_id = (select private.current_tenant_id())
    and s.snapshot_on = v_day
    and (p_facility_id is null or s.facility_id = p_facility_id);

  return query select v_day, v_roles, v_value, v_risk;
end
$$;

comment on function api.snapshot_stock(date, uuid) is
  'Write or correct the stock position for one day. Idempotent: re-running corrects the '
  'day rather than duplicating it. Refuses a future day, since a snapshot of a day still in '
  'progress is missing the movements that have not happened yet.';

revoke execute on function api.snapshot_stock(date, uuid) from public, anon;
grant execute on function api.snapshot_stock(date, uuid) to authenticated;

notify pgrst, 'reload schema';