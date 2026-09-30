-- Catalogue and requisition writes, as api functions.
--
-- ── why ─────────────────────────────────────────────────────────────────────
--
-- A client cannot write these tables directly, and the reason is structural
-- rather than a missing grant:
--
--   **an RLS policy whose expression calls a `private` function is unreachable
--   from a client**, because PostgREST prepares the statement with the caller's
--   role active, and the caller has no USAGE on `private` by design.
--
-- Verified rather than reasoned: with USAGE granted to `authenticated` the
-- failing insert returns 201, and without it, 42501. That grant is exactly what
-- rls_coverage.test.sql forbids, so the policy cannot be made to work and the
-- grant must not be made.
--
-- The way out is the one every other write in this project already takes: a
-- SECURITY DEFINER function in `api`, which runs as its owner and therefore
-- resolves `private.*` regardless of who called. The M2 catalogue form wrote
-- tables directly and has therefore never worked; these functions replace it.
--
-- ── what the trigger cannot do ──────────────────────────────────────────────
--
-- private.assert_single_tenant() fills and validates the tenant, but a client
-- still cannot reach it through a policy. These functions do the write with the
-- owner, so the trigger fires with the owner's session -- and the tenant
-- assertion therefore sees no auth.uid() and has no opinion. That is why every
-- one of these sets tenant_id explicitly and is schema-qualified throughout: the
-- caller cannot choose it, because it is written from the caller's own profile
-- inside the function.

-- ── products ────────────────────────────────────────────────────────────────

create or replace function api.create_product(
  p_sku text,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form private.product_form default 'TABLET',
  p_strength text default '',
  p_strength_unit text default null,
  p_pack_size integer default 1,
  p_uom private.stock_unit default 'BOX',
  p_atc_code text default null,
  p_gtin text default null,
  p_eda_reg_no text default null,
  p_requires_prescription boolean default false,
  p_is_controlled boolean default false,
  p_is_cold_chain boolean default false,
  p_shelf_life_months integer default 24
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.products;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may create a product'
      using errcode = '42501';
  end if;

  if btrim(coalesce(p_sku, '')) = '' or btrim(coalesce(p_name_en, '')) = ''
     or btrim(coalesce(p_name_ar, '')) = '' then
    -- Both names, not one with the other optional. Egyptian pharmacies stock
    -- bilingual packaging, so a single-name record cannot be ordered against.
    raise exception 'sku, name_en and name_ar are all required'
      using errcode = '22023';
  end if;

  if p_pack_size < 1 or p_shelf_life_months < 1 then
    raise exception 'pack_size and shelf_life_months must be at least 1'
      using errcode = '22023';
  end if;

  if p_gtin is not null and not (p_gtin ~ '^\d{8}$|^\d{13,14}$') then
    raise exception 'a GTIN is 8 or 13 digits' using errcode = '22023';
  end if;

  insert into public.products (
    tenant_id, sku, name_en, name_ar, generic_name_en, generic_name_ar, brand,
    form, strength, strength_unit, pack_size, uom, atc_code, gtin, eda_reg_no,
    requires_prescription, is_controlled, is_cold_chain, shelf_life_months, is_active
  )
  values (
    (select private.current_tenant_id()), btrim(p_sku), btrim(p_name_en), btrim(p_name_ar),
    nullif(btrim(coalesce(p_generic_name_en, '')), ''),
    nullif(btrim(coalesce(p_generic_name_ar, '')), ''),
    nullif(btrim(coalesce(p_brand, '')), ''),
    coalesce(p_form, 'TABLET'::private.product_form),
    coalesce(btrim(p_strength), ''),
    nullif(btrim(coalesce(p_strength_unit, '')), '')::private.strength_unit,
    p_pack_size, p_uom,
    upper(nullif(btrim(coalesce(p_atc_code, '')), '')),
    nullif(btrim(coalesce(p_gtin, '')), ''),
    nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
    p_requires_prescription, p_is_controlled, p_is_cold_chain, p_shelf_life_months, true
  )
  returning * into v_row;

  return v_row;
end
$$;

create or replace function api.update_product(
  p_id uuid,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form private.product_form default 'TABLET',
  p_strength text default '',
  p_strength_unit text default null,
  p_pack_size integer default 1,
  p_uom private.stock_unit default 'BOX',
  p_atc_code text default null,
  p_gtin text default null,
  p_eda_reg_no text default null,
  p_requires_prescription boolean default false,
  p_is_controlled boolean default false,
  p_is_cold_chain boolean default false,
  p_shelf_life_months integer default 24
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.products;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may edit a product' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name_en, '')) = '' or btrim(coalesce(p_name_ar, '')) = '' then
    raise exception 'both names are required' using errcode = '22023';
  end if;

  -- sku is deliberately absent from the parameter list. It is the product's
  -- identity, it appears on every printed label and delivery note already in
  -- circulation, and changing it is a data-migration decision rather than an edit
  -- a warehouse supervisor makes from a form.
  update public.products p
  set name_en = btrim(p_name_en),
      name_ar = btrim(p_name_ar),
      generic_name_en = nullif(btrim(coalesce(p_generic_name_en, '')), ''),
      generic_name_ar = nullif(btrim(coalesce(p_generic_name_ar, '')), ''),
      brand = nullif(btrim(coalesce(p_brand, '')), ''),
      form = coalesce(p_form, 'TABLET'::private.product_form),
      strength = coalesce(btrim(p_strength), ''),
      strength_unit = nullif(btrim(coalesce(p_strength_unit, '')), '')::private.strength_unit,
      pack_size = p_pack_size,
      uom = p_uom,
      atc_code = upper(nullif(btrim(coalesce(p_atc_code, '')), '')),
      gtin = nullif(btrim(coalesce(p_gtin, '')), ''),
      eda_reg_no = nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
      requires_prescription = p_requires_prescription,
      is_controlled = p_is_controlled,
      is_cold_chain = p_is_cold_chain,
      shelf_life_months = p_shelf_life_months,
      updated_at = now()
  where p.id = p_id
    and p.tenant_id = (select private.current_tenant_id())
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

-- Active or inactive, never deleted. A product can be years deep in batches,
-- movements and audit history, and a hard delete would either cascade through all
-- of that or fail on the foreign keys -- and either way destroy the evidence that
-- the stock existed.
create or replace function api.set_product_active(p_id uuid, p_active boolean)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.products;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may change a product''s status'
      using errcode = '42501';
  end if;

  update public.products p
  set is_active = p_active, updated_at = now()
  where p.id = p_id and p.tenant_id = (select private.current_tenant_id())
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

-- ── storage locations ───────────────────────────────────────────────────────

create or replace function api.create_location(
  p_facility_id uuid,
  p_code text,
  p_name_en text,
  p_name_ar text,
  p_kind private.location_kind default 'AMBIENT',
  p_temp_min_c numeric default null,
  p_temp_max_c numeric default null
)
returns public.storage_locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.storage_locations;
begin
  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may create a location'
      using errcode = '42501';
  end if;

  if btrim(coalesce(p_code, '')) = '' or btrim(coalesce(p_name_en, '')) = ''
     or btrim(coalesce(p_name_ar, '')) = '' then
    raise exception 'code, name_en and name_ar are all required' using errcode = '22023';
  end if;

  -- A cold-store range that can never be satisfied is worse than no range: it
  -- would look configured and never trigger.
  if p_temp_min_c is not null and p_temp_max_c is not null and p_temp_min_c > p_temp_max_c then
    raise exception 'the maximum cannot be below the minimum' using errcode = '22023';
  end if;

  if p_kind = 'IN_TRANSIT' then
    -- Transit locations are created by the dispatch flow when a trip starts. A
    -- hand-made one would appear in a stock count as a shelf that is not
    -- physically anywhere.
    raise exception 'IN_TRANSIT locations are created by dispatch, not by hand'
      using errcode = '22023';
  end if;

  insert into public.storage_locations (
    tenant_id, facility_id, code, name_en, name_ar, kind, temp_min_c, temp_max_c, is_active
  )
  values (
    (select private.current_tenant_id()), p_facility_id, btrim(p_code),
    btrim(p_name_en), btrim(p_name_ar), coalesce(p_kind, 'AMBIENT'::private.location_kind),
    p_temp_min_c, p_temp_max_c, true
  )
  returning * into v_row;

  return v_row;
end
$$;

-- ── requisitions ────────────────────────────────────────────────────────────

create or replace function api.create_requisition(
  p_facility_id uuid,
  p_justification text default null
)
returns public.requisitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.requisitions;
  v_seq    bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER', 'PHARMACY_MANAGER')) then
    raise exception 'your role cannot raise a requisition' using errcode = '42501';
  end if;

  -- The code is derived, never supplied. A caller-chosen code is either a
  -- duplicate somebody will hit, or a gap in the sequence that makes the paper
  -- record and the database disagree about what exists.
  select coalesce(max(split_part(code, '-', 2)::bigint), 0) + 1 into v_seq
  from public.requisitions
  where tenant_id = v_tenant and code ~ '^REQ-[0-9]+$';

  insert into public.requisitions (tenant_id, code, facility_id, status, justification)
  values (v_tenant, 'REQ-' || lpad(v_seq::text, 6, '0'), p_facility_id, 'DRAFT',
          nullif(btrim(coalesce(p_justification, '')), ''))
  returning * into v_row;

  -- requested_by is the caller. Set here rather than left to the trigger, because
  -- the trigger sees no session either: these functions run as their owner.
  update public.requisitions
  set requested_by = (select auth.uid())
  where id = v_row.id;

  v_row.requested_by := (select auth.uid());
  return v_row;
end
$$;

-- The line is inserted, not updated: a requisition is a document, and rewriting a
-- line after the fact would leave no record that the quantity changed.
create or replace function api.add_requisition_line(
  p_requisition_id uuid,
  p_product_id uuid,
  p_qty_requested integer
)
returns public.requisition_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_status text;
  v_row    public.requisition_lines;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if p_qty_requested < 1 then
    raise exception 'a quantity below one is not a request' using errcode = '22023';
  end if;

  select r.status into v_status
  from public.requisitions r
  where r.id = p_requisition_id and r.tenant_id = v_tenant;

  if v_status is null then
    raise exception 'no requisition % in this tenant', p_requisition_id using errcode = 'P0002';
  end if;

  if v_status <> 'DRAFT' then
    -- A SUBMITTED request is a promise. Adding a line to it afterwards would
    -- change what was promised without anybody re-approving it.
    raise exception 'a % request cannot be changed; raise a new one', v_status
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = p_product_id and p.tenant_id = v_tenant and p.is_active
  ) then
    raise exception 'no active product % in this tenant', p_product_id using errcode = 'P0002';
  end if;

  insert into public.requisition_lines (tenant_id, requisition_id, product_id, qty_requested)
  values (v_tenant, p_requisition_id, p_product_id, p_qty_requested)
  returning * into v_row;

  return v_row;
end
$$;

create or replace function api.remove_requisition_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
begin
  delete from public.requisition_lines l
  using public.requisitions r
  where l.id = p_line_id
    and l.tenant_id = v_tenant
    and r.id = l.requisition_id
    and r.status = 'DRAFT'
    and r.requested_by = (select auth.uid());

  if not found then
    -- A line on a non-draft, or on somebody else's draft, is refused rather than
    -- silently ignored: a requester who cannot delete a line needs to know.
    raise exception 'no editable line % in this tenant', p_line_id using errcode = 'P0002';
  end if;
end
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- revoke from PUBLIC, not just from anon: postgres grants EXECUTE to PUBLIC on
-- every function it creates, and revoking from one named role leaves the other
-- path open. That is the whole of migration 0017.

grant execute on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) to authenticated, service_role;
grant execute on function api.update_product(uuid, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) to authenticated, service_role;
grant execute on function api.set_product_active(uuid, boolean) to authenticated, service_role;
grant execute on function api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric) to authenticated, service_role;
grant execute on function api.create_requisition(uuid, text) to authenticated, service_role;
grant execute on function api.add_requisition_line(uuid, uuid, integer) to authenticated, service_role;
grant execute on function api.remove_requisition_line(uuid) to authenticated, service_role;

revoke execute on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from anon;
revoke execute on function api.update_product(uuid, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.update_product(uuid, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.update_product(uuid, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from anon;
revoke execute on function api.set_product_active(uuid, boolean) from public;
revoke execute on function api.set_product_active(uuid, boolean) from anon;
revoke execute on function api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric) from public;
revoke execute on function api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric) from anon;
revoke execute on function api.create_requisition(uuid, text) from public;
revoke execute on function api.create_requisition(uuid, text) from anon;
revoke execute on function api.add_requisition_line(uuid, uuid, integer) from public;
revoke execute on function api.add_requisition_line(uuid, uuid, integer) from anon;
revoke execute on function api.remove_requisition_line(uuid) from public;
revoke execute on function api.remove_requisition_line(uuid) from anon;

comment on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) is
  'Create a catalogue product. SECURITY DEFINER because the tenant policies reference private.*, which a client role cannot name -- a direct table insert returns 42501.';
comment on function api.create_requisition(uuid, text) is
  'Open a DRAFT requisition with a derived REQ-NNNNNN code. requested_by is always the caller.';
comment on function api.add_requisition_line(uuid, uuid, integer) is
  'Add a line to a DRAFT requisition. Refused once the request is SUBMITTED, because a submitted request is a promise and changing it would bypass approval.';
