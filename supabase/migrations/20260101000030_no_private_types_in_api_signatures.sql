-- Take text, cast inside. A `private` type in an api signature is uncallable.
--
-- 0028 typed p_form, p_kind and p_uom as private enums, on the reasoning that
-- the database should validate them. It made both functions unusable:
--
--   42501 permission denied for schema private
--
-- The failure is at the CALL, not inside the function. To pass a value for a
-- parameter PostgREST resolves the parameter's type name, and resolving
-- `private.stock_unit` requires USAGE on `private` -- which a client role has by
-- design and cannot be granted. So a `private` type anywhere in an api
-- function's parameter list makes that function uncallable from the browser,
-- and the error names the schema rather than the function, which sends you
-- looking in the wrong place entirely.
--
-- The fix is the opposite of 0028: accept `text` and cast inside, where the cast
-- runs as the owner. The database still validates the value -- a cast to an enum
-- rejects anything that is not a member -- so nothing is given up, and the
-- client never has to name a type it is not allowed to see.
--
-- ── this is a hazard across the whole api surface, not just here ───────────
--
-- api.quarantine_batch, api.release_batch, api.recall_batch and the stocktake
-- functions all declare a `p_to_status private.batch_status` parameter and are
-- therefore in exactly this state. No screen calls them yet, which is the only
-- reason it has not surfaced. They need the same treatment when their screens
-- are built, and this is the pattern to copy.
--
-- Restated rather than edited: 0028 has already been applied to the hosted
-- project, and a migration that has run is not re-run by changing it.

create or replace function api.create_product(
  p_sku text,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form text default 'TABLET',
  p_strength text default '',
  p_strength_unit text default null,
  p_pack_size integer default 1,
  p_uom text default 'BOX',
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
    coalesce(nullif(btrim(p_form), '')::private.product_form, 'TABLET'::private.product_form),
    coalesce(btrim(p_strength), ''),
    nullif(btrim(coalesce(p_strength_unit, '')), ''),
    p_pack_size,
    coalesce(nullif(btrim(p_uom), '')::private.stock_unit, 'BOX'::private.stock_unit),
    upper(nullif(btrim(coalesce(p_atc_code, '')), '')),
    nullif(btrim(coalesce(p_gtin, '')), ''),
    nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
    p_requires_prescription, p_is_controlled, p_is_cold_chain, p_shelf_life_months, true
  )
  returning * into v_row;

  return v_row;
end
$$;

create or replace function api.create_location(
  p_facility_id uuid,
  p_code text,
  p_name_en text,
  p_name_ar text,
  p_kind text default 'AMBIENT',
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
    btrim(p_name_en), btrim(p_name_ar), coalesce(nullif(btrim(p_kind), '')::private.location_kind, 'AMBIENT'::private.location_kind),
    p_temp_min_c, p_temp_max_c, true
  )
  returning * into v_row;

  return v_row;
end
$$;

grant execute on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) to authenticated, service_role;
grant execute on function api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric) to authenticated, service_role;

revoke execute on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer) from anon;
revoke execute on function api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric) from public;
revoke execute on function api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric) from anon;

grant execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) to authenticated, service_role;
grant execute on function api.create_location(uuid, text, text, text, text, numeric, numeric) to authenticated, service_role;

revoke execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) from anon;
revoke execute on function api.create_location(uuid, text, text, text, text, numeric, numeric) from public;
revoke execute on function api.create_location(uuid, text, text, text, text, numeric, numeric) from anon;

comment on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) is
  'Create a catalogue product. SECURITY DEFINER because the tenant policies reference private.*, which a client cannot name. Enum-typed parameters are accepted as text and cast inside: a private.* type in the signature makes the function uncallable from a client.';
comment on function api.create_location(uuid, text, text, text, text, numeric, numeric) is
  'Create a storage location. IN_TRANSIT is refused: transit locations are created by dispatch, and a hand-made one would appear in a stock count as a shelf that is not physically anywhere.';

-- The enum-typed overloads from 0028 are dropped rather than left in place: two
-- signatures for one name is PGRST203, which makes BOTH uncallable.
drop function if exists api.create_product(text, text, text, text, text, text, private.product_form, text, text, integer, private.stock_unit, text, text, text, boolean, boolean, boolean, integer);
drop function if exists api.create_location(uuid, text, text, text, private.location_kind, numeric, numeric);
