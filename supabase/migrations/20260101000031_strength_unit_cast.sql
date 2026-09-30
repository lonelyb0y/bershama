-- Cast strength_unit too, and audit the other one.

-- 0030 fixed p_form, p_kind and p_uom and create_product still failed, with
--
--   column "strength_unit" is of type private.strength_unit but expression is of
--   type text
--
-- products has FOUR enum columns -- form, strength_unit, uom, and the product's
-- own status -- and 0030 cast three of them. Fixing the one the error named
-- rather than reading the table is how the second round happened.
--
-- The full set is now: form, strength_unit, uom, cast to their enum types
-- inside the function body. `p_pack_size`, `p_shelf_life_months` and the boolean
-- flags are plain integer/boolean and need nothing.

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
    nullif(btrim(coalesce(p_strength_unit, '')), '')::private.strength_unit,
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

grant execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) to authenticated, service_role;
revoke execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) from public;
revoke execute on function api.create_product(text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer) from anon;
