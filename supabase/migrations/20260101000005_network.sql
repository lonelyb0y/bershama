-- ============================================================================
-- 0005_network.sql
-- The physical network: facilities (a warehouse, a pharmacy) and the storage
-- locations inside them.
--
-- A facility is a place stock can sit or be delivered to. A location is a place
-- *inside* a facility with a specific condition: ambient, chilled, quarantined,
-- or the virtual in-transit holding area.
--
-- The distinction that carries the most weight: QUARANTINE. Under WHO GDP,
-- received goods are not available for supply until someone inspects and
-- releases them. Modelling that as a location rather than a boolean means the
-- goods are physically accounted for while being unavailable, which is what an
-- auditor asks about.
-- ============================================================================

-- ── movement_type ───────────────────────────────────────────────────────────
--
-- Defined here rather than in the ledger migration (0008) so that the sign rule
-- can be referenced by the CHECK constraint in the same place the type is born.
--
-- The sign matters more than it looks. `qty_delta` is signed, so a bug that
-- posts an ISSUE as positive would silently inflate stock rather than fail. The
-- CHECK in 0008 ties each movement type to a legal sign, so that class of bug is
-- rejected by the database.

create type private.movement_type as enum (
  -- Positive only
  'RECEIPT',           -- goods received from a supplier into a location
  'TRANSFER_IN',       -- arrived from another location
  'COUNT_GAIN',        -- a stocktake counted more than the system held
  'RECALL_RELEASE',    -- recalled stock returned to general stock

  -- Negative only
  'ISSUE',             -- issued to fulfil a requisition
  'DISPENSE',          -- handed to a patient or prescriber
  'TRANSFER_OUT',      -- moved to another location
  'COUNT_LOSS',        -- a stocktake counted less than the system held
  'WRITE_OFF',         -- removed as expired, damaged or unsaleable
  'RECALL_QUARANTINE', -- pulled out of general stock by a recall

  -- Either direction
  'ADJUSTMENT',        -- manual correction, always with a reason
  'RETURN'             -- returned from a customer
);

comment on type private.movement_type is
  'Signed stock movements. Each type has a legal sign, enforced by a CHECK on '
  'stock_ledger, so a mis-signed movement is rejected rather than silently '
  'inflating or deflating stock.';

-- ── facilities ──────────────────────────────────────────────────────────────

create table public.facilities (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  kind         private.facility_kind not null,

  -- A short human code, used on paperwork and by warehouse staff over the phone.
  -- Unique per tenant rather than globally: two distributors may both call a
  -- site "WH-1", and neither should have to rename theirs to onboard.
  code         text not null check (code ~ '^[A-Z0-9][A-Z0-9._-]{1,23}$'),

  -- Both names required, for the same reason as products: a bilingual operator
  -- cannot use a monolingual record, and making it required at the schema level
  -- is cheaper than discovering the gap during data entry.
  name_en      text not null check (length(btrim(name_en)) > 0),
  name_ar      text not null check (length(btrim(name_ar)) > 0),

  address      text,
  city         text,
  governorate  text,
  phone        text,
  -- Distribution licence / pharmacy registration number.
  license_no   text,

  -- Numeric, not double precision: coordinates feed distance calculations for
  -- route planning, and a float there accumulates error in a way an integer
  -- minor unit never does. 8 decimal places is roughly 1mm.
  latitude     numeric(9,6) check (latitude between -90 and 90),
  longitude    numeric(9,6) check (longitude between -180 and 180),

  -- Deactivated rather than deleted. A facility that once held stock has a
  -- history, and that history is the audit trail.
  is_active    boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (tenant_id, code)
);

comment on table public.facilities is
  'A site stock can sit at or be delivered to: warehouse, pharmacy, hospital, clinic.';

-- Coordinates are the access path for route planning and the driver map. The
-- partial index serves the "show me active sites with a location" query without
-- indexing the many rows that have no coordinates yet.
create index facilities_tenant_idx on public.facilities (tenant_id);
create index facilities_geo_idx
  on public.facilities (tenant_id, latitude, longitude)
  where is_active and latitude is not null;

-- ── storage_locations ───────────────────────────────────────────────────────

create table public.storage_locations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  facility_id  uuid not null references public.facilities (id) on delete cascade,
  kind         private.location_kind not null,

  code         text not null check (code ~ '^[A-Z0-9][A-Z0-9._-]{1,23}$'),
  name_en      text not null check (length(btrim(name_en)) > 0),
  name_ar      text not null check (length(btrim(name_ar)) > 0),

  -- Cold-chain range in Celsius. Null for locations with no temperature
  -- requirement, which is most of them. Only set on COLD and FREEZER, and the
  -- M2 work does not enforce that pairing; a later migration can, once the cold
  -- chain module makes it meaningful.
  temp_min_c   numeric(5,2),
  temp_max_c   numeric(5,2),
  check (temp_min_c is null or temp_max_c is null or temp_min_c < temp_max_c),

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Unique per facility, not per tenant: "A1" in the Cairo warehouse and "A1" in
  -- an Alexandria warehouse are different shelves and must not collide.
  unique (facility_id, code)
);

comment on table public.storage_locations is
  'A position inside a facility, with a condition: ambient, cold, frozen, '
  'quarantined, or the virtual in-transit area. Stock is held against a location, '
  'not a facility, so a temperature excursion can be scoped to the shelves that '
  'were actually affected.';

comment on column public.storage_locations.kind is
  'QUARANTINE holds received-but-not-yet-released goods: accounted for, not '
  'available. IN_TRANSIT is virtual and belongs to the distributor rather than to '
  'a facility, which is what makes expiry ownership unambiguous while a van moves.';

create index storage_locations_facility_idx
  on public.storage_locations (facility_id) where is_active;

-- ── updated_at triggers ─────────────────────────────────────────────────────

create trigger facilities_touch_updated_at
  before update on public.facilities
  for each row execute function private.touch_updated_at();

create trigger storage_locations_touch_updated_at
  before update on public.storage_locations
  for each row execute function private.touch_updated_at();

-- ── tenant isolation ────────────────────────────────────────────────────────
--
-- The trigger pattern is reused rather than hand-rolled per table: it rejects a
-- row whose tenant_id differs from the caller's. The foreign key alone is not
-- enough, because it only proves the tenant exists, not that it is the caller's.

create trigger facilities_enforce_tenant
  before insert or update of tenant_id on public.facilities
  for each row execute function private.assert_single_tenant();

create trigger storage_locations_enforce_tenant
  before insert or update of tenant_id on public.storage_locations
  for each row execute function private.assert_single_tenant();

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- revoke first, then grant back only what is needed. Supabase's default for a new
-- table in `public` is full insert/update/delete for anon and authenticated, and
-- adding a policy does not remove those grants. This ordering is the part that
-- actually closes the door.

revoke all on table public.facilities, public.storage_locations
  from anon, authenticated;

-- Catalogue data is ordinary CRUD: the RLS policies below confine every write to
-- a warehouse-capable role within the caller's own tenant.
grant select, insert, update on table public.facilities to authenticated;
grant select, insert, update on table public.storage_locations to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.facilities        enable row level security;
alter table public.storage_locations enable row level security;

-- Anyone in the tenant can see the network. A driver's stop list and an admin's
-- dashboard are the same data, and hiding locations from a driver would only
-- mean hardcoding the address somewhere less safe.
create policy "read tenant facilities"
  on public.facilities for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "read tenant locations"
  on public.storage_locations for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- Creating and editing the network is an administrative action. A PHARMACY_MANAGER
-- or a DISTRIBUTOR has no business adding a warehouse.
create policy "managers create facilities"
  on public.facilities for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  );

create policy "managers update facilities"
  on public.facilities for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  );

create policy "managers create locations"
  on public.storage_locations for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  );

create policy "managers update locations"
  on public.storage_locations for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  );

-- ── audit ───────────────────────────────────────────────────────────────────
--
-- Catalogue edits are audited by trigger rather than by a function per operation.
-- One place to maintain, and it cannot be bypassed by a future write path added
-- without remembering to call an audit helper.

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    p_action      := tg_table_name || '.' || lower(tg_op),
    p_entity_type := tg_table_name,
    p_entity_id   := case
                       when tg_op = 'DELETE' then old.id::text
                       else new.id::text
                     end,
    p_before      := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    p_after       := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

comment on function private.audit_row_change() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger. SECURITY DEFINER because '
  'private.write_audit() is itself SECURITY DEFINER and the trigger must run for '
  'the client role.';

create trigger facilities_audit
  after insert or update on public.facilities
  for each row execute function private.audit_row_change();

create trigger storage_locations_audit
  after insert or update on public.storage_locations
  for each row execute function private.audit_row_change();
