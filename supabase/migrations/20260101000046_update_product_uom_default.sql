-- The default UOM I wrote in 0044 was 'unit', which is not a member of
-- private.stock_unit.
--
-- The correct default has been 'BOX' since api.create_product was written in 0027. I
-- typed 'unit' from the catalogue form, which had the same wrong value in a text
-- input -- so the mistake was in the form and I copied it into the database instead
-- of checking the enum. Both are now fixed: the form offers the enum's members, and
-- the default matches them.
--
-- An edit to a product without a UOM sent an invalid value and the database refused
-- the whole edit, which is how it was found.

create or replace function api.update_product(
  p_id uuid,
  p_sku text,
  p_name_en text,
  p_name_ar text,
  p_generic_name_en text default null,
  p_generic_name_ar text default null,
  p_brand text default null,
  p_form text default null,
  p_strength text default null,
  p_strength_unit text default null,
  p_pack_size integer default null,
  p_uom text default null,
  p_atc_code text default null,
  p_gtin text default null,
  p_eda_reg_no text default null,
  p_requires_prescription boolean default false,
  p_is_controlled boolean default false,
  p_is_cold_chain boolean default false,
  p_shelf_life_months integer default null,
  p_is_active boolean default null
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := (select private.current_tenant_id());
  v_row    public.products;
begin
  if v_tenant is null then
    raise exception 'no tenant for the current session' using errcode = '42501';
  end if;

  if not (select private.has_role('TENANT_ADMIN', 'WAREHOUSE_MANAGER')) then
    raise exception 'only a warehouse manager may edit a product' using errcode = '42501';
  end if;

  update public.products p
  set sku = btrim(p_sku),
      name_en = btrim(p_name_en),
      name_ar = btrim(p_name_ar),
      generic_name_en = nullif(btrim(coalesce(p_generic_name_en, '')), ''),
      generic_name_ar = nullif(btrim(coalesce(p_generic_name_ar, '')), ''),
      brand = nullif(btrim(coalesce(p_brand, '')), ''),
      form = coalesce(nullif(btrim(coalesce(p_form, '')), ''), 'UNSPECIFIED')::private.product_form,
      strength = nullif(btrim(coalesce(p_strength, '')), ''),
      strength_unit = nullif(btrim(coalesce(p_strength_unit, '')), ''),
      pack_size = coalesce(p_pack_size, 1),
      uom = coalesce(nullif(btrim(coalesce(p_uom, '')), ''), 'BOX')::private.stock_unit,
      atc_code = nullif(upper(btrim(coalesce(p_atc_code, ''))), ''),
      gtin = nullif(btrim(coalesce(p_gtin, '')), ''),
      eda_reg_no = nullif(btrim(coalesce(p_eda_reg_no, '')), ''),
      requires_prescription = coalesce(p_requires_prescription, false),
      is_controlled = coalesce(p_is_controlled, false),
      is_cold_chain = coalesce(p_is_cold_chain, false),
      shelf_life_months = coalesce(p_shelf_life_months, 1),
      is_active = coalesce(p_is_active, p.is_active),
      updated_at = now()
  where p.id = p_id and p.tenant_id = v_tenant
  returning * into v_row;

  if not found then
    raise exception 'no product % in this tenant', p_id using errcode = 'P0002';
  end if;

  return v_row;
end
$$;

grant execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) to authenticated, service_role;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) from public;
revoke execute on function api.update_product(uuid, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, boolean, boolean, boolean, integer, boolean) from anon;
