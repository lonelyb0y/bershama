-- ============================================================================
-- 0006_catalogue.sql
-- products: the thing being distributed.
--
-- The central design decision is that a product record is BILINGUAL and the
-- database enforces it. name_ar is NOT NULL, not "nullable, we will fill it in".
--
-- Egyptian pharmacies stock bilingual packaging: the box says "بنادول إكسترا" and
-- "Panadol Extra" on the same carton. A pharmacy manager orders against what is
-- in front of them and searches for either name. A single-name product record is
-- not a slightly worse record, it is an unusable one, and allowing it creates
-- exactly the gap this constraint prevents.
--
-- Stock is counted in ONE unit per product, usually the box. A box of 20 tablets
-- is one unit and pack_size is descriptive. Multi-unit conversion is deliberately
-- deferred: it introduces fractional quantities and a conversion table, and for a
-- distributor whose customers order in boxes it would be complexity with no
-- accuracy gained.
-- ============================================================================

-- Dosage form. An enum rather than free text: an analyst grouping by form should
-- not have to normalise "tab" and "TAB" and "Tablets", and the count of distinct
-- values stays meaningful.
create type private.product_form as enum (
  'TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'VIAL',
  'SACHET', 'CREAM', 'OINTMENT', 'SUPPOSITORY', 'DROPS', 'INHALER', 'PATCH'
);

-- The unit stock is counted in. One per product, not a hierarchy.
create type private.stock_unit as enum (
  'BOX', 'STRIP', 'BOTTLE', 'TUBE', 'VIAL', 'SACHET', 'KIT'
);

create type private.strength_unit as enum (
  'mg', 'g', 'mcg', 'ml', 'IU', '%', 'units'
);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,

  sku          text not null check (sku ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$'),

  name_en      text not null check (length(btrim(name_en)) > 0),
  name_ar      text not null check (length(btrim(name_ar)) > 0),

  -- Generic name is the INN, and it is how a pharmacist searches. Both scripts
  -- again: a doctor writes the Latin name, the shelf label may use the Arabic.
  generic_name_en text,
  generic_name_ar text,
  brand        text,

  form         private.product_form not null,
  -- Free text rather than numeric + unit: "500mg", "2.5mg/ml", "10,000IU" and
  -- "5% w/v" are all real strengths and a numeric column cannot hold them without
  -- a formatting convention that then has to be parsed back.
  strength     text not null check (length(btrim(strength)) > 0),
  strength_unit private.strength_unit,

  -- Units in the pack. 20 tablets in a box, 5 vials in a kit. Integer: a pack is
  -- a countable thing.
  pack_size    integer not null default 1 check (pack_size > 0),

  -- The single unit stock is counted in.
  uom          private.stock_unit not null default 'BOX',

  -- WHO Anatomical Therapeutic Chemical code. This is the classification that
  -- makes the catalogue comparable across distributors, and the one an Egyptian
  -- Drug Authority submission is organised by.
  --
  -- The pattern is a shape check, not a code check. A real ATC code is 7
  -- characters -- an anatomical letter, two digits, two letters, then one or two
  -- digits, as in N02BE01 for paracetamol or A10AB01 for insulin. An earlier
  -- constraint of ^[A-Z][0-9]{4}$ accepted only 5 and rejected every real code;
  -- the test fixtures caught it immediately.
  --
  -- Deliberately permissive beyond the shape. Whether a code actually exists and
  -- means what someone thinks is a question for a reference table, not a regular
  -- expression, and a regex that pretends to know better will reject valid codes
  -- the moment the WHO issues one.
  atc_code     text check (atc_code is null or atc_code ~ '^[A-Z][0-9A-Z]{5,6}$'),

  -- GTIN/EAN barcode. The scan target on the carton, and the lookup key when a
  -- warehouse receives a delivery with no paperwork.
  gtin         text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),

  -- Egyptian Drug Authority registration number.
  eda_reg_no   text,

  requires_prescription boolean not null default true,
  -- Controlled drugs (narcotics, psychotropics) carry additional record-keeping
  -- obligations. Flagged now so the v2 serial work has something to key off.
  is_controlled boolean not null default false,
  is_cold_chain boolean not null default false,
  -- Serial-level traceability. Inert until the v2 serial work; declared now so
  -- the migration that introduces serials has a column to populate.
  is_serialised boolean not null default false,

  -- Default shelf life in months, used to sanity-check a batch's expiry date
  -- entered against its manufacture date.
  shelf_life_months integer not null default 24
                 check (shelf_life_months between 1 and 240),

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (tenant_id, sku)
);

comment on table public.products is
  'A medicine or consumable. Bilingual by database constraint: name_ar is NOT NULL '
  'because an Egyptian pharmacy orders against bilingual packaging and a '
  'single-name record is unusable in practice.';

comment on column public.products.uom is
  'The single unit stock is counted in. Deliberately one per product: multi-unit '
  'conversion would introduce fractional quantities, and a distributor whose '
  'customers order in boxes gains no accuracy from it.';

-- A GTIN identifies one tradeable item globally, so within a tenant two products
-- must not share one. Partial, because many catalogue entries have no barcode
-- yet and NULLs must not collide.
create unique index products_tenant_gtin_idx
  on public.products (tenant_id, gtin) where gtin is not null;

create index products_tenant_idx on public.products (tenant_id);
create index products_name_idx
  on public.products (tenant_id, lower(name_en), lower(name_ar));

-- Bilingual search. The GIN index over the concatenated expression serves the
-- ILIKE '%q%' pattern that a typeahead box generates, which a plain btree on
-- name cannot help with because of the leading wildcard.
--
-- Both scripts are indexed in one expression so a single index serves both a
-- Latin and an Arabic query, and so that a Latin query cannot accidentally skip
-- rows whose only match is in Arabic.
--
-- The extension is created BEFORE the index, because gin_trgm_ops does not exist
-- until pg_trgm is installed. Creating the index first is a plain
-- "operator class does not exist for access method gin" failure, and the ordering
-- is not obvious enough to leave to chance.
--
-- The `extensions` schema is where Supabase puts managed extensions. It is
-- created here defensively so these migrations also apply to a bare PostgreSQL,
-- which is what scripts/verify-db.sh uses. `if not exists` makes it a no-op on
-- Supabase, where the schema already exists.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- The operator class is schema-qualified as extensions.gin_trgm_ops because the
-- extension is installed there, not in the default search_path. Unqualified, it
-- resolves to nothing and the error is the same misleading "operator class does
-- not exist for access method gin" as not having the extension at all -- which is
-- exactly why that message sent this down the wrong path once already.
create index products_search_idx
  on public.products
  using gin (
    (
      coalesce(name_en, '') || ' ' || coalesce(name_ar, '') || ' ' ||
      coalesce(generic_name_en, '') || ' ' || coalesce(generic_name_ar, '') || ' ' ||
      coalesce(brand, '') || ' ' || coalesce(sku, '') || ' ' ||
      coalesce(atc_code, '') || ' ' || coalesce(gtin, '')
    ) extensions.gin_trgm_ops
  );

-- ── trigger, grants, RLS ────────────────────────────────────────────────────

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function private.touch_updated_at();

create trigger products_enforce_tenant
  before insert or update of tenant_id on public.products
  for each row execute function private.assert_single_tenant();

create trigger products_audit
  after insert or update on public.products
  for each row execute function private.audit_row_change();

-- Catalogue writes are an administrative action, same as the network. A
-- PHARMACY_MANAGER and a DISTRIBUTOR read the catalogue; they do not edit it.
revoke all on table public.products from anon, authenticated;
grant select, insert, update on table public.products to authenticated;

alter table public.products enable row level security;

create policy "read tenant products"
  on public.products for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "managers create products"
  on public.products for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  );

create policy "managers update products"
  on public.products for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER'))
  );
