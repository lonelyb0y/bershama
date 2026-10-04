-- 0071: per-product reorder policies, and the function that reads them.
--
-- ── the gap ────────────────────────────────────────────────────────────────────────
--
-- The alert centre already answers "which products are running low", and it answers it
-- with a single number for the whole tenant:
--
--     settings->>'low_stock_days', defaulting to 14
--
-- One threshold for everything is wrong in a way that shows up immediately in a real
-- pharmacy. Paracetamol and insulin do not have the same reorder point, and neither does a
-- seasonal paediatric syrup and a box of gloves. Worse, the threshold is expressed in
-- *days of cover*, which for a product with no outbound movement at all is infinite -- so
-- the one item most obviously worth stocking quietly never alerts.
--
-- So the threshold becomes per product, per facility, and expressed in the two units a
-- buyer actually reasons in: a unit count to reorder *at*, and a level to order *up to*.
--
-- ── why policy is data and not code ────────────────────────────────────────────────
--
-- Because it is a commercial decision that changes per product, per supplier contract and
-- per season. Encoding "reorder amoxicillin at 200 units" in a migration makes it
-- impossible to change without a deployment, which is exactly the wrong property for the
-- most frequently adjusted number in a pharmacy's system.
--
-- ── why facility-scoped ───────────────────────────────────────────────────────────
--
-- Stock lives per location (stock_balances is keyed by location, not facility), and a
-- central warehouse and a branch pharmacy reorder on completely different schedules. A
-- policy that cannot say *where* it applies cannot answer either of them.
--
-- ── what this deliberately does not do ─────────────────────────────────────────────
--
-- It does not create purchase orders. M5 defers those, and a reorder policy that
-- auto-generated orders would be a much larger commitment than the evidence in this
-- schema supports. This is the arithmetic; raising the order is a human decision.

create table if not exists public.reorder_policies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,

  -- The reorder point, in the product's own unit of measure. Reorder *at or below* this.
  min_qty     numeric not null check (min_qty >= 0),

  -- Order-up-to level. Also the suggested order quantity's ceiling: a buyer wanting to
  -- reach the maximum has to order the difference, and storing both means the suggestion
  -- cannot be computed as something that overshoots on its own.
  max_qty     numeric not null check (max_qty >= 0),

  -- Days between placing an order and receiving it. Not used to raise an alert -- that
  -- would need a reliable order history this schema does not have -- but it is what makes
  -- the lead time visible on the reorder list, which is the number a buyer negotiates on.
  lead_time_days integer not null default 7 check (lead_time_days >= 0),

  -- When false, the policy stops producing suggestions without being deleted. Soft
  -- disable, because "we stopped stocking this" is not the same statement as "delete our
  -- settings", and a deleted row is evidence somebody cared about this once.
  is_active   boolean not null default true,

  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One policy per product per facility. Without this a second row would silently
  -- compete with the first and the reader would have to guess which wins.
  constraint reorder_policies_product_facility_key unique (product_id, facility_id),

  -- The invariant that makes the pair meaningful. min_qty > max_qty describes a policy
  -- that would reorder a product to *less* than the level at which it reorders, which is
  -- not a small mistake: it produces a purchase suggestion that increases nothing and the
  -- alert fires again immediately after receipt.
  constraint reorder_policies_min_below_max check (min_qty < max_qty)
);

comment on table public.reorder_policies is
  'Per product, per facility reorder point and order-up-to level. Replaces the single '
  'tenant-wide low_stock_days threshold, which cannot express that two products in the '
  'same pharmacy have different reorder points.';
comment on column public.reorder_policies.min_qty is
  'Reorder at or below this quantity, in the product''s own unit of measure.';
comment on column public.reorder_policies.max_qty is
  'Order up to this quantity. The suggested order quantity is max_qty - available.';

create index if not exists reorder_policies_tenant_idx
  on public.reorder_policies (tenant_id);

-- ── read access ────────────────────────────────────────────────────────────────────
--
-- The people who reorder. A pharmacy manager restocks their own shelves; a warehouse
-- manager restocks the depot. An analyst reads it to answer "what would we have to order
-- if we ran out of everything tomorrow", which is a read.
--
-- Driver is absent, and cannot be given it by accident: `private.has_role` only grants
-- roles listed here, so adding a policy grants no access to anyone not named.

alter table public.reorder_policies enable row level security;

create policy "reorder readers see policies"
  on public.reorder_policies
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

create policy "reorder readers write policies"
  on public.reorder_policies
  for all
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role(variadic array[
      'TENANT_ADMIN'::private.app_role,
      'WAREHOUSE_MANAGER'::private.app_role,
      'PHARMACY_MANAGER'::private.app_role
    ]))
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role(variadic array[
      'TENANT_ADMIN'::private.app_role,
      'WAREHOUSE_MANAGER'::private.app_role,
      'PHARMACY_MANAGER'::private.app_role
    ]))
  );

-- ── the reader ─────────────────────────────────────────────────────────────────────
--
-- The point of the table. api.reorder_needs() answers "what should we order", which is a
-- derived quantity combining the policy with what is actually on hand -- and, crucially,
-- subtracting stock already reserved but not yet issued, because stock promised to a
-- requisition is not available to promise twice.
--
-- SECURITY DEFINER: it aggregates across batches, which a row-level read of stock_balances
-- would otherwise have to do in the client, once per batch.

create or replace function api.reorder_needs(p_facility_id uuid default null)
returns table (
  product_id uuid,
  sku text,
  name_en text,
  name_ar text,
  facility_id uuid,
  qty_on_hand numeric,
  qty_reserved numeric,
  qty_available numeric,
  min_qty numeric,
  max_qty numeric,
  suggested_qty numeric,
  lead_time_days integer,
  days_of_cover numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with balances as (
    select
      b.product_id,
      coalesce(sum(b.qty_on_hand), 0)  as qty_on_hand,
      coalesce(sum(b.qty_reserved), 0) as qty_reserved
    from public.stock_balances b
    where b.tenant_id = (select private.current_tenant_id())
      and (p_facility_id is null or exists (
        select 1 from public.storage_locations l
        where l.id = b.location_id and l.facility_id = p_facility_id
      ))
    group by b.product_id
  ),
  -- Movement out, over 90 days, per product. Signed by movement type, so negating gives a
  -- positive consumption rate.
  burn as (
    select
      l.product_id,
      greatest(-sum(l.qty_delta), 0) / 90.0 as avg_daily_qty
    from public.stock_ledger l
    where l.tenant_id = (select private.current_tenant_id())
      and l.qty_delta < 0
      and l.created_at >= now() - interval '90 days'
    group by l.product_id
  )
  select
    p.id,
    p.sku,
    p.name_en,
    p.name_ar,
    pol.facility_id,
    coalesce(b.qty_on_hand, 0),
    coalesce(b.qty_reserved, 0),
    coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0),
    pol.min_qty,
    pol.max_qty,
    -- Order up to max, from what is actually available. `greatest` because a negative
    -- suggestion would render as a refund.
    greatest(pol.max_qty - (coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0)), 0),
    pol.lead_time_days,
    case
      when coalesce(burn.avg_daily_qty, 0) <= 0 then null
      else round(
        (coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0)) / burn.avg_daily_qty
      )
    end
  from public.reorder_policies pol
  join public.products p on p.id = pol.product_id
  left join balances b on b.product_id = pol.product_id
  left join burn on burn.product_id = pol.product_id
  where pol.tenant_id = (select private.current_tenant_id())
    and pol.is_active
    and (p_facility_id is null or pol.facility_id = p_facility_id)
    -- Only products at or below their reorder point. The policy is the filter, which is
    -- the entire reason this is not just the old global-threshold query again.
    and coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0) <= pol.min_qty
  order by
    -- Most urgent first: the ratio of how far below the reorder point a product is,
    -- normalised by how big that reorder point is. A product at zero against a min of 10
    -- is not more urgent than one at zero against a min of 500 just because the absolute
    -- gap is larger.
    (pol.min_qty - (coalesce(b.qty_on_hand, 0) - coalesce(b.qty_reserved, 0)))
      / greatest(pol.min_qty, 1) desc,
    p.sku
$$;

comment on function api.reorder_needs(uuid) is
  'Active reorder policies whose available stock has fallen to or below the reorder '
  'point, with the quantity needed to order up to the maximum. Available subtracts stock '
  'already reserved by an allocation.';

revoke execute on function api.reorder_needs(uuid) from public, anon;
grant execute on function api.reorder_needs(uuid) to authenticated;

notify pgrst, 'reload schema';